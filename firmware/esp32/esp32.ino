/*
 * Smart Parking System — CONTROLLER NODE (classic ESP32 / ESP32-WROOM-32)
 * -----------------------------------------------------------------------
 *  - Joins your Wi-Fi (e.g. a phone hotspot) like every other node
 *  - Receives the slot array from the camera node over ESP-NOW
 *  - Drives the hardware:
 *      4 slot LEDs (on = free), green PASS LED, red STOP LED, buzzer,
 *      SG90 servo gate, entry IR sensor, SSD1306 OLED
 *  - Gate modes: AUTO (opens for a car when a slot is free), OPEN, CLOSED,
 *    switchable from the dashboard
 *  - Issues parking tickets with fees and keeps an event log
 *  - JSON API for the dashboard (CORS enabled, works from any host):
 *        GET  /api/status        slots, gate, IR, LEDs, buzzer, camera link, counters
 *        GET  /api/history       per-slot occupied time + change counts
 *        GET  /api/events        ?since=<seq> event log for the timeline
 *        GET  /api/tickets       recent tickets;  GET /api/ticket?id=1001
 *        POST /api/gate          {"mode":"auto"|"open"|"closed"}
 *        POST /api/buzzer        {"pattern":"beep"|"double"|"long"}  (test)
 *        POST /api/time          {"epoch": <unix seconds>} sets the clock (no RTC on board)
 *
 * Arduino IDE 2.x, ESP32 core 2.0.x or 3.x. Works on either board (pins are picked automatically):
 *   classic ESP32: board "ESP32 Dev Module", Partition Scheme "Default 4MB with spiffs"
 *   ESP32-S3:      board "ESP32S3 Dev Module", USB CDC On Boot "Enabled", PSRAM "Disabled"
 *
 * Libraries (Library Manager):
 *   ESPAsyncWebServer + AsyncTCP   (by ESP32Async — required for core 3.x)
 *   ArduinoJson 7.x                (by Benoit Blanchon)
 *   Adafruit SSD1306 + Adafruit GFX
 *   ESP32Servo                     (by Kevin Harrington / madhephaestus)
 *
 * Set WIFI_SSID / WIFI_PASS below (same network as the camera node). The OLED
 * and Serial Monitor show this node's IP: add it in the dashboard under
 * Settings > Nodes as a "controller".
 */

#include <Arduino.h>
#include <esp_arduino_version.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <ESPmDNS.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>
#include <driver/gpio.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <sys/time.h>
#include <time.h>

#if ARDUINOJSON_VERSION_MAJOR < 7
#error "This sketch needs ArduinoJson 7.x (Library Manager > ArduinoJson)"
#endif

#define FIRMWARE_VERSION "2.0.0"

// ───────────────────────────── Network ─────────────────────────────
// The camera node creates this Wi-Fi; joining it puts ESP-NOW on the same channel
static const char *WIFI_SSID = "ParkingCam";  // the camera node's own Wi-Fi
static const char *WIFI_PASS = "park1234";
static const char *NODE_NAME = "parking-gate";  // also reachable as http://parking-gate.local

// ───────────────────────────── Pins ────────────────────────────────
// The right set is picked automatically from the board selected in Tools > Board.
static const uint8_t NUM_SLOTS = 4;
#if CONFIG_IDF_TARGET_ESP32S3
// ESP32-S3: avoids 19/20 (USB-C data), 0/3/45/46 (boot strapping),
// 26-37 (flash/PSRAM) and 43/44 (UART0).
static const uint8_t PIN_OLED_SDA = 8;
static const uint8_t PIN_OLED_SCL = 9;
static const uint8_t SLOT_LED[NUM_SLOTS] = {10, 11, 12, 13};  // A1..A4, lit = slot free
static const uint8_t PIN_LED_PASS = 14;  // green: car may pass (gate open)
static const uint8_t PIN_LED_STOP = 21;  // red: car must stop (gate closed)
static const uint8_t PIN_BUZZER = 4;
static const uint8_t PIN_SERVO = 5;
static const uint8_t PIN_IR = 6;
#else
// Classic ESP32: GPIO 6-11 are the flash chip, 1/3 are USB serial and
// 0/2/5/12/15 are boot strapping pins, so none of them are used here.
static const uint8_t PIN_OLED_SDA = 21;
static const uint8_t PIN_OLED_SCL = 22;
static const uint8_t SLOT_LED[NUM_SLOTS] = {25, 26, 27, 14};  // A1..A4, lit = slot free
static const uint8_t PIN_LED_PASS = 32;  // green: car may pass (gate open)
static const uint8_t PIN_LED_STOP = 33;  // red: car must stop (gate closed)
static const uint8_t PIN_BUZZER = 23;
static const uint8_t PIN_SERVO = 18;
static const uint8_t PIN_IR = 19;
#endif

