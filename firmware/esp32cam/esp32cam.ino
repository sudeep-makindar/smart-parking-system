/*
 * Smart Parking System — ESP32-CAM (AI-Thinker, OV3660) vision node
 * -----------------------------------------------------------------
 *  - Captures 320x240 grayscale frames
 *  - Background-subtraction occupancy detection for 4 slot ROIs (~2 fps):
 *      blur 5x5 -> brightness correct (reference patch) -> |diff| vs empty reference
 *      -> changed-pixel ratio -> hysteresis (T_HIGH / T_LOW) -> 4-frame debounce
 *  - Broadcasts parking_msg_t to the ESP32-S3 over ESP-NOW (every 500 ms and on change)
 *  - Joins the controller's "SmartParking" AP as 192.168.4.2 and serves an
 *    MJPEG stream at http://192.168.4.2:81/stream (ROIs drawn on the image)
 *      ?mode=raw|diff|mask  shows the camera image, |frame - reference|, or the
 *                           thresholded change mask (what the detector "sees")
 *      &overlay=0           leave the ROI boxes off (the dashboard draws its own)
 *  - Calibration (empty-lot reference, 10-frame average, saved to SPIFFS):
 *      press the button on GPIO 13, or "Recalibrate Camera" in the dashboard
 *  - Accepts threshold updates from the dashboard (stored in NVS)
 *
 * Arduino IDE 2.x, ESP32 core 2.0.x or 3.x
 *   Tools > Board: "AI Thinker ESP32-CAM"
 *   Tools > Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)"
 *   Tools > PSRAM: Enabled (default for this board)
 *   Flash with the ESP32-CAM-MB board; power from a solid 5 V 2 A supply.
 *
 * Tuning the ROIs: flash once, join the SmartParking Wi-Fi and open
 * http://192.168.4.2:81/ — the rectangles below are drawn on the live image.
 * Move the camera or edit SLOT_ROIS until each rectangle covers one bay,
 * then recalibrate with the lot empty.
 */

#include <Arduino.h>
#include <esp_arduino_version.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <SPIFFS.h>
#include <Preferences.h>
#include "esp_camera.h"
#include "img_converters.h"
#include "esp_http_server.h"

#define FIRMWARE_VERSION "1.1.0"

// ───────────────────────────── Network ─────────────────────────────
static const char *AP_SSID = "SmartParking";
static const char *AP_PASS = "park1234";
static const uint8_t AP_CHANNEL = 1;  // must match the ESP32-S3 Soft-AP
static const IPAddress CAM_IP(192, 168, 4, 2);
static const IPAddress GATEWAY_IP(192, 168, 4, 1);
static const IPAddress SUBNET(255, 255, 255, 0);
static const uint16_t STREAM_PORT = 81;

// ───────────────────────────── Pins ────────────────────────────────
static const uint8_t PIN_CALIB_BTN = 13;  // to GND, internal pull-up
static const uint8_t PIN_STATUS_LED = 33; // onboard red LED, active LOW
static const uint8_t PIN_FLASH_LED = 4;   // keep the bright flash LED off
#define STATUS_LED_ON LOW
#define STATUS_LED_OFF HIGH

// AI-Thinker ESP32-CAM camera pins
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// Image orientation: set to match how the camera is mounted
#define CAM_VFLIP 1
#define CAM_HMIRROR 0

// ───────────────────────────── Frame & ROIs ────────────────────────
#define FRAME_W 320
#define FRAME_H 240
#define FRAME_PIXELS (FRAME_W * FRAME_H)
#define NUM_SLOTS 4

struct Roi {
  uint16_t x, y, w, h;
};

/*
 * Slot regions in QVGA pixel coordinates (origin top-left, x→ right, y↓ down).
 * Default layout: 4 bays side by side across the middle of the frame, seen from above.
 *
 *     0        80       160      240      320
 *   0 +--------+--------+--------+--------+
 *     |                                   |
 *  70 |  +----+  +----+  +----+  +----+   |
 *     |  | A1 |  | A2 |  | A3 |  | A4 |   |
 *     |  |    |  |    |  |    |  |    |   |
 * 170 |  +----+  +----+  +----+  +----+   |
 *     |           +--------+              |
 * 196 |           |  REF   |              |   REF = patch that is never parked on
 * 240 +-----------+--------+--------------+
 *
 * Tips: keep each ROI inside its bay with a small margin so neighbouring cars
 * don't bleed in; bigger ROIs are more stable. x+w <= 320 and y+h <= 240.
 */
