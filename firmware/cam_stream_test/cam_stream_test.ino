/*
 * ESP32-CAM stream test — camera + Wi-Fi + MJPEG stream, nothing else.
 *
 *   http://<ip>:81/         page showing the stream
 *   http://<ip>:81/stream   raw MJPEG stream (use this in <img src="...">)
 *   http://<ip>:81/capture  single JPEG snapshot
 *
 * Diagnostics on the Serial Monitor: camera fps without network at boot,
 * then delivered fps / KB/s / Wi-Fi signal every 5 s while streaming.
 *
 * Board: "AI Thinker ESP32-CAM", Partition Scheme: "Huge APP", PSRAM: Enabled.
 * The IP is printed on the Serial Monitor (115200) after it joins Wi-Fi.
 */

#include <Arduino.h>
#include <esp_arduino_version.h>
#include <WiFi.h>
#include "esp_camera.h"
#include "esp_http_server.h"

static const char *WIFI_SSID = "YourHotspotName";  // only used when USE_OWN_AP is 0
static const char *WIFI_PASS = "YourHotspotPassword";
static const uint16_t STREAM_PORT = 81;

// 1 = lower Wi-Fi transmit power (8.5 dBm). Fixes slow/stalling streams caused by
//     voltage dips during continuous transmit on ESP32-CAM boards. Keep the board
//     within a few metres of the hotspot. 0 = full power.
#define LOW_TX_POWER 1

// 1 = the camera creates its OWN Wi-Fi "ParkingCam" (password park1234) and you connect
//     a phone/laptop straight to it: no hotspot in between. Stream at http://192.168.4.1:81/
// 0 = join WIFI_SSID like normal
#define USE_OWN_AP 1
static const char *AP_SSID = "ParkingCam";
static const char *AP_PASS = "park1234";

// AI-Thinker ESP32-CAM pins
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

#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;
  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;
  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;
  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;
  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;
  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  c.pin_sccb_sda = SIOD_GPIO_NUM;
  c.pin_sccb_scl = SIOC_GPIO_NUM;
#else
  c.pin_sscb_sda = SIOD_GPIO_NUM;
  c.pin_sscb_scl = SIOC_GPIO_NUM;
#endif
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;  // the sensor encodes JPEG itself: fast, no CPU work
  c.frame_size = FRAMESIZE_VGA;     // 640x480
  c.jpeg_quality = 12;              // 10-63, lower = better quality
  c.fb_count = psramFound() ? 2 : 1;
  c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }
  sensor_t *s = esp_camera_sensor_get();
  if (s->id.PID == OV3660_PID) {
    s->set_vflip(s, 1);
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }
  Serial.printf("Camera OK (sensor PID 0x%04x)\n", s->id.PID);
  return true;
}

static esp_err_t streamHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  Serial.println("Stream client connected");

  char part[64];
  esp_err_t res = ESP_OK;
  uint32_t windowStart = millis(), frames = 0, bytes = 0;
  while (res == ESP_OK) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Frame capture failed");
      res = ESP_FAIL;
      break;
    }
    size_t hlen = snprintf(part, sizeof(part), STREAM_PART, (unsigned)fb->len);
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, part, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    frames++;
    bytes += fb->len;
    esp_camera_fb_return(fb);

    // Delivered rate over the network, every 5 s
    if (millis() - windowStart >= 5000) {
      float secs = (millis() - windowStart) / 1000.0f;
      Serial.printf("Streaming: %.1f fps, %.0f KB/s\n", frames / secs, bytes / 1024.0f / secs);
      windowStart = millis();
      frames = bytes = 0;
    }
  }
  Serial.println("Stream client disconnected");
  return res;
}

static esp_err_t indexHandler(httpd_req_t *req) {
  static const char html[] =
      "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
      "<body style='margin:0;background:#000;display:grid;place-items:center;height:100vh'>"
      "<img src='/stream' style='max-width:100%;max-height:100vh'></body>";
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

// Single JPEG snapshot
static esp_err_t captureHandler(httpd_req_t *req) {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return httpd_resp_send_500(req);
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// How fast the camera produces frames on its own, with no network involved
static void benchmarkCamera() {
  for (int i = 0; i < 3; i++) esp_camera_fb_return(esp_camera_fb_get());  // warm up
  uint32_t start = millis(), bytes = 0;
  const int n = 30;
  for (int i = 0; i < n; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) continue;
    bytes += fb->len;
    esp_camera_fb_return(fb);
  }
  float secs = (millis() - start) / 1000.0f;
  Serial.printf("Camera alone: %.1f fps, avg frame %u bytes\n", n / secs, bytes / n);
}

static void startServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = STREAM_PORT;
  config.ctrl_port = 32769;
  config.send_wait_timeout = 5;  // drop vanished clients
  config.lru_purge_enable = true;

  httpd_handle_t server = nullptr;
  if (httpd_start(&server, &config) != ESP_OK) {
    Serial.println("HTTP server failed to start");
    return;
  }
  httpd_uri_t index = {"/", HTTP_GET, indexHandler, nullptr};
  httpd_uri_t stream = {"/stream", HTTP_GET, streamHandler, nullptr};
  httpd_uri_t capture = {"/capture", HTTP_GET, captureHandler, nullptr};
  httpd_register_uri_handler(server, &index);
  httpd_register_uri_handler(server, &stream);
  httpd_register_uri_handler(server, &capture);
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== ESP32-CAM stream test ===");

  if (!initCamera()) {
    Serial.println("Check the camera ribbon cable and use a 5 V 2 A supply. Restarting in 5 s...");
    delay(5000);
    ESP.restart();
  }
  benchmarkCamera();

#if USE_OWN_AP
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  WiFi.setSleep(false);
#if LOW_TX_POWER
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
#endif
  Serial.printf("Own Wi-Fi \"%s\" (password %s) is up: connect your phone to it\n", AP_SSID, AP_PASS);
#else
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Connecting to \"%s\"", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
#if LOW_TX_POWER
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
#endif
  Serial.printf("Wi-Fi signal %d dBm (above -60 is good, below -75 is poor)\n", WiFi.RSSI());
#endif

  startServer();
#if USE_OWN_AP
  String ip = WiFi.softAPIP().toString();
#else
  String ip = WiFi.localIP().toString();
#endif
  Serial.println("==============================================");
  Serial.printf("  Stream page : http://%s:%u/\n", ip.c_str(), STREAM_PORT);
  Serial.printf("  Raw stream  : http://%s:%u/stream\n", ip.c_str(), STREAM_PORT);
  Serial.printf("  Snapshot    : http://%s:%u/capture\n", ip.c_str(), STREAM_PORT);
  Serial.println("==============================================");
}

void loop() {
  delay(1000);
}