// Most IR obstacle modules pull OUT low when something is in front of them
#define IR_ACTIVE_LEVEL LOW

// 1 = drive the buzzer with a 2.4 kHz tone (works for passive AND active buzzers)
// 0 = plain on/off (active buzzers only)
#define BUZZER_TONE 1

// 1 = weakest GPIO drive strength on the LED pins, so LEDs wired straight to a pin
//     (no resistor) stay at a safe current. Fine with resistors too (slightly dimmer).
// 0 = normal drive strength (only with a 150 ohm - 1 k resistor on every LED).
#define LED_LOW_DRIVE 1
static const uint16_t BUZZER_FREQ = 2400;

// ───────────────────────────── Behaviour ───────────────────────────
static const char ZONE_ID = 'A';
static const int SERVO_CLOSED_DEG = 0;
static const int SERVO_OPEN_DEG = 90;
static const uint32_t GATE_CLOSE_DELAY_MS = 5000;  // AUTO: close 5 s after the IR sensor clears
static const uint32_t IR_DEBOUNCE_MS = 50;
static const uint32_t CAM_TIMEOUT_MS = 3000;       // camera offline after 3 s without ESP-NOW
static const uint32_t DENIED_FLASH_MS = 2000;      // STOP LED flashes this long when a car is refused
static const uint32_t DISPLAY_INTERVAL_MS = 500;
static const size_t MAX_BODY = 256;

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
static_assert(sizeof(parking_msg_t) == 10, "parking_msg_t layout");

// ───────────────────────────── State ───────────────────────────────
enum GateMode : uint8_t { GATE_AUTO, GATE_OPEN, GATE_CLOSED };
static const char *GATE_MODE_NAMES[] = {"auto", "open", "closed"};

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
  GateMode gateMode;
  bool gateOpen;
  bool irActive;
  bool buzzerOn;
  uint32_t carsEntered;
  uint32_t carsDenied;
  bool everEntered;
  uint32_t lastEntryMs;
  uint32_t deniedFlashUntil;
  bool timeSynced;
};

// Everything the web server (async_tcp task) touches is guarded by stateMutex
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

// Requests from the web server -> loop()
static int8_t requestedMode = -1;        // GateMode, -1 = none
static const uint8_t *requestedBeep = nullptr;

// Event log and tickets (declared before any function so Arduino's generated prototypes see the types)
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
  EV_GATE_MODE,
};
static const char *EVENT_NAMES[] = {"",           "slot_occupied", "slot_free",     "gate_open",  "gate_close",
                                    "entry_denied", "ticket_issued", "ticket_closed", "cam_online", "cam_offline",
                                    "gate_mode"};

struct Event {
  uint32_t seq;
  uint32_t ms;
  uint8_t type;
  int8_t slot;     // -1 if not slot related
  uint16_t value;  // score, ticket id, gate mode or denial reason depending on type
};
static const uint8_t EVENT_CAP = 120;
static Event events[EVENT_CAP];
static uint32_t eventSeq = 0;  // seq of the newest event (0 = none)

enum : uint8_t { TICKET_ENTERED, TICKET_PARKED, TICKET_CLOSED };
static const char *TICKET_STATES[] = {"entered", "parked", "closed"};