static const Roi SLOT_ROIS[NUM_SLOTS] = {
    {16, 70, 64, 100},   // A1
    {92, 70, 64, 100},   // A2
    {168, 70, 64, 100},  // A3
    {244, 70, 64, 100},  // A4
};
// Always-empty patch of the mat used to cancel global brightness changes
static const Roi REF_PATCH = {120, 196, 80, 32};

// ───────────────────────────── Detection defaults ──────────────────
static const uint8_t DEFAULT_PIX_THRESH = 35;
static const uint8_t DEFAULT_T_HIGH_PCT = 30;  // 0.30
static const uint8_t DEFAULT_T_LOW_PCT = 15;   // 0.15
static const uint8_t DEBOUNCE_FRAMES = 4;      // 4 frames x 500 ms = ~2 s
static const uint32_t DETECT_INTERVAL_MS = 500;  // ~2 fps detection
static const uint32_t SEND_INTERVAL_MS = 500;    // ESP-NOW heartbeat
static const uint32_t CONFIG_INTERVAL_MS = 5000;
static const uint32_t AE_WARMUP_MS = 3000;       // let auto-exposure settle, then lock it
static const uint8_t CALIB_FRAMES = 10;
static const int MAX_BRIGHTNESS_OFFSET = 80;
static const uint32_t STREAM_FRAME_MS = 100;     // MJPEG at up to ~10 fps
static const int STREAM_JPEG_QUALITY = 80;
static const uint8_t DIFF_GAIN = 3;              // brightens the diff view so small changes are visible
static const char *REF_PATH = "/ref.bin";

// ───────────────────── ESP-NOW protocol (must match esp32s3.ino) ─────────────────────
typedef struct __attribute__((packed)) {
  uint8_t zone_id;    // 'A' = 0x41
  uint8_t slots[4];   // 1 = occupied, 0 = empty
  uint8_t scores[4];  // detection ratio x 100 (0-100)
  uint8_t sequence;   // rolling counter
} parking_msg_t;

#define CMD_MAGIC 0xC5
enum : uint8_t { CMD_CALIBRATE = 1, CMD_SETTINGS = 2 };
typedef struct __attribute__((packed)) {
  uint8_t magic;
  uint8_t cmd;
  uint8_t cmd_id;
  uint8_t pix_thresh;
  uint8_t t_high_pct;
  uint8_t t_low_pct;
} command_msg_t;

#define CONFIG_MAGIC 0xCF
typedef struct __attribute__((packed)) {
  uint8_t magic;
  uint8_t zone_id;
  uint8_t pix_thresh;
  uint8_t t_high_pct;
  uint8_t t_low_pct;
  uint8_t calibrated;
  uint8_t calib_count;
  uint16_t roi[NUM_SLOTS + 1][4];
} config_msg_t;

static_assert(sizeof(parking_msg_t) == 10, "parking_msg_t layout");
static_assert(sizeof(command_msg_t) == 6, "command_msg_t layout");
static_assert(sizeof(config_msg_t) == 47, "config_msg_t layout");

static const char ZONE_ID = 'A';
static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ───────────────────────────── State ───────────────────────────────
// Image buffers (PSRAM)
static uint8_t *blurTmp = nullptr;    // horizontal blur pass
static uint8_t *frameBlur = nullptr;  // current blurred frame
static uint8_t *reference = nullptr;  // blurred empty-lot reference
static uint16_t *calibAcc = nullptr;  // calibration accumulator
static uint8_t *overlay = nullptr;    // stream frame (debug view and/or ROIs drawn)
static bool referenceReady = false;

// Thresholds (persisted in NVS)
static Preferences prefs;
static uint8_t pixThresh = DEFAULT_PIX_THRESH;
static uint8_t tHighPct = DEFAULT_T_HIGH_PCT;
static uint8_t tLowPct = DEFAULT_T_LOW_PCT;

// Per-slot detection state
static bool slotOccupied[NUM_SLOTS] = {false};
static uint8_t slotScore[NUM_SLOTS] = {0};
static uint8_t slotPending[NUM_SLOTS] = {0};  // consecutive frames disagreeing with slotOccupied

// Calibration
static bool calibRequested = false;
static uint8_t calibFramesDone = 0;
static uint8_t calibCount = 0;

// Timing
static uint32_t cameraStartMs = 0;
static bool aeLocked = false;
static uint32_t lastDetectMs = 0;
static uint32_t lastSendMs = 0;
static uint32_t lastConfigMs = 0;
static uint32_t lastStreamEncodeMs = 0;
static uint8_t sequence = 0;

