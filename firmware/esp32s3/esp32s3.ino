/*
 * Smart Parking System — ESP32-S3 main controller
 * ------------------------------------------------
 *  - Wi-Fi Soft-AP "SmartParking" / "park1234" on channel 1 (IP 192.168.4.1)
 *  - Receives slot states from the ESP32-CAM over ESP-NOW
 *  - Drives 4 green + 4 red slot LEDs, an SSD1306 OLED and the SG90 entry gate
 *  - Serves the React dashboard from SPIFFS and a JSON API:
 *        GET  /api/status     live slot states, gate, camera health
 *        GET  /api/history    per-slot occupied time + change counts
 *        GET  /api/config     static info, thresholds and ROIs reported by the camera
 *        POST /api/calibrate  relay "recalibrate" to the camera
 *        POST /api/settings   relay {"pix_thresh","t_high","t_low"} to the camera
 *        POST /api/time       {"epoch": <unix seconds>} sets the clock (no RTC on board)
 *        GET  /api/events     ?since=<seq> event log for the timeline
 *        GET  /api/tickets    recent parking tickets;  GET /api/ticket?id=1001
 *
 * Arduino IDE 2.x, board "ESP32S3 Dev Module", ESP32 core 2.0.x or 3.x
 *   Tools > Partition Scheme: any scheme with SPIFFS, e.g.
 *     "Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)"   or
 *     "8M with spiffs (3MB APP/1.5MB SPIFFS)"
 *   Tools > USB CDC On Boot: Enabled (to see Serial over the native USB port)
 *
 * Libraries (Library Manager):
 *   ESPAsyncWebServer + AsyncTCP   (by ESP32Async — required for core 3.x)
 *   ArduinoJson 7.x                (by Benoit Blanchon)
 *   Adafruit SSD1306 + Adafruit GFX
 *   ESP32Servo                     (by Kevin Harrington / madhephaestus)
 */

#include <Arduino.h>
#include <esp_arduino_version.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <SPIFFS.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <sys/time.h>
#include <time.h>

#if ARDUINOJSON_VERSION_MAJOR < 7
#error "This sketch needs ArduinoJson 7.x (Library Manager > ArduinoJson)"
#endif

#define FIRMWARE_VERSION "1.1.0"

// ───────────────────────────── Network ─────────────────────────────
static const char *AP_SSID = "SmartParking";
static const char *AP_PASS = "park1234";
static const uint8_t AP_CHANNEL = 1;       // ESP-NOW and the Soft-AP share the radio: must match the camera
static const uint8_t AP_MAX_CLIENTS = 8;   // camera + phones/laptops
static const IPAddress AP_IP(192, 168, 4, 1);
static const IPAddress AP_MASK(255, 255, 255, 0);
static const char *CAM_STREAM_URL = "http://192.168.4.2:81/stream";

// ───────────────────────────── Pins ────────────────────────────────
static const uint8_t PIN_OLED_SDA = 8;
static const uint8_t PIN_OLED_SCL = 9;
static const uint8_t PIN_SERVO = 16;
static const uint8_t PIN_IR = 17;
static const uint8_t NUM_SLOTS = 4;
static const uint8_t LED_GREEN[NUM_SLOTS] = {1, 3, 5, 7};
static const uint8_t LED_RED[NUM_SLOTS] = {2, 4, 6, 15};

// Most IR obstacle modules pull OUT low when something is in front of them
#define IR_ACTIVE_LEVEL LOW

// ───────────────────────────── Behaviour ───────────────────────────
static const char ZONE_ID = 'A';
static const int SERVO_CLOSED_DEG = 0;
static const int SERVO_OPEN_DEG = 90;
static const uint32_t GATE_CLOSE_DELAY_MS = 5000;  // gate closes 5 s after the IR sensor clears
static const uint32_t IR_DEBOUNCE_MS = 50;
static const uint32_t CAM_TIMEOUT_MS = 3000;       // cam_online=false after 3 s of silence
static const uint32_t DISPLAY_INTERVAL_MS = 500;
static const uint8_t CMD_REPEATS = 3;              // broadcasts are unacknowledged, so send each command 3x
static const uint32_t CMD_REPEAT_GAP_MS = 40;
static const size_t MAX_BODY = 512;

// Parking fee charged on each ticket (rounded up to whole minutes)
static const uint16_t FEE_PER_HOUR = 20;
static const uint16_t FEE_MINIMUM = 10;
static const char *FEE_CURRENCY = "INR";

#define OLED_WIDTH 128
#define OLED_HEIGHT 64
#define OLED_ADDR 0x3C

// ───────────────────── ESP-NOW protocol (must match esp32cam.ino) ─────────────────────
typedef struct __attribute__((packed)) {
  uint8_t zone_id;    // 'A' = 0x41
  uint8_t slots[4];   // 1 = occupied, 0 = empty
  uint8_t scores[4];  // detection ratio x 100 (0-100)
  uint8_t sequence;   // rolling counter
} parking_msg_t;