struct Ticket {
  uint16_t id;
  int8_t assignedSlot;  // slot suggested at the gate, -1 if none
  int8_t slot;          // slot actually used, -1 until parked
  uint8_t state;
  uint32_t entryMs, parkedMs, exitMs;
  uint16_t fee;
};
static const uint8_t TICKET_CAP = 16;
static Ticket tickets[TICKET_CAP];
static uint16_t ticketCount = 0;  // tickets issued since boot
static const uint16_t FIRST_TICKET_ID = 1001;

// Buzzer patterns: alternating on/off durations in ms, 0-terminated
static const uint8_t BEEP_SHORT[] = {12, 0};           // x10 ms
static const uint8_t BEEP_DOUBLE[] = {10, 8, 10, 0};
static const uint8_t BEEP_LONG[] = {60, 0};
static const uint8_t BEEP_BOOT[] = {6, 6, 6, 0};

static Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool displayOk = false;
static Servo gateServo;
#if BUZZER_TONE
static ESP32PWM buzzerPwm;
#endif
static AsyncWebServer server(80);

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
static void logEventLocked(uint8_t type, int8_t slot, uint16_t value) {
  eventSeq++;
  Event &e = events[(eventSeq - 1) % EVENT_CAP];
  e.seq = eventSeq;
  e.ms = millis();
  e.type = type;
  e.slot = slot;
  e.value = value;
}

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
  if (t.assignedSlot >= 0) Serial.printf("[TICKET] #%u issued, go to %c%d\n", t.id, ZONE_ID, t.assignedSlot + 1);
  else Serial.printf("[TICKET] #%u issued (no free slot)\n", t.id);
}

// Oldest ticket still waiting to park, preferring one that was sent to this slot
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
  }
}

static void setupEspNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] init failed, restarting");
    delay(1000);
    ESP.restart();
  }
  esp_now_register_recv_cb(onEspNowRecv);
}

// Applies the newest camera packet
static void processEspNow(uint32_t now) {
  parking_msg_t st;
  bool have = false;
  portENTER_CRITICAL(&rxMux);
  if (rxStatusPending) {
    st = rxStatus;
    rxStatusPending = false;
    have = true;
  }
  portEXIT_CRITICAL(&rxMux);
  if (!have) return;

  bool changed = false;
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
  if (!state.haveCamData) Serial.println("[CAM] first ESP-NOW packet received");
  state.haveCamData = true;
  state.lastCamMsgMs = now;
  state.lastSeq = st.sequence;

  if (changed) {
    Serial.print("[SLOTS]");
    for (uint8_t i = 0; i < NUM_SLOTS; i++)
      Serial.printf(" %c%u=%s(%u)", ZONE_ID, i + 1, state.slots[i].occupied ? "OCC" : "free", state.slots[i].score);
    Serial.println();
  }
}

// ───────────────────────────── Buzzer ──────────────────────────────
static const uint8_t *beepPattern = nullptr;
static uint8_t beepStep = 0;
static uint32_t beepStepStartMs = 0;

static void buzzerWrite(bool on) {
#if BUZZER_TONE
  buzzerPwm.writeScaled(on ? 0.5f : 0.0f);
#else
  digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
#endif
  Lock l;
  state.buzzerOn = on;
}

static void beep(const uint8_t *pattern) {
  beepPattern = pattern;
  beepStep = 0;
  beepStepStartMs = millis();
  buzzerWrite(true);
}

static void updateBuzzer(uint32_t now) {
  if (!beepPattern) return;
  if (now - beepStepStartMs < (uint32_t)beepPattern[beepStep] * 10) return;
  beepStep++;
  beepStepStartMs = now;
  if (beepPattern[beepStep] == 0) {
    beepPattern = nullptr;
    buzzerWrite(false);
  } else {
    buzzerWrite(beepStep % 2 == 0);  // even steps sound, odd steps are pauses
  }
}