// Status LED blink (non-blocking)
static uint8_t ledBlinkToggles = 0;
static uint32_t ledLastToggleMs = 0;

// Commands from the controller (ESP-NOW callback -> loop)
static portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;
static command_msg_t rxCmd;
static volatile bool rxCmdPending = false;
static uint8_t lastCmdId = 0;

// Latest JPEG for the stream handler
static SemaphoreHandle_t jpgMutex;
static uint8_t *jpgBuf = nullptr;
static size_t jpgLen = 0;
static uint32_t jpgSeq = 0;
static volatile int streamClients = 0;
enum : uint8_t { STREAM_RAW, STREAM_DIFF, STREAM_MASK };
static volatile uint8_t streamMode = STREAM_RAW;  // set by the newest /stream request
static volatile bool streamOverlay = true;
static httpd_handle_t streamHttpd = nullptr;

// ───────────────────────────── Camera ──────────────────────────────
static bool initCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
#else
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
#endif
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_GRAYSCALE;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;  // unused for grayscale
  config.fb_count = 2;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] init failed: 0x%x\n", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  Serial.printf("[CAM] sensor PID 0x%04x%s\n", s->id.PID, s->id.PID == OV3660_PID ? " (OV3660)" : "");
  if (s->id.PID == OV3660_PID) {
    // Recommended OV3660 defaults (from the esp32-camera CameraWebServer example)
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }
  s->set_vflip(s, CAM_VFLIP);
  s->set_hmirror(s, CAM_HMIRROR);
  s->set_exposure_ctrl(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_whitebal(s, 1);
  cameraStartMs = millis();
  return true;
}

// After the warm-up the exposure is frozen so the reference stays comparable
static void lockAutoExposure() {
  sensor_t *s = esp_camera_sensor_get();
  s->set_exposure_ctrl(s, 0);
  s->set_aec2(s, 0);
  s->set_gain_ctrl(s, 0);
  s->set_whitebal(s, 0);
  s->set_awb_gain(s, 0);
  aeLocked = true;
  Serial.println("[CAM] auto-exposure / gain locked");
}

// ───────────────────────────── Image processing ────────────────────
// Separable 5x5 Gaussian, kernel [1 4 6 4 1] / 16 per axis, edges clamped
static void gaussianBlur5(const uint8_t *src, uint8_t *dst) {
  for (int y = 0; y < FRAME_H; y++) {
    const uint8_t *row = src + y * FRAME_W;
    uint8_t *out = blurTmp + y * FRAME_W;
    for (int x = 0; x < FRAME_W; x++) {
      int xm2 = x < 2 ? 0 : x - 2, xm1 = x < 1 ? 0 : x - 1;
      int xp1 = x + 1 >= FRAME_W ? FRAME_W - 1 : x + 1, xp2 = x + 2 >= FRAME_W ? FRAME_W - 1 : x + 2;
      out[x] = (row[xm2] + 4 * row[xm1] + 6 * row[x] + 4 * row[xp1] + row[xp2] + 8) >> 4;
    }
  }
  for (int y = 0; y < FRAME_H; y++) {
    int ym2 = y < 2 ? 0 : y - 2, ym1 = y < 1 ? 0 : y - 1;
    int yp1 = y + 1 >= FRAME_H ? FRAME_H - 1 : y + 1, yp2 = y + 2 >= FRAME_H ? FRAME_H - 1 : y + 2;
    const uint8_t *r0 = blurTmp + ym2 * FRAME_W, *r1 = blurTmp + ym1 * FRAME_W, *r2 = blurTmp + y * FRAME_W;
    const uint8_t *r3 = blurTmp + yp1 * FRAME_W, *r4 = blurTmp + yp2 * FRAME_W;
    uint8_t *out = dst + y * FRAME_W;
    for (int x = 0; x < FRAME_W; x++) out[x] = (r0[x] + 4 * r1[x] + 6 * r2[x] + 4 * r3[x] + r4[x] + 8) >> 4;
  }
}

static float roiMean(const uint8_t *img, const Roi &r) {
  uint32_t sum = 0;
  for (int y = r.y; y < r.y + r.h; y++) {
    const uint8_t *row = img + y * FRAME_W;
    for (int x = r.x; x < r.x + r.w; x++) sum += row[x];
  }
  return (float)sum / (r.w * r.h);
}

static bool roiValid(const Roi &r) { return r.w > 0 && r.h > 0 && r.x + r.w <= FRAME_W && r.y + r.h <= FRAME_H; }