#define CMD_MAGIC 0xC5
enum : uint8_t { CMD_CALIBRATE = 1, CMD_SETTINGS = 2 };
typedef struct __attribute__((packed)) {
  uint8_t magic;       // CMD_MAGIC
  uint8_t cmd;         // CMD_*
  uint8_t cmd_id;      // camera ignores repeats of the same id
  uint8_t pix_thresh;  // 10-80
  uint8_t t_high_pct;  // T_HIGH x 100
  uint8_t t_low_pct;   // T_LOW x 100
} command_msg_t;

#define CONFIG_MAGIC 0xCF
typedef struct __attribute__((packed)) {
  uint8_t magic;  // CONFIG_MAGIC
  uint8_t zone_id;
  uint8_t pix_thresh;
  uint8_t t_high_pct;
  uint8_t t_low_pct;
  uint8_t calibrated;   // 1 if an empty reference exists
  uint8_t calib_count;  // increments after each finished calibration
  uint16_t roi[NUM_SLOTS + 1][4];  // x, y, w, h for slots 1-4, then the brightness reference patch
} config_msg_t;

static_assert(sizeof(parking_msg_t) == 10, "parking_msg_t layout");
static_assert(sizeof(command_msg_t) == 6, "command_msg_t layout");
static_assert(sizeof(config_msg_t) == 47, "config_msg_t layout");

static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ───────────────────────────── State ───────────────────────────────
struct SlotState {
  bool occupied;
  uint8_t score;
  uint32_t sinceMs;          // millis() when it became occupied
  uint32_t totalOccupiedMs;  // completed occupied periods
  uint32_t changeCount;
};

struct SharedState {
  SlotState slots[NUM_SLOTS];
  bool haveCamData;
  uint32_t lastCamMsgMs;
  uint8_t lastSeq;
  bool haveCamConfig;
  config_msg_t camConfig;
  bool gateOpen;
  bool irActive;
  uint32_t carsEntered;
  bool everEntered;
  uint32_t lastEntryMs;
  bool timeSynced;
};

// Everything the web server (async_tcp task) reads is guarded by stateMutex
static SharedState state;
static SemaphoreHandle_t stateMutex;