// ───────────────────────────── Gate ────────────────────────────────
static void moveServo(bool open) {
  gateServo.write(open ? SERVO_OPEN_DEG : SERVO_CLOSED_DEG);
  Serial.printf("[GATE] %s\n", open ? "OPEN" : "CLOSED");
}

// AUTO: a car at the IR sensor is let in when a slot is free; the gate closes
// GATE_CLOSE_DELAY_MS after the sensor clears. A car refused while the lot is
// full is let in as soon as a slot frees up, if it is still waiting.
// OPEN / CLOSED: set from the dashboard, the gate holds that position.
static void updateGate(uint32_t now) {
  static bool irRaw = false;
  static uint32_t irRawChangedMs = 0;
  static uint32_t irClearSinceMs = 0;
  static bool carWaiting = false;   // arrived and not yet admitted
  static bool deniedThisCar = false;
  static bool autoHold = false;     // AUTO keeps the gate open for the current car

  bool raw = digitalRead(PIN_IR) == IR_ACTIVE_LEVEL;
  if (raw != irRaw) {
    irRaw = raw;
    irRawChangedMs = now;
  }

  const uint8_t *sound = nullptr;
  bool moveTo = false, move = false;
  {
    Lock l;
    // Mode change requested by the dashboard
    if (requestedMode >= 0) {
      GateMode m = (GateMode)requestedMode;
      requestedMode = -1;
      if (m != state.gateMode) {
        state.gateMode = m;
        logEventLocked(EV_GATE_MODE, -1, m);
        Serial.printf("[GATE] mode -> %s\n", GATE_MODE_NAMES[m]);
        sound = BEEP_SHORT;
        autoHold = m == GATE_AUTO && state.gateOpen;  // don't drop the arm onto a car
        irClearSinceMs = now;
      }
    }

    // Debounced IR edge = a car arrives
    if (now - irRawChangedMs >= IR_DEBOUNCE_MS && irRaw != state.irActive) {
      state.irActive = irRaw;
      if (irRaw) carWaiting = true;
      else {
        irClearSinceMs = now;
        carWaiting = false;
        deniedThisCar = false;
      }
    }

    if (carWaiting) {
      bool admit = false, deny = false;
      uint16_t reason = 0;
      if (state.gateMode == GATE_OPEN) admit = true;
      else if (state.gateMode == GATE_CLOSED) {
        deny = !deniedThisCar;
        reason = 1;
      } else if (freeCountLocked() > 0) admit = true;
      else deny = !deniedThisCar;

      if (admit) {
        carWaiting = false;
        if (state.gateMode == GATE_AUTO) autoHold = true;
        state.carsEntered++;
        state.everEntered = true;
        state.lastEntryMs = now;
        issueTicketLocked(now);
        sound = BEEP_SHORT;
      } else if (deny) {
        deniedThisCar = true;
        state.carsDenied++;
        state.deniedFlashUntil = now + DENIED_FLASH_MS;
        logEventLocked(EV_ENTRY_DENIED, -1, reason);
        Serial.printf("[GATE] entry denied (%s)\n", reason ? "gate closed" : "lot full");
        sound = BEEP_DOUBLE;
      }
    }

    if (autoHold && state.gateMode == GATE_AUTO && !state.irActive && now - irClearSinceMs >= GATE_CLOSE_DELAY_MS)
      autoHold = false;

    bool want = state.gateMode == GATE_OPEN || (state.gateMode == GATE_AUTO && autoHold);
    if (want != state.gateOpen) {
      state.gateOpen = want;
      logEventLocked(want ? EV_GATE_OPEN : EV_GATE_CLOSE, -1, 0);
      move = true;
      moveTo = want;
    }
  }
  if (move) moveServo(moveTo);
  if (sound) beep(sound);
}