// Brightness correction: how much to shift the current (blurred) frame so the
// always-empty patch has the same mean as in the reference
static int brightnessOffset() {
  int offset = (int)lroundf(roiMean(reference, REF_PATCH) - roiMean(frameBlur, REF_PATCH));
  return constrain(offset, -MAX_BRIGHTNESS_OFFSET, MAX_BRIGHTNESS_OFFSET);
}

// Runs on frameBlur; returns true if any debounced slot state changed
static bool detectSlots() {
  int offset = brightnessOffset();

  const float tHigh = tHighPct / 100.0f, tLow = tLowPct / 100.0f;
  bool changed = false;

  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    const Roi &r = SLOT_ROIS[i];
    uint32_t changedPx = 0;
    for (int y = r.y; y < r.y + r.h; y++) {
      const uint8_t *cur = frameBlur + y * FRAME_W;
      const uint8_t *ref = reference + y * FRAME_W;
      for (int x = r.x; x < r.x + r.w; x++) {
        int v = cur[x] + offset;
        if (abs(v - ref[x]) > pixThresh) changedPx++;
      }
    }
    float ratio = (float)changedPx / (r.w * r.h);
    slotScore[i] = (uint8_t)constrain(lroundf(ratio * 100), 0, 100);

    // Hysteresis: between T_LOW and T_HIGH the previous state is kept
    bool candidate = slotOccupied[i];
    if (ratio > tHigh) candidate = true;
    else if (ratio < tLow) candidate = false;

    // Debounce: the new state must hold for DEBOUNCE_FRAMES consecutive frames
    if (candidate != slotOccupied[i]) {
      if (++slotPending[i] >= DEBOUNCE_FRAMES) {
        slotOccupied[i] = candidate;
        slotPending[i] = 0;
        changed = true;
      }
    } else {
      slotPending[i] = 0;
    }
  }

  static uint32_t lastLogMs = 0;
  if (changed || millis() - lastLogMs > 5000) {
    lastLogMs = millis();
    Serial.printf("[DET] offset=%+d", offset);
    for (uint8_t i = 0; i < NUM_SLOTS; i++)
      Serial.printf("  %c%u=%s %3u%%", ZONE_ID, i + 1, slotOccupied[i] ? "OCC " : "free", slotScore[i]);
    Serial.println(changed ? "  <- changed" : "");
  }
  return changed;
}

// ───────────────────────────── Calibration ─────────────────────────
static bool loadReference() {
  File f = SPIFFS.open(REF_PATH, "r");
  if (!f) return false;
  bool ok = f.size() == FRAME_PIXELS && f.read(reference, FRAME_PIXELS) == FRAME_PIXELS;
  f.close();
  if (ok) Serial.println("[CAL] reference loaded from SPIFFS");
  else Serial.println("[CAL] reference file has the wrong size, ignoring");
  return ok;
}

static bool saveReference() {
  File f = SPIFFS.open(REF_PATH, "w");
  if (!f) return false;
  bool ok = f.write(reference, FRAME_PIXELS) == FRAME_PIXELS;
  f.close();
  return ok;
}

static void startCalibration() {
  if (calibRequested) return;
  calibRequested = true;
  calibFramesDone = 0;
  memset(calibAcc, 0, FRAME_PIXELS * sizeof(uint16_t));
  digitalWrite(PIN_STATUS_LED, STATUS_LED_ON);  // solid while capturing
  Serial.println("[CAL] capturing empty reference...");
}

static void blinkStatusLed(uint8_t times) {
  ledBlinkToggles = times * 2;
  ledLastToggleMs = millis();
  digitalWrite(PIN_STATUS_LED, STATUS_LED_OFF);
}

static void sendConfig();

// Consumes one blurred frame; finishes after CALIB_FRAMES
static void calibrationStep() {
  for (int i = 0; i < FRAME_PIXELS; i++) calibAcc[i] += frameBlur[i];
  if (++calibFramesDone < CALIB_FRAMES) return;

  for (int i = 0; i < FRAME_PIXELS; i++) reference[i] = (calibAcc[i] + CALIB_FRAMES / 2) / CALIB_FRAMES;
  bool saved = saveReference();
  referenceReady = true;
  calibRequested = false;
  calibCount++;

  // Fresh start: everything is empty by definition
  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    slotOccupied[i] = false;
    slotPending[i] = 0;
    slotScore[i] = 0;
  }
  Serial.printf("[CAL] done (%u frames), %s\n", CALIB_FRAMES, saved ? "saved to SPIFFS" : "SPIFFS write FAILED");
  blinkStatusLed(3);
  lastSendMs = 0;  // push the reset state immediately
  sendConfig();
}