struct Lock {
  Lock() { xSemaphoreTake(stateMutex, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(stateMutex); }
};

// ESP-NOW callback (Wi-Fi task) -> loop() hand-off
static portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;
static parking_msg_t rxStatus;
static volatile bool rxStatusPending = false;
static config_msg_t rxConfig;
static volatile bool rxConfigPending = false;

// Web handlers -> loop() command queue (one pending command at a time)
static command_msg_t pendingCmd;
static uint8_t cmdRepeatsLeft = 0;
static uint32_t lastCmdSendMs = 0;
static uint8_t nextCmdId = 1;

static Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool displayOk = false;
static Servo gateServo;
static AsyncWebServer server(80);

// Event log and tickets (declared here so Arduino's generated prototypes can see the types)
enum : uint8_t {
  EV_SLOT_OCCUPIED = 1,
  EV_SLOT_FREE,
  EV_GATE_OPEN,
  EV_GATE_CLOSE,
  EV_ENTRY_DENIED,
  EV_TICKET_ISSUED,
  EV_TICKET_CLOSED,
  EV_CAM_ONLINE,
  EV_CAM_OFFLINE,
  EV_CALIBRATED,
  EV_SETTINGS,
};
static const char *EVENT_NAMES[] = {"",           "slot_occupied", "slot_free",  "gate_open",  "gate_close", "entry_denied",
                                    "ticket_issued", "ticket_closed", "cam_online", "cam_offline", "calibrated", "settings"};

struct Event {
  uint32_t seq;
  uint32_t ms;
  uint8_t type;
  int8_t slot;     // -1 if not slot related
  uint16_t value;  // score, ticket id or fee depending on type
};
static const uint8_t EVENT_CAP = 120;
static Event events[EVENT_CAP];
static uint32_t eventSeq = 0;  // seq of the newest event (0 = none)

enum : uint8_t { TICKET_ENTERED, TICKET_PARKED, TICKET_CLOSED };
static const char *TICKET_STATES[] = {"entered", "parked", "closed"};

struct Ticket {
  uint16_t id;
  int8_t assignedSlot;  // bay suggested at the gate
  int8_t slot;          // bay actually used, -1 until parked
  uint8_t state;
  uint32_t entryMs, parkedMs, exitMs;
  uint16_t fee;
};
static const uint8_t TICKET_CAP = 16;
static Ticket tickets[TICKET_CAP];
static uint16_t ticketCount = 0;  // tickets issued since boot
static const uint16_t FIRST_TICKET_ID = 1001;

// ───────────────────────────── Helpers ─────────────────────────────
static bool camOnlineLocked(uint32_t now) {
  return state.haveCamData && (now - state.lastCamMsgMs) < CAM_TIMEOUT_MS;
}

static uint8_t freeCountLocked() {
  uint8_t n = 0;
  for (uint8_t i = 0; i < NUM_SLOTS; i++) n += state.slots[i].occupied ? 0 : 1;
  return n;
}

static int firstFreeSlotLocked() {
  for (uint8_t i = 0; i < NUM_SLOTS; i++)
    if (!state.slots[i].occupied) return i;
  return -1;
}

static void slotId(uint8_t i, char *out) { snprintf(out, 4, "%c%u", ZONE_ID, i + 1); }

// Converts a millis() instant into epoch seconds if the browser has set our clock,
// otherwise into seconds since boot.
static uint32_t toTimestampLocked(uint32_t atMs, uint32_t now) {
  if (state.timeSynced) return (uint32_t)time(nullptr) - (now - atMs) / 1000;
  return atMs / 1000;
}

static void guidanceLocked(char *buf, size_t len) {
  int f = firstFreeSlotLocked();
  if (!state.haveCamData) snprintf(buf, len, "Waiting for camera");
  else if (f < 0) snprintf(buf, len, "Parking Full");
  else snprintf(buf, len, "Go to Slot %c%d", ZONE_ID, f + 1);
}

// ───────────────────────────── Events & tickets ────────────────────
// Ring buffer of everything that happens, served at /api/events for the
// dashboard timeline. Timestamps are millis() since boot.

static void logEventLocked(uint8_t type, int8_t slot, uint16_t value) {
  eventSeq++;
  Event &e = events[(eventSeq - 1) % EVENT_CAP];
  e.seq = eventSeq;
  e.ms = millis();
  e.type = type;
  e.slot = slot;
  e.value = value;
}

// A ticket is issued when the gate opens, bound to the bay the car actually
// parks in, and closed (with a fee) when that bay becomes free again.

static uint16_t computeFee(uint32_t durationMs) {
  uint32_t minutes = (durationMs + 59999) / 60000;
  uint32_t fee = (minutes * FEE_PER_HOUR + 59) / 60;
  return fee < FEE_MINIMUM ? FEE_MINIMUM : fee;
}

static Ticket *findTicketLocked(uint16_t id) {
  if (id < FIRST_TICKET_ID || id >= FIRST_TICKET_ID + ticketCount) return nullptr;
  uint16_t index = id - FIRST_TICKET_ID;
  if (ticketCount - index > TICKET_CAP) return nullptr;  // overwritten
  return &tickets[index % TICKET_CAP];
}

static void issueTicketLocked(uint32_t now) {
  Ticket &t = tickets[ticketCount % TICKET_CAP];
  t.id = FIRST_TICKET_ID + ticketCount;
  t.assignedSlot = firstFreeSlotLocked();
  t.slot = -1;
  t.state = TICKET_ENTERED;
  t.entryMs = now;
  t.parkedMs = t.exitMs = 0;
  t.fee = 0;
  ticketCount++;
  logEventLocked(EV_TICKET_ISSUED, t.assignedSlot, t.id);
  Serial.printf("[TICKET] #%u issued, go to %c%d\n", t.id, ZONE_ID, t.assignedSlot + 1);
}

// Oldest ticket still waiting to park, preferring one that was sent to this bay
static Ticket *unparkedTicketForLocked(int8_t slot) {
  Ticket *fallback = nullptr;
  uint16_t first = ticketCount > TICKET_CAP ? ticketCount - TICKET_CAP : 0;
  for (uint16_t i = first; i < ticketCount; i++) {
    Ticket &t = tickets[i % TICKET_CAP];
    if (t.state != TICKET_ENTERED) continue;
    if (t.assignedSlot == slot) return &t;
    if (!fallback) fallback = &t;
  }
  return fallback;
}

static void onSlotOccupiedLocked(int8_t slot, uint32_t now) {
  Ticket *t = unparkedTicketForLocked(slot);
  if (!t) return;
  t->state = TICKET_PARKED;
  t->slot = slot;
  t->parkedMs = now;
}

static void onSlotFreedLocked(int8_t slot, uint32_t now) {
  uint16_t first = ticketCount > TICKET_CAP ? ticketCount - TICKET_CAP : 0;
  for (uint16_t i = first; i < ticketCount; i++) {
    Ticket &t = tickets[i % TICKET_CAP];
    if (t.state != TICKET_PARKED || t.slot != slot) continue;
    t.state = TICKET_CLOSED;
    t.exitMs = now;
    t.fee = computeFee(now - t.entryMs);
    logEventLocked(EV_TICKET_CLOSED, slot, t.id);
    Serial.printf("[TICKET] #%u closed, fee %u %s\n", t.id, t.fee, FEE_CURRENCY);
    return;
  }
}

// ───────────────────────────── ESP-NOW ─────────────────────────────
#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
#else
static void onEspNowRecv(const uint8_t *mac, const uint8_t *data, int len) {
#endif
  if (len == sizeof(parking_msg_t) && data[0] == (uint8_t)ZONE_ID) {
    portENTER_CRITICAL(&rxMux);
    memcpy(&rxStatus, data, sizeof(rxStatus));
    rxStatusPending = true;
    portEXIT_CRITICAL(&rxMux);
  } else if (len == sizeof(config_msg_t) && data[0] == CONFIG_MAGIC) {
    portENTER_CRITICAL(&rxMux);
    memcpy(&rxConfig, data, sizeof(rxConfig));
    rxConfigPending = true;
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
  peer.channel = AP_CHANNEL;
  peer.ifidx = WIFI_IF_AP;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) Serial.println("[ESP-NOW] add broadcast peer failed");
}

// Called from web handlers; loop() does the actual (repeated) sending
static void queueCommand(uint8_t cmd, uint8_t pix, uint8_t tHighPct, uint8_t tLowPct) {
  Lock l;
  pendingCmd.magic = CMD_MAGIC;
  pendingCmd.cmd = cmd;
  pendingCmd.cmd_id = nextCmdId++;
  if (nextCmdId == 0) nextCmdId = 1;
  pendingCmd.pix_thresh = pix;
  pendingCmd.t_high_pct = tHighPct;
  pendingCmd.t_low_pct = tLowPct;
  cmdRepeatsLeft = CMD_REPEATS;
  lastCmdSendMs = 0;
}

static void serviceCommands(uint32_t now) {
  command_msg_t msg;
  {
    Lock l;
    if (cmdRepeatsLeft == 0 || (lastCmdSendMs && now - lastCmdSendMs < CMD_REPEAT_GAP_MS)) return;
    msg = pendingCmd;
    cmdRepeatsLeft--;
    lastCmdSendMs = now;
  }
  esp_err_t err = esp_now_send(BROADCAST_MAC, (const uint8_t *)&msg, sizeof(msg));
  if (err != ESP_OK) Serial.printf("[ESP-NOW] send cmd %u failed: %d\n", msg.cmd, err);
}

// Applies packets received by the callback; returns true if any slot changed
static bool processEspNow(uint32_t now) {
  bool changed = false;
  parking_msg_t st;
  config_msg_t cfg;
  bool haveSt = false, haveCfg = false;

  portENTER_CRITICAL(&rxMux);
  if (rxStatusPending) {
    st = rxStatus;
    rxStatusPending = false;
    haveSt = true;
  }
  if (rxConfigPending) {
    cfg = rxConfig;
    rxConfigPending = false;
    haveCfg = true;
  }
  portEXIT_CRITICAL(&rxMux);

  if (haveSt) {
    Lock l;
    for (uint8_t i = 0; i < NUM_SLOTS; i++) {
      SlotState &s = state.slots[i];
      bool occ = st.slots[i] != 0;
      s.score = st.scores[i] > 100 ? 100 : st.scores[i];
      if (!state.haveCamData) {
        // First packet after boot: adopt the state without counting it as a change
        s.occupied = occ;
        s.sinceMs = occ ? now : 0;
        changed = true;
      } else if (occ != s.occupied) {
        if (s.occupied) s.totalOccupiedMs += now - s.sinceMs;
        s.occupied = occ;
        s.sinceMs = occ ? now : 0;
        s.changeCount++;
        changed = true;
        logEventLocked(occ ? EV_SLOT_OCCUPIED : EV_SLOT_FREE, i, s.score);
        if (occ) onSlotOccupiedLocked(i, now);
        else onSlotFreedLocked(i, now);
      }
    }
    if (!state.haveCamData) Serial.println("[CAM] first status packet received");
    state.haveCamData = true;
    state.lastCamMsgMs = now;
    state.lastSeq = st.sequence;
  }

  if (haveCfg) {
    Lock l;
    if (state.haveCamConfig && cfg.calib_count != state.camConfig.calib_count)
      logEventLocked(EV_CALIBRATED, -1, cfg.calib_count);
    if (!state.haveCamConfig || cfg.calib_count != state.camConfig.calib_count)
      Serial.printf("[CAM] config: pix=%u high=%u%% low=%u%% calibrated=%u count=%u\n", cfg.pix_thresh,
                    cfg.t_high_pct, cfg.t_low_pct, cfg.calibrated, cfg.calib_count);
    state.camConfig = cfg;
    state.haveCamConfig = true;
  }

  if (changed) {
    Lock l;
    Serial.print("[SLOTS]");
    for (uint8_t i = 0; i < NUM_SLOTS; i++)
      Serial.printf(" %c%u=%s(%u)", ZONE_ID, i + 1, state.slots[i].occupied ? "OCC" : "free", state.slots[i].score);
    Serial.println();
  }
  return changed;
}

// ───────────────────────────── LEDs ────────────────────────────────
static void updateLeds(uint32_t now) {
  bool occ[NUM_SLOTS];
  bool online, haveData;
  {
    Lock l;
    online = camOnlineLocked(now);
    haveData = state.haveCamData;
    for (uint8_t i = 0; i < NUM_SLOTS; i++) occ[i] = state.slots[i].occupied;
  }
  bool blink = (now / 500) % 2;
  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    if (online) {
      digitalWrite(LED_GREEN[i], occ[i] ? LOW : HIGH);
      digitalWrite(LED_RED[i], occ[i] ? HIGH : LOW);
    } else if (haveData) {
      // Camera lost: blink the red LEDs so the fault is obvious
      digitalWrite(LED_GREEN[i], LOW);
      digitalWrite(LED_RED[i], blink ? HIGH : LOW);
    } else {
      // Booting / waiting for the first packet: slow green chase
      digitalWrite(LED_GREEN[i], ((now / 300) % NUM_SLOTS) == i ? HIGH : LOW);
      digitalWrite(LED_RED[i], LOW);
    }
  }
}