// ───────────────────────────── LEDs ────────────────────────────────
static void updateLeds(uint32_t now) {
  bool occ[NUM_SLOTS];
  bool online, haveData, gateOpen, denied;
  {
    Lock l;
    online = camOnlineLocked(now);
    haveData = state.haveCamData;
    gateOpen = state.gateOpen;
    denied = (int32_t)(state.deniedFlashUntil - now) > 0;
    for (uint8_t i = 0; i < NUM_SLOTS; i++) occ[i] = state.slots[i].occupied;
  }
  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    bool on;
    if (online) on = !occ[i];                              // lit = free
    else if (haveData) on = (now / 500) % 2;               // camera lost: all blink together
    else on = ((now / 250) % NUM_SLOTS) == i;              // waiting for the camera: chase
    digitalWrite(SLOT_LED[i], on ? HIGH : LOW);
  }
  digitalWrite(PIN_LED_PASS, gateOpen ? HIGH : LOW);
  // STOP: solid while closed, fast flash after refusing a car
  digitalWrite(PIN_LED_STOP, gateOpen ? LOW : (denied ? ((now / 120) % 2 ? HIGH : LOW) : HIGH));
}

// ───────────────────────────── OLED ────────────────────────────────
static void updateDisplay(uint32_t now) {
  if (!displayOk) return;

  uint8_t freeCount;
  int firstFree;
  bool online, haveData, gateOpen;
  GateMode mode;
  {
    Lock l;
    freeCount = freeCountLocked();
    firstFree = firstFreeSlotLocked();
    online = camOnlineLocked(now);
    haveData = state.haveCamData;
    gateOpen = state.gateOpen;
    mode = state.gateMode;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  if (WiFi.status() == WL_CONNECTED) display.printf("IP %s", WiFi.localIP().toString().c_str());
  else display.print("Connecting WiFi...");
  display.setCursor(0, 10);
  display.printf("Gate %s/%s", gateOpen ? "OPEN" : "SHUT", mode == GATE_AUTO ? "AUTO" : "MAN");
  display.setCursor(OLED_WIDTH - 6 * 6, 10);
  display.print(online ? "Cam OK" : "Cam --");
  display.drawFastHLine(0, 19, OLED_WIDTH, SSD1306_WHITE);

  display.setTextSize(2);
  if (!haveData) {
    display.setTextSize(1);
    display.setCursor(0, 30);
    display.print("Waiting for camera");
    display.setCursor(0, 42);
    display.print("node (ESP-NOW)...");
  } else {
    display.setCursor(0, 24);
    display.printf("Free %u/%u", freeCount, NUM_SLOTS);
    display.setCursor(0, 44);
    if (freeCount == 0) display.print("FULL");
    else display.printf("Go to %c%d", ZONE_ID, firstFree + 1);
  }
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

// Accumulates small request bodies into req->_tempObject (freed by the library)
static void collectBody(AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index, size_t total) {
  if (total > MAX_BODY) return;
  if (index == 0) req->_tempObject = calloc(total + 1, 1);
  if (req->_tempObject && index + len <= total) memcpy((uint8_t *)req->_tempObject + index, data, len);
}

static void handleStatus(AsyncWebServerRequest *req) {
  JsonDocument doc;
  uint32_t now = millis();
  doc["node"] = "controller";
  doc["name"] = NODE_NAME;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  {
    Lock l;
    char buf[32];
    doc["zone"] = String(ZONE_ID);
    JsonArray arr = doc["slots"].to<JsonArray>();
    JsonArray leds = doc["leds"]["slots"].to<JsonArray>();
    bool online = camOnlineLocked(now);
    for (uint8_t i = 0; i < NUM_SLOTS; i++) {
      const SlotState &s = state.slots[i];
      JsonObject o = arr.add<JsonObject>();
      slotId(i, buf);
      o["id"] = buf;
      o["occupied"] = s.occupied;
      o["score"] = s.score;
      o["since"] = s.occupied ? toTimestampLocked(s.sinceMs, now) : 0;
      o["occupied_for_s"] = s.occupied ? (now - s.sinceMs) / 1000 : 0;
      leds.add(online && !s.occupied);
    }
    doc["leds"]["pass"] = state.gateOpen;
    doc["leds"]["stop"] = !state.gateOpen;
    doc["free_count"] = freeCountLocked();
    doc["total_slots"] = NUM_SLOTS;
    guidanceLocked(buf, sizeof(buf));
    doc["guidance"] = buf;
    doc["cam_online"] = online;
    doc["cam_last_seen_ms"] = state.haveCamData ? (int32_t)(now - state.lastCamMsgMs) : -1;
    doc["gate_open"] = state.gateOpen;
    doc["gate_mode"] = GATE_MODE_NAMES[state.gateMode];
    doc["servo_angle"] = state.gateOpen ? SERVO_OPEN_DEG : SERVO_CLOSED_DEG;
    doc["ir_active"] = state.irActive;
    doc["buzzer_on"] = state.buzzerOn;
    doc["uptime_s"] = now / 1000;
    doc["cars_entered"] = state.carsEntered;
    doc["cars_denied"] = state.carsDenied;
    doc["last_entry_ago_s"] = state.everEntered ? (int32_t)((now - state.lastEntryMs) / 1000) : -1;
    doc["time_synced"] = state.timeSynced;
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

// POST /api/gate {"mode":"auto"|"open"|"closed"}
static void handleGate(AsyncWebServerRequest *req) {
  const char *body = (const char *)req->_tempObject;
  if (!body) return sendError(req, 400, "Missing JSON body");
  JsonDocument in;
  if (deserializeJson(in, body)) return sendError(req, 400, "Invalid JSON");
  const char *mode = in["mode"] | "";
  int8_t m = -1;
  for (uint8_t i = 0; i < 3; i++)
    if (!strcmp(mode, GATE_MODE_NAMES[i])) m = i;
  if (m < 0) return sendError(req, 400, "mode must be auto, open or closed");
  {
    Lock l;
    requestedMode = m;
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["mode"] = GATE_MODE_NAMES[m];
  sendJson(req, doc, 200);
}

// POST /api/buzzer {"pattern":"beep"|"double"|"long"}
static void handleBuzzer(AsyncWebServerRequest *req) {
  const char *body = (const char *)req->_tempObject;
  const char *pattern = "beep";
  JsonDocument in;
  if (body && !deserializeJson(in, body)) pattern = in["pattern"] | "beep";
  const uint8_t *p = !strcmp(pattern, "double") ? BEEP_DOUBLE : !strcmp(pattern, "long") ? BEEP_LONG : BEEP_SHORT;
  {
    Lock l;
    requestedBeep = p;
  }
  JsonDocument doc;
  doc["ok"] = true;
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
  JsonDocument doc;
  doc["ok"] = true;
  sendJson(req, doc, 200);
}

static void handleRoot(AsyncWebServerRequest *req) {
  String ip = WiFi.localIP().toString();
  String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                "<body style='background:#0D0D0D;color:#fff;font-family:system-ui;padding:24px'>"
                "<h3>Smart Parking &middot; controller node</h3><p>Add <code>" + ip +
                "</code> as a <b>controller</b> node in the dashboard.</p>"
                "<p><a style='color:#39FF14' href='/api/status'>/api/status</a></p></body>";
  req->send(200, "text/html", html);
}

static void setupServer() {
  // CORS + Private-Network headers let a dashboard hosted anywhere (laptop, Vercel) call this node
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Private-Network", "true");

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/history", HTTP_GET, handleHistory);
  server.on("/api/events", HTTP_GET, handleEvents);
  server.on("/api/tickets", HTTP_GET, handleTickets);
  server.on("/api/ticket", HTTP_GET, handleTicket);
  server.on("/api/gate", HTTP_POST, handleGate, nullptr, collectBody);
  server.on("/api/buzzer", HTTP_POST, handleBuzzer, nullptr, collectBody);
  server.on("/api/time", HTTP_POST, handleTime, nullptr, collectBody);

  server.onNotFound([](AsyncWebServerRequest *req) {
    if (req->method() == HTTP_OPTIONS) req->send(204);  // CORS preflight; headers come from DefaultHeaders
    else sendError(req, 404, "Not found");
  });
  server.begin();
}

// ───────────────────────────── Wi-Fi ───────────────────────────────
static void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(NODE_NAME);
  WiFi.setSleep(false);  // power save drops ESP-NOW packets
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[WiFi] joining \"%s\" (MAC %s)\n", WIFI_SSID, WiFi.macAddress().c_str());
}

// Prints the address to type into the dashboard once the hotspot gives us one
static void checkWifi() {
  static bool wasConnected = false;
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wasConnected) {
    String ip = WiFi.localIP().toString();
    Serial.println("\n==============================================");
    Serial.printf("  CONTROLLER NODE ONLINE  ->  http://%s\n", ip.c_str());
    Serial.printf("  Wi-Fi channel %d, signal %d dBm\n", WiFi.channel(), WiFi.RSSI());
    Serial.println("  Add this IP as a CONTROLLER node in the dashboard");
    Serial.println("==============================================\n");
    if (MDNS.begin(NODE_NAME)) MDNS.addService("http", "tcp", 80);
  } else if (!connected && wasConnected) {
    Serial.println("[WiFi] disconnected, reconnecting...");
  }
  wasConnected = connected;
}

// ───────────────────────────── Setup / loop ────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n=== Smart Parking controller node v%s ===\n", FIRMWARE_VERSION);

  stateMutex = xSemaphoreCreateMutex();
  memset(&state, 0, sizeof(state));
  state.gateMode = GATE_AUTO;

  for (uint8_t i = 0; i < NUM_SLOTS; i++) {
    pinMode(SLOT_LED[i], OUTPUT);
    digitalWrite(SLOT_LED[i], LOW);
  }
  pinMode(PIN_LED_PASS, OUTPUT);
  pinMode(PIN_LED_STOP, OUTPUT);
#if LED_LOW_DRIVE
  for (uint8_t i = 0; i < NUM_SLOTS; i++) gpio_set_drive_capability((gpio_num_t)SLOT_LED[i], GPIO_DRIVE_CAP_0);
  gpio_set_drive_capability((gpio_num_t)PIN_LED_PASS, GPIO_DRIVE_CAP_0);
  gpio_set_drive_capability((gpio_num_t)PIN_LED_STOP, GPIO_DRIVE_CAP_0);
#endif
  digitalWrite(PIN_LED_PASS, LOW);
  digitalWrite(PIN_LED_STOP, HIGH);
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
  ESP32PWM::allocateTimer(1);
  gateServo.setPeriodHertz(50);
  gateServo.attach(PIN_SERVO, 500, 2400);
  gateServo.write(SERVO_CLOSED_DEG);

#if BUZZER_TONE
  buzzerPwm.attachPin(PIN_BUZZER, BUZZER_FREQ, 10);
  buzzerPwm.writeScaled(0.0f);
#else
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
#endif

  setupWifi();
  setupEspNow();
  setupServer();
  beep(BEEP_BOOT);
}

void loop() {
  static bool wasOnline = false;
  static uint32_t lastDisplayMs = 0;
  uint32_t now = millis();

  checkWifi();
  processEspNow(now);

  bool online;
  const uint8_t *beepReq;
  {
    Lock l;
    online = camOnlineLocked(now);
    beepReq = requestedBeep;
    requestedBeep = nullptr;
    if (online != wasOnline) logEventLocked(online ? EV_CAM_ONLINE : EV_CAM_OFFLINE, -1, 0);
  }
  if (online != wasOnline) {
    Serial.printf("[CAM] %s\n", online ? "online" : "OFFLINE (no ESP-NOW for 3 s)");
    wasOnline = online;
  }
  if (beepReq) beep(beepReq);

  updateGate(now);
  updateBuzzer(now);
  updateLeds(now);

  if (now - lastDisplayMs >= DISPLAY_INTERVAL_MS) {
    lastDisplayMs = now;
    updateDisplay(now);
  }

  delay(5);
}