// ───────────────────────────── Settings (NVS) ──────────────────────
static void loadSettings() {
  prefs.begin("parking", true);
  pixThresh = prefs.getUChar("pix", DEFAULT_PIX_THRESH);
  tHighPct = prefs.getUChar("thigh", DEFAULT_T_HIGH_PCT);
  tLowPct = prefs.getUChar("tlow", DEFAULT_T_LOW_PCT);
  prefs.end();
  if (tLowPct >= tHighPct) {
    tHighPct = DEFAULT_T_HIGH_PCT;
    tLowPct = DEFAULT_T_LOW_PCT;
  }
  Serial.printf("[CFG] pix_thresh=%u t_high=%.2f t_low=%.2f\n", pixThresh, tHighPct / 100.0f, tLowPct / 100.0f);
}

static void saveSettings() {
  prefs.begin("parking", false);
  prefs.putUChar("pix", pixThresh);
  prefs.putUChar("thigh", tHighPct);
  prefs.putUChar("tlow", tLowPct);
  prefs.end();
}

// ───────────────────────────── ESP-NOW ─────────────────────────────
#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
#else
static void onEspNowRecv(const uint8_t *mac, const uint8_t *data, int len) {
#endif
  if (len == sizeof(command_msg_t) && data[0] == CMD_MAGIC) {
    portENTER_CRITICAL(&rxMux);
    memcpy(&rxCmd, data, sizeof(rxCmd));
    rxCmdPending = true;
    portEXIT_CRITICAL(&rxMux);
  }
}

static void setupEspNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] init failed, restarting");
    delay(1000);
    ESP.restart();
  }
  esp_now_register_recv_cb(onEspNowRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, 6);
  peer.channel = 0;  // follow the STA channel (= the AP's channel 1)
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) Serial.println("[ESP-NOW] add broadcast peer failed");
}

static void sendStatus() {
  parking_msg_t msg;
  msg.zone_id = ZONE_ID;
  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    msg.slots[i] = slotOccupied[i] ? 1 : 0;
    msg.scores[i] = slotScore[i];
  }
  msg.sequence = sequence++;
  esp_now_send(BROADCAST_MAC, (const uint8_t *)&msg, sizeof(msg));
  lastSendMs = millis();
}

static void setRoi(config_msg_t &c, uint8_t idx, const Roi &r) {
  c.roi[idx][0] = r.x;
  c.roi[idx][1] = r.y;
  c.roi[idx][2] = r.w;
  c.roi[idx][3] = r.h;
}

static void sendConfig() {
  config_msg_t c;
  c.magic = CONFIG_MAGIC;
  c.zone_id = ZONE_ID;
  c.pix_thresh = pixThresh;
  c.t_high_pct = tHighPct;
  c.t_low_pct = tLowPct;
  c.calibrated = referenceReady ? 1 : 0;
  c.calib_count = calibCount;
  for (uint8_t i = 0; i < NUM_SLOTS; i++) setRoi(c, i, SLOT_ROIS[i]);
  setRoi(c, NUM_SLOTS, REF_PATCH);
  esp_now_send(BROADCAST_MAC, (const uint8_t *)&c, sizeof(c));
  lastConfigMs = millis();
}

static void handleCommands() {
  command_msg_t cmd;
  bool have = false;
  portENTER_CRITICAL(&rxMux);
  if (rxCmdPending) {
    cmd = rxCmd;
    rxCmdPending = false;
    have = true;
  }
  portEXIT_CRITICAL(&rxMux);
  if (!have || cmd.cmd_id == lastCmdId) return;  // the controller sends every command 3x
  lastCmdId = cmd.cmd_id;

  switch (cmd.cmd) {
    case CMD_CALIBRATE:
      Serial.println("[CMD] calibrate (from dashboard)");
      startCalibration();
      break;
    case CMD_SETTINGS:
      if (cmd.pix_thresh < 10 || cmd.pix_thresh > 80 || cmd.t_low_pct >= cmd.t_high_pct) {
        Serial.println("[CMD] settings rejected (out of range)");
        break;
      }
      pixThresh = cmd.pix_thresh;
      tHighPct = cmd.t_high_pct;
      tLowPct = cmd.t_low_pct;
      saveSettings();
      Serial.printf("[CMD] settings: pix_thresh=%u t_high=%.2f t_low=%.2f\n", pixThresh, tHighPct / 100.0f,
                    tLowPct / 100.0f);
      sendConfig();
      break;
  }
}