// ───────────────────────────── Gate ────────────────────────────────
static void setGate(bool open) {
  gateServo.write(open ? SERVO_OPEN_DEG : SERVO_CLOSED_DEG);
  Serial.printf("[GATE] %s\n", open ? "OPEN" : "CLOSED");
}

static void updateGate(uint32_t now) {
  static bool irRaw = false;
  static uint32_t irRawChangedMs = 0;
  static uint32_t irClearSinceMs = 0;

  bool raw = digitalRead(PIN_IR) == IR_ACTIVE_LEVEL;
  if (raw != irRaw) {
    irRaw = raw;
    irRawChangedMs = now;
  }

  bool open = false, close = false;
  {
    Lock l;
    if (now - irRawChangedMs >= IR_DEBOUNCE_MS && irRaw != state.irActive) {
      state.irActive = irRaw;
      if (!irRaw) irClearSinceMs = now;
      else if (!state.gateOpen && freeCountLocked() == 0) logEventLocked(EV_ENTRY_DENIED, -1, 0);
    }

    if (!state.gateOpen) {
      // A car is waiting and there is room (a car waiting while full is let in as soon as a slot frees up)
      if (state.irActive && freeCountLocked() > 0) {
        state.gateOpen = true;
        state.carsEntered++;
        state.everEntered = true;
        state.lastEntryMs = now;
        open = true;
        logEventLocked(EV_GATE_OPEN, -1, 0);
        issueTicketLocked(now);
      }
    } else if (!state.irActive && now - irClearSinceMs >= GATE_CLOSE_DELAY_MS) {
      state.gateOpen = false;
      close = true;
      logEventLocked(EV_GATE_CLOSE, -1, 0);
    }
  }
  if (open) setGate(true);
  if (close) setGate(false);
}