// ───────────────────────────── MJPEG stream ────────────────────────
#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static void drawRect(uint8_t *img, const Roi &r, uint8_t color, int thickness, bool dashed) {
  for (int t = 0; t < thickness; t++) {
    int x0 = r.x + t, y0 = r.y + t, x1 = r.x + r.w - 1 - t, y1 = r.y + r.h - 1 - t;
    if (x0 > x1 || y0 > y1) return;
    for (int x = x0; x <= x1; x++) {
      if (dashed && (x / 4) % 2) continue;
      img[y0 * FRAME_W + x] = color;
      img[y1 * FRAME_W + x] = color;
    }
    for (int y = y0; y <= y1; y++) {
      if (dashed && (y / 4) % 2) continue;
      img[y * FRAME_W + x0] = color;
      img[y * FRAME_W + x1] = color;
    }
  }
}

// Builds the requested stream view, encodes it as JPEG and publishes it for the
// stream handler. `blurred` says whether frameBlur already holds this frame.
static void publishStreamFrame(const uint8_t *gray, bool blurred) {
  uint8_t mode = referenceReady ? streamMode : STREAM_RAW;
  const uint8_t *src = gray;

  if (mode != STREAM_RAW) {
    if (!blurred) gaussianBlur5(gray, frameBlur);
    int offset = brightnessOffset();
    for (int i = 0; i < FRAME_PIXELS; i++) {
      int d = abs(frameBlur[i] + offset - reference[i]);
      overlay[i] = mode == STREAM_MASK ? (d > pixThresh ? 255 : 0) : (uint8_t)min(255, d * DIFF_GAIN);
    }
    src = overlay;
  }

  if (streamOverlay) {
    if (src != overlay) {
      memcpy(overlay, gray, FRAME_PIXELS);
      src = overlay;
    }
    // Mid-grey reads on black (diff/mask) and on the camera image alike
    uint8_t color = mode == STREAM_RAW ? 255 : 140;
    for (uint8_t i = 0; i < NUM_SLOTS; i++)
      drawRect(overlay, SLOT_ROIS[i], color, slotOccupied[i] ? 3 : 1, false);  // occupied: thick
    drawRect(overlay, REF_PATCH, color, 1, true);                               // reference patch: dashed
  }

  uint8_t *out = nullptr;
  size_t outLen = 0;
  if (!fmt2jpg((uint8_t *)src, FRAME_PIXELS, FRAME_W, FRAME_H, PIXFORMAT_GRAYSCALE, STREAM_JPEG_QUALITY, &out,
               &outLen)) {
    Serial.println("[STREAM] JPEG encode failed");
    return;
  }
  xSemaphoreTake(jpgMutex, portMAX_DELAY);
  free(jpgBuf);
  jpgBuf = out;
  jpgLen = outLen;
  jpgSeq++;
  xSemaphoreGive(jpgMutex);
}

// One client per connection; runs inside the httpd task until the client disconnects
static esp_err_t streamHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store");
  httpd_resp_set_hdr(req, "X-Framerate", "10");

  // ?mode=raw|diff|mask&overlay=0|1 (defaults: raw with boxes)
  char query[64], val[12];
  uint8_t mode = STREAM_RAW;
  bool drawBoxes = true;
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    if (httpd_query_key_value(query, "mode", val, sizeof(val)) == ESP_OK)
      mode = !strcmp(val, "diff") ? STREAM_DIFF : !strcmp(val, "mask") ? STREAM_MASK : STREAM_RAW;
    if (httpd_query_key_value(query, "overlay", val, sizeof(val)) == ESP_OK) drawBoxes = val[0] != '0';
  }
  streamMode = mode;
  streamOverlay = drawBoxes;

  streamClients++;
  Serial.printf("[STREAM] client connected (mode %u)\n", mode);
  uint8_t *local = nullptr;
  size_t localCap = 0;
  uint32_t lastSeq = 0;
  uint32_t waitedMs = 0;
  esp_err_t res = ESP_OK;
  char part[64];

  while (res == ESP_OK) {
    size_t len = 0;
    xSemaphoreTake(jpgMutex, portMAX_DELAY);
    if (jpgBuf && jpgSeq != lastSeq) {
      if (jpgLen > localCap) {
        free(local);
        localCap = jpgLen + 4096;
        local = (uint8_t *)ps_malloc(localCap);
      }
      if (local) {
        memcpy(local, jpgBuf, jpgLen);
        len = jpgLen;
        lastSeq = jpgSeq;
      }
    }
    xSemaphoreGive(jpgMutex);
    if (localCap && !local) {
      res = ESP_ERR_NO_MEM;
      break;
    }

    if (!len) {
      vTaskDelay(pdMS_TO_TICKS(15));
      // No new frame for 10 s: the camera loop is stuck, drop the client so it can retry
      if ((waitedMs += 15) > 10000) res = ESP_FAIL;
      continue;
    }
    waitedMs = 0;

    size_t hlen = snprintf(part, sizeof(part), STREAM_PART, (unsigned)len);
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, part, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)local, len);
  }

  free(local);
  streamClients--;
  Serial.println("[STREAM] client disconnected");
  return res;
}

static esp_err_t indexHandler(httpd_req_t *req) {
  static const char html[] =
      "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
      "<title>ESP32-CAM</title><style>body{background:#0D0D0D;color:#fff;font-family:system-ui;text-align:center}"
      "img{max-width:100%;border:1px solid #2A2A2A;border-radius:14px;image-rendering:pixelated}a{color:#fff}</style></head>"
      "<body><h3>Smart Parking camera (zone A)</h3><img id=v src='/stream'>"
      "<p><a href='#' onclick=\"v.src='/stream?mode=raw'\">raw</a> &middot; "
      "<a href='#' onclick=\"v.src='/stream?mode=diff'\">difference</a> &middot; "
      "<a href='#' onclick=\"v.src='/stream?mode=mask'\">mask</a></p>"
      "<p style='color:#888'>Thick boxes = occupied, thin = free, dashed = brightness reference patch</p>"
      "</body></html>";
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

static void startStreamServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = STREAM_PORT;
  config.ctrl_port = 32769;
  config.stack_size = 8192;
  config.lru_purge_enable = true;
  config.send_wait_timeout = 5;  // a vanished client ends the stream loop
  config.recv_wait_timeout = 5;

  httpd_uri_t streamUri = {};
  streamUri.uri = "/stream";
  streamUri.method = HTTP_GET;
  streamUri.handler = streamHandler;

  httpd_uri_t indexUri = {};
  indexUri.uri = "/";
  indexUri.method = HTTP_GET;
  indexUri.handler = indexHandler;

  if (httpd_start(&streamHttpd, &config) == ESP_OK) {
    httpd_register_uri_handler(streamHttpd, &streamUri);
    httpd_register_uri_handler(streamHttpd, &indexUri);
    Serial.printf("[STREAM] http://%s:%u/stream\n", CAM_IP.toString().c_str(), STREAM_PORT);
  } else {
    Serial.println("[STREAM] failed to start HTTP server");
  }
}

// ───────────────────────────── Wi-Fi ───────────────────────────────
static void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // power save drops ESP-NOW packets and stalls the stream
  WiFi.config(CAM_IP, GATEWAY_IP, SUBNET);
  WiFi.setAutoReconnect(true);
  esp_wifi_set_channel(AP_CHANNEL, WIFI_SECOND_CHAN_NONE);
  WiFi.begin(AP_SSID, AP_PASS, AP_CHANNEL);  // pinning the channel keeps ESP-NOW on channel 1 while connecting
  Serial.printf("[WiFi] joining \"%s\" as %s (MAC %s)\n", AP_SSID, CAM_IP.toString().c_str(),
                WiFi.macAddress().c_str());
}

// ───────────────────────────── Inputs & LED ────────────────────────
static void pollButton(uint32_t now) {
  static bool lastRaw = HIGH, stable = HIGH;
  static uint32_t changedMs = 0;
  bool raw = digitalRead(PIN_CALIB_BTN);
  if (raw != lastRaw) {
    lastRaw = raw;
    changedMs = now;
  }
  if (now - changedMs > 50 && raw != stable) {
    stable = raw;
    if (stable == LOW) {
      Serial.println("[BTN] calibration button pressed");
      if (aeLocked) startCalibration();
      else Serial.println("[BTN] still warming up, try again in a moment");
    }
  }
}