// ───────────────────────────── OLED ────────────────────────────────
static void updateDisplay(uint32_t now) {
  if (!displayOk) return;

  uint8_t freeCount;
  int firstFree;
  bool online, haveData, gateOpen;
  {
    Lock l;
    freeCount = freeCountLocked();
    firstFree = firstFreeSlotLocked();
    online = camOnlineLocked(now);
    haveData = state.haveCamData;
    gateOpen = state.gateOpen;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("SMART PARKING");
  display.setCursor(OLED_WIDTH - 6 * 6, 0);
  display.printf("ZONE %c", ZONE_ID);
  display.drawFastHLine(0, 10, OLED_WIDTH, SSD1306_WHITE);

  display.setTextSize(2);
  if (!haveData) {
    display.setTextSize(1);
    display.setCursor(0, 22);
    display.print("Waiting for camera...");
    display.setCursor(0, 36);
    display.printf("WiFi: %s", AP_SSID);
  } else if (freeCount == 0) {
    display.setCursor(0, 16);
    display.printf("Free: 0/%u", NUM_SLOTS);
    display.setTextSize(3);
    display.setCursor(28, 34);
    display.print("FULL");
  } else {
    display.setCursor(0, 16);
    display.printf("Free: %u/%u", freeCount, NUM_SLOTS);
    display.setCursor(0, 36);
    display.printf("Go to %c%d", ZONE_ID, firstFree + 1);
  }

  display.setTextSize(1);
  display.setCursor(0, 56);
  display.printf("Gate:%s", gateOpen ? "OPEN  " : "CLOSED");
  display.setCursor(OLED_WIDTH - 6 * 7, 56);
  display.print(online ? "Cam:OK " : "Cam:OFF");
  display.display();
}

// ───────────────────────────── HTTP API ────────────────────────────
static void sendJson(AsyncWebServerRequest *req, JsonDocument &doc, int code) {
  AsyncResponseStream *res = req->beginResponseStream("application/json");
  res->setCode(code);
  res->addHeader("Cache-Control", "no-store");
  serializeJson(doc, *res);
  req->send(res);
}

static void sendError(AsyncWebServerRequest *req, int code, const char *msg) {
  JsonDocument doc;
  doc["ok"] = false;
  doc["error"] = msg;
  sendJson(req, doc, code);
}

static void sendOk(AsyncWebServerRequest *req) {
  JsonDocument doc;
  doc["ok"] = true;
  sendJson(req, doc, 200);
}

// Accumulates small request bodies into req->_tempObject (freed by the library)
static void collectBody(AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index, size_t total) {
  if (total > MAX_BODY) return;
  if (index == 0) req->_tempObject = calloc(total + 1, 1);
  if (req->_tempObject && index + len <= total) memcpy((uint8_t *)req->_tempObject + index, data, len);
}

static void handleStatus(AsyncWebServerRequest *req) {
  JsonDocument doc;
  uint32_t now = millis();
  {
    Lock l;
    bool online = camOnlineLocked(now);
    uint8_t freeCount = freeCountLocked();
    char buf[32];

    doc["zone"] = String(ZONE_ID);
    JsonArray arr = doc["slots"].to<JsonArray>();
    for (uint8_t i = 0; i < NUM_SLOTS; i++) {
      const SlotState &s = state.slots[i];
      JsonObject o = arr.add<JsonObject>();
      slotId(i, buf);
      o["id"] = buf;
      o["occupied"] = s.occupied;
      o["score"] = s.score;
      o["since"] = s.occupied ? toTimestampLocked(s.sinceMs, now) : 0;
      o["occupied_for_s"] = s.occupied ? (now - s.sinceMs) / 1000 : 0;
    }
    doc["free_count"] = freeCount;
    doc["total_slots"] = NUM_SLOTS;
    doc["gate_open"] = state.gateOpen;
    doc["cam_online"] = online;
    doc["uptime_s"] = now / 1000;
    guidanceLocked(buf, sizeof(buf));
    doc["guidance"] = buf;
    doc["cam_stream_url"] = CAM_STREAM_URL;
    doc["ir_active"] = state.irActive;
    doc["cars_entered"] = state.carsEntered;
    doc["last_entry_ago_s"] = state.everEntered ? (int32_t)((now - state.lastEntryMs) / 1000) : -1;
    doc["time_synced"] = state.timeSynced;
    doc["cam_last_seen_ms"] = state.haveCamData ? (int32_t)(now - state.lastCamMsgMs) : -1;
    doc["event_seq"] = eventSeq;
    if (ticketCount) {
      const Ticket &t = tickets[(ticketCount - 1) % TICKET_CAP];
      JsonObject lt = doc["last_ticket"].to<JsonObject>();
      lt["id"] = t.id;
      if (t.assignedSlot >= 0) {
        slotId(t.assignedSlot, buf);
        lt["bay"] = buf;
      } else {
        lt["bay"] = nullptr;
      }
      lt["entry_ago_s"] = (now - t.entryMs) / 1000;
    } else {
      doc["last_ticket"] = nullptr;
    }
  }
  sendJson(req, doc, 200);
}

static void handleHistory(AsyncWebServerRequest *req) {
  JsonDocument doc;
  uint32_t now = millis();
  {
    Lock l;
    char id[4];
    doc["session_start"] = state.timeSynced ? (uint32_t)time(nullptr) - now / 1000 : 0;
    doc["uptime_s"] = now / 1000;
    JsonArray arr = doc["slots"].to<JsonArray>();
    for (uint8_t i = 0; i < NUM_SLOTS; i++) {
      const SlotState &s = state.slots[i];
      uint32_t totalMs = s.totalOccupiedMs + (s.occupied ? now - s.sinceMs : 0);
      JsonObject o = arr.add<JsonObject>();
      slotId(i, id);
      o["id"] = id;
      o["total_occupied_s"] = totalMs / 1000;
      o["change_count"] = s.changeCount;
    }
  }
  sendJson(req, doc, 200);
}

// roi[] lives in a packed struct at an odd offset: index it through the struct
// (byte-wise loads) and never take a uint16_t* to it, or Xtensa faults on the unaligned load.
static void addRoi(JsonObject o, const char *id, const config_msg_t &c, uint8_t idx) {
  o["id"] = id;
  o["x"] = (uint16_t)c.roi[idx][0];
  o["y"] = (uint16_t)c.roi[idx][1];
  o["w"] = (uint16_t)c.roi[idx][2];
  o["h"] = (uint16_t)c.roi[idx][3];
}

static void handleConfig(AsyncWebServerRequest *req) {
  JsonDocument doc;
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["ap_ssid"] = AP_SSID;
  doc["ap_password"] = AP_PASS;
  doc["ap_ip"] = WiFi.softAPIP().toString();
  doc["ap_channel"] = AP_CHANNEL;
  doc["ap_clients"] = WiFi.softAPgetStationNum();
  doc["cam_stream_url"] = CAM_STREAM_URL;
  doc["zone"] = String(ZONE_ID);
  doc["total_slots"] = NUM_SLOTS;
  doc["fee_per_hour"] = FEE_PER_HOUR;
  doc["fee_minimum"] = FEE_MINIMUM;
  doc["currency"] = FEE_CURRENCY;
  {
    Lock l;
    const config_msg_t &c = state.camConfig;
    bool have = state.haveCamConfig;
    doc["cam_config_received"] = have;
    doc["pix_thresh"] = have ? c.pix_thresh : 35;
    doc["t_high"] = have ? c.t_high_pct / 100.0f : 0.30f;
    doc["t_low"] = have ? c.t_low_pct / 100.0f : 0.15f;
    doc["calibrated"] = have && c.calibrated;
    doc["calib_count"] = have ? c.calib_count : 0;
    JsonArray rois = doc["rois"].to<JsonArray>();
    char id[4];
    for (uint8_t i = 0; have && i < NUM_SLOTS; i++) {
      slotId(i, id);
      addRoi(rois.add<JsonObject>(), id, c, i);
    }
    addRoi(doc["ref_patch"].to<JsonObject>(), "REF", c, NUM_SLOTS);  // all zero until the camera reports
  }
  sendJson(req, doc, 200);
}

static void handleCalibrate(AsyncWebServerRequest *req) {
  bool online;
  {
    Lock l;
    online = camOnlineLocked(millis());
  }
  if (!online) return sendError(req, 503, "Camera offline");
  queueCommand(CMD_CALIBRATE, 0, 0, 0);
  Serial.println("[API] calibrate -> camera");
  sendOk(req);
}

static void handleSettings(AsyncWebServerRequest *req) {
  const char *body = (const char *)req->_tempObject;
  if (!body) return sendError(req, 400, "Missing JSON body");

  JsonDocument in;
  if (deserializeJson(in, body)) return sendError(req, 400, "Invalid JSON");

  int pix = in["pix_thresh"] | -1;
  float tHigh = in["t_high"] | -1.0f;
  float tLow = in["t_low"] | -1.0f;
  if (pix < 10 || pix > 80) return sendError(req, 400, "pix_thresh must be 10-80");
  if (tHigh < 0.10f || tHigh > 0.60f) return sendError(req, 400, "t_high must be 0.10-0.60");
  if (tLow < 0.05f || tLow > 0.40f) return sendError(req, 400, "t_low must be 0.05-0.40");
  if (tLow >= tHigh) return sendError(req, 400, "t_low must be lower than t_high");

  bool online;
  {
    Lock l;
    online = camOnlineLocked(millis());
  }
  if (!online) return sendError(req, 503, "Camera offline");

  queueCommand(CMD_SETTINGS, (uint8_t)pix, (uint8_t)lroundf(tHigh * 100), (uint8_t)lroundf(tLow * 100));
  {
    Lock l;
    logEventLocked(EV_SETTINGS, -1, (uint16_t)pix);
  }
  Serial.printf("[API] settings -> camera: pix=%d high=%.2f low=%.2f\n", pix, tHigh, tLow);
  sendOk(req);
}

// GET /api/events?since=<seq> -> events newer than seq (oldest first)
static void handleEvents(AsyncWebServerRequest *req) {
  uint32_t since = req->hasParam("since") ? (uint32_t)req->getParam("since")->value().toInt() : 0;
  JsonDocument doc;
  uint32_t now = millis();
  {
    Lock l;
    char id[4];
    uint32_t oldest = eventSeq > EVENT_CAP ? eventSeq - EVENT_CAP + 1 : 1;
    uint32_t from = since + 1 > oldest ? since + 1 : oldest;
    doc["seq"] = eventSeq;
    doc["uptime_ms"] = now;
    JsonArray arr = doc["events"].to<JsonArray>();
    for (uint32_t seq = from; seq <= eventSeq; seq++) {
      const Event &e = events[(seq - 1) % EVENT_CAP];
      JsonObject o = arr.add<JsonObject>();
      o["seq"] = e.seq;
      o["t_ms"] = e.ms;
      o["type"] = EVENT_NAMES[e.type];
      if (e.slot >= 0) {
        slotId(e.slot, id);
        o["slot"] = id;
      } else {
        o["slot"] = nullptr;
      }
      o["value"] = e.value;
    }
  }
  sendJson(req, doc, 200);
}

static void addTicket(JsonObject o, const Ticket &t, uint32_t now) {
  char id[4];
  o["id"] = t.id;
  o["state"] = TICKET_STATES[t.state];
  if (t.assignedSlot >= 0) {
    slotId(t.assignedSlot, id);
    o["assigned_bay"] = id;
  } else {
    o["assigned_bay"] = nullptr;
  }
  if (t.slot >= 0) {
    slotId(t.slot, id);
    o["bay"] = id;
  } else {
    o["bay"] = nullptr;
  }
  uint32_t end = t.state == TICKET_CLOSED ? t.exitMs : now;
  o["entry_ago_s"] = (now - t.entryMs) / 1000;
  o["duration_s"] = (end - t.entryMs) / 1000;
  o["fee"] = t.state == TICKET_CLOSED ? t.fee : computeFee(end - t.entryMs);
  o["currency"] = FEE_CURRENCY;
}

// GET /api/tickets -> recent tickets, newest first
static void handleTickets(AsyncWebServerRequest *req) {
  JsonDocument doc;
  uint32_t now = millis();
  {
    Lock l;
    doc["issued"] = ticketCount;
    doc["fee_per_hour"] = FEE_PER_HOUR;
    doc["fee_minimum"] = FEE_MINIMUM;
    doc["currency"] = FEE_CURRENCY;
    JsonArray arr = doc["tickets"].to<JsonArray>();
    uint16_t first = ticketCount > TICKET_CAP ? ticketCount - TICKET_CAP : 0;
    for (int32_t i = (int32_t)ticketCount - 1; i >= (int32_t)first; i--)
      addTicket(arr.add<JsonObject>(), tickets[i % TICKET_CAP], now);
  }
  sendJson(req, doc, 200);
}

// GET /api/ticket?id=1001
static void handleTicket(AsyncWebServerRequest *req) {
  if (!req->hasParam("id")) return sendError(req, 400, "Missing id");
  uint16_t id = (uint16_t)req->getParam("id")->value().toInt();
  JsonDocument doc;
  {
    Lock l;
    Ticket *t = findTicketLocked(id);
    if (!t) return sendError(req, 404, "Ticket not found");
    addTicket(doc.to<JsonObject>(), *t, millis());
  }
  sendJson(req, doc, 200);
}

static void handleTime(AsyncWebServerRequest *req) {
  const char *body = (const char *)req->_tempObject;
  if (!body) return sendError(req, 400, "Missing JSON body");
  JsonDocument in;
  if (deserializeJson(in, body)) return sendError(req, 400, "Invalid JSON");
  uint32_t epoch = in["epoch"] | 0u;
  if (epoch < 1600000000u) return sendError(req, 400, "epoch looks wrong");

  struct timeval tv = {(time_t)epoch, 0};
  settimeofday(&tv, nullptr);
  {
    Lock l;
    state.timeSynced = true;
  }
  Serial.printf("[API] clock set to %lu\n", (unsigned long)epoch);
  sendOk(req);
}

static const char FALLBACK_HTML[] PROGMEM = R"HTML(<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart Parking</title>
<style>body{background:#0D0D0D;color:#fff;font-family:system-ui,sans-serif;padding:24px}
code{color:#39FF14}a{color:#39FF14}</style></head><body>
<h2>Smart Parking controller is running</h2>
<p>The dashboard has not been uploaded to SPIFFS yet. Run <code>scripts/upload_dashboard.sh</code>.</p>
<p>API: <a href="/api/status">/api/status</a> &middot; <a href="/api/history">/api/history</a>
&middot; <a href="/api/config">/api/config</a></p></body></html>)HTML";

static void handleIndex(AsyncWebServerRequest *req) {
  // index.html is never cached so a new upload is picked up immediately;
  // the hashed JS/CSS files are cached by serveStatic below.
  if (SPIFFS.exists("/index.html.gz") || SPIFFS.exists("/index.html")) {
    AsyncWebServerResponse *res = req->beginResponse(SPIFFS, "/index.html", "text/html");
    res->addHeader("Cache-Control", "no-cache");
    req->send(res);
  } else {
    req->send(200, "text/html", FALLBACK_HTML);
  }
}

static void setupServer() {
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/history", HTTP_GET, handleHistory);
  server.on("/api/config", HTTP_GET, handleConfig);
  server.on("/api/calibrate", HTTP_POST, handleCalibrate, nullptr, collectBody);
  server.on("/api/settings", HTTP_POST, handleSettings, nullptr, collectBody);
  server.on("/api/time", HTTP_POST, handleTime, nullptr, collectBody);
  server.on("/api/events", HTTP_GET, handleEvents);
  server.on("/api/tickets", HTTP_GET, handleTickets);
  server.on("/api/ticket", HTTP_GET, handleTicket);

  server.on("/", HTTP_GET, handleIndex);
  server.on("/index.html", HTTP_GET, handleIndex);
  // Files are uploaded gzipped (app.js.gz); the server sends them with Content-Encoding: gzip
  server.serveStatic("/", SPIFFS, "/").setCacheControl("max-age=31536000");

  server.onNotFound([](AsyncWebServerRequest *req) {
    if (req->method() == HTTP_OPTIONS) {
      req->send(204);  // CORS preflight; headers come from DefaultHeaders
    } else {
      sendError(req, 404, "Not found");
    }
  });

  server.begin();
}

// ───────────────────────────── Setup / loop ────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n=== Smart Parking controller v%s ===\n", FIRMWARE_VERSION);

  stateMutex = xSemaphoreCreateMutex();
  memset(&state, 0, sizeof(state));

  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    pinMode(LED_GREEN[i], OUTPUT);
    pinMode(LED_RED[i], OUTPUT);
    digitalWrite(LED_GREEN[i], LOW);
    digitalWrite(LED_RED[i], LOW);
  }
  pinMode(PIN_IR, INPUT_PULLUP);

  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  Wire.setClock(400000);
  displayOk = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (!displayOk) Serial.println("[OLED] SSD1306 not found at 0x3C, continuing without display");
  else {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 24);
    display.print("Smart Parking booting");
    display.display();
  }

  ESP32PWM::allocateTimer(0);
  gateServo.setPeriodHertz(50);
  gateServo.attach(PIN_SERVO, 500, 2400);
  gateServo.write(SERVO_CLOSED_DEG);

  if (!SPIFFS.begin(true)) Serial.println("[SPIFFS] mount failed, dashboard unavailable");
  else Serial.printf("[SPIFFS] %u / %u bytes used\n", (unsigned)SPIFFS.usedBytes(), (unsigned)SPIFFS.totalBytes());

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_IP, AP_MASK);
  WiFi.softAP(AP_SSID, AP_PASS, AP_CHANNEL, 0, AP_MAX_CLIENTS);
  WiFi.setSleep(false);  // keeps ESP-NOW reception reliable
  delay(100);
  Serial.printf("[WiFi] AP \"%s\" on channel %u, IP %s, MAC %s\n", AP_SSID, AP_CHANNEL,
                WiFi.softAPIP().toString().c_str(), WiFi.softAPmacAddress().c_str());

  setupEspNow();
  setupServer();
  Serial.println("[HTTP] dashboard at http://192.168.4.1/");
}

void loop() {
  static bool wasOnline = false;
  static uint32_t lastDisplayMs = 0;
  uint32_t now = millis();

  processEspNow(now);

  bool online;
  {
    Lock l;
    online = camOnlineLocked(now);
  }
  if (online != wasOnline) {
    Serial.printf("[CAM] %s\n", online ? "online" : "OFFLINE (no ESP-NOW for 3 s)");
    wasOnline = online;
    Lock l;
    logEventLocked(online ? EV_CAM_ONLINE : EV_CAM_OFFLINE, -1, 0);
  }

  updateGate(now);
  serviceCommands(now);
  updateLeds(now);

  if (now - lastDisplayMs >= DISPLAY_INTERVAL_MS) {
    lastDisplayMs = now;
    updateDisplay(now);
  }

  delay(5);
}