static void updateStatusLed(uint32_t now) {
  if (calibRequested) return;  // solid on during capture
  if (ledBlinkToggles) {
    if (now - ledLastToggleMs >= 150) {
      ledLastToggleMs = now;
      ledBlinkToggles--;
      digitalWrite(PIN_STATUS_LED, (ledBlinkToggles % 2) ? STATUS_LED_ON : STATUS_LED_OFF);
    }
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_STATUS_LED, (now / 250) % 2 ? STATUS_LED_ON : STATUS_LED_OFF);  // fast blink: no Wi-Fi
  } else if (!referenceReady) {
    digitalWrite(PIN_STATUS_LED, (now / 1000) % 2 ? STATUS_LED_ON : STATUS_LED_OFF);  // slow blink: not calibrated
  } else {
    digitalWrite(PIN_STATUS_LED, STATUS_LED_OFF);
  }
}

static void *allocPsram(size_t bytes) {
  void *p = ps_malloc(bytes);
  if (!p) {
    Serial.printf("[MEM] failed to allocate %u bytes of PSRAM. Is PSRAM enabled?\n", (unsigned)bytes);
    delay(3000);
    ESP.restart();
  }
  return p;
}

// ───────────────────────────── Setup / loop ────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.printf("\n=== Smart Parking camera v%s ===\n", FIRMWARE_VERSION);

  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, STATUS_LED_OFF);
  pinMode(PIN_FLASH_LED, OUTPUT);
  digitalWrite(PIN_FLASH_LED, LOW);
  pinMode(PIN_CALIB_BTN, INPUT_PULLUP);

  for (uint8_t i = 0; i < NUM_SLOTS; i++)
    if (!roiValid(SLOT_ROIS[i])) Serial.printf("[CFG] ROI A%u is outside the 320x240 frame!\n", i + 1);
  if (!roiValid(REF_PATCH)) Serial.println("[CFG] REF_PATCH is outside the 320x240 frame!");

  if (!psramFound()) Serial.println("[MEM] PSRAM not found, enable it under Tools > PSRAM");
  blurTmp = (uint8_t *)allocPsram(FRAME_PIXELS);
  frameBlur = (uint8_t *)allocPsram(FRAME_PIXELS);
  reference = (uint8_t *)allocPsram(FRAME_PIXELS);
  calibAcc = (uint16_t *)allocPsram(FRAME_PIXELS * sizeof(uint16_t));
  overlay = (uint8_t *)allocPsram(FRAME_PIXELS);
  jpgMutex = xSemaphoreCreateMutex();

  if (!initCamera()) {
    Serial.println("[CAM] check the ribbon cable and power (5 V 2 A). Restarting...");
    delay(3000);
    ESP.restart();
  }

  if (!SPIFFS.begin(true)) Serial.println("[SPIFFS] mount failed, calibration will not persist");
  else referenceReady = loadReference();

  loadSettings();
  setupWifi();
  setupEspNow();
  startStreamServer();

  if (!referenceReady)
    Serial.println("[CAL] no reference yet: one will be captured automatically after warm-up (lot must be empty)");
}

void loop() {
  uint32_t now = millis();

  pollButton(now);
  handleCommands();
  updateStatusLed(now);

  if (!aeLocked && now - cameraStartMs >= AE_WARMUP_MS) {
    lockAutoExposure();
    if (!referenceReady) startCalibration();  // first boot: assume the lot is empty
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] frame capture failed");
    delay(50);
    return;
  }
  if (fb->format != PIXFORMAT_GRAYSCALE || fb->width != FRAME_W || fb->height != FRAME_H ||
      fb->len < FRAME_PIXELS) {
    Serial.printf("[CAM] unexpected frame %ux%u fmt=%d len=%u\n", fb->width, fb->height, fb->format,
                  (unsigned)fb->len);
    esp_camera_fb_return(fb);
    delay(100);
    return;
  }

  now = millis();
  bool doCalib = calibRequested && aeLocked;
  bool doDetect = !doCalib && referenceReady && aeLocked && now - lastDetectMs >= DETECT_INTERVAL_MS;

  if (doCalib || doDetect) gaussianBlur5(fb->buf, frameBlur);
  if (doCalib) calibrationStep();

  bool changed = false;
  if (doDetect) {
    lastDetectMs = now;
    changed = detectSlots();
  }

  if (streamClients > 0 && now - lastStreamEncodeMs >= STREAM_FRAME_MS) {
    lastStreamEncodeMs = now;
    publishStreamFrame(fb->buf, doCalib || doDetect);
  }
  esp_camera_fb_return(fb);

  // Status every 500 ms (after each detection) and immediately on change
  if (changed || doDetect || millis() - lastSendMs >= SEND_INTERVAL_MS) sendStatus();
  if (millis() - lastConfigMs >= CONFIG_INTERVAL_MS) sendConfig();

  delay(1);
}
