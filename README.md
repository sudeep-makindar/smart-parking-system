# Smart Parking System

An ESP32-CAM watches 4 parking bays and detects cars with background subtraction.
It sends slot states over ESP-NOW to an ESP32-S3, which drives LEDs, an OLED, and an
entry gate. The S3 also hosts a Wi-Fi network that serves a React dashboard.

```
ESP32-CAM ──ESP-NOW──► ESP32-S3 ──Wi-Fi AP "SmartParking"──► phone / laptop browser
(detect + MJPEG :81)   (LEDs, OLED, gate, HTTP API + dashboard)   http://192.168.4.1
```

There is no Python and no serial bridge. The browser polls `GET /api/status` every 1.5 s
and shows the camera stream from `http://192.168.4.2:81/stream`.

```
firmware/esp32cam/esp32cam.ino   vision node (OV3660)
firmware/esp32s3/esp32s3.ino     controller, Soft-AP, web server
dashboard/                       Vite + React + TypeScript + Tailwind
scripts/upload_dashboard.sh      build the dashboard and flash it to SPIFFS
```

## 1. Try the dashboard without hardware

```bash
cd dashboard
npm install
npm run dev:mock        # http://localhost:5173 with a simulated parking lot
```

You can also open any build with `?mock` in the URL, e.g. `http://localhost:5173/?mock`.

## 2. Wiring

**ESP32-S3**

| Part | Connection |
|---|---|
| OLED SSD1306 (I2C 0x3C) | VCC→3V3, GND→GND, SDA→GPIO 8, SCL→GPIO 9 |
| Slot LEDs | GPIO → 220 Ω → LED anode, cathode → GND |
| A1 green / red | GPIO 1 / GPIO 2 |
| A2 green / red | GPIO 3 / GPIO 4 |
| A3 green / red | GPIO 5 / GPIO 6 |
| A4 green / red | GPIO 7 / GPIO 15 |
| SG90 servo | signal→GPIO 16, red→**5 V** supply, brown→GND |
| IR obstacle sensor | VCC→**3V3**, GND→GND, OUT→GPIO 17 (active LOW) |

**ESP32-CAM (AI-Thinker)**: connect a push button between GPIO 13 and GND. The onboard
LED on GPIO 33 is the status LED.

Important:
- Power the IR module from 3.3 V. Its output follows its supply, and the S3 pins are not 5 V tolerant.
- Power the servo from the 5 V rail, not the S3's 3V3 pin. Connect all grounds together.
- The ESP32-CAM needs a stable **5 V 2 A** supply. A weak USB port causes brownout resets and camera init failures.
- If your IR module's output is HIGH when it detects a car, change `IR_ACTIVE_LEVEL` in `esp32s3.ino`.

## 3. Arduino IDE setup (2.x)

1. Boards Manager: install **esp32 by Espressif** (2.0.x or 3.x).
2. Library Manager: install these libraries.
   - **ESPAsyncWebServer** and **AsyncTCP** by *ESP32Async*. The old me-no-dev versions do not build on core 3.x.
   - **ArduinoJson** 7.x
   - **Adafruit SSD1306** (installs Adafruit GFX too)
   - **ESP32Servo**
   - The camera, ESP-NOW, SPIFFS, and Wi-Fi libraries come with the ESP32 core.

| Sketch | Board | Partition scheme |
|---|---|---|
| `esp32s3.ino` | ESP32S3 Dev Module (USB CDC On Boot: Enabled) | Default 4MB with spiffs, or 8M with spiffs |
| `esp32cam.ino` | AI Thinker ESP32-CAM (PSRAM enabled) | Huge APP (3MB No OTA/1MB SPIFFS) |

## 4. Bring-up order

1. **Flash the ESP32-S3.** In the Serial Monitor (115200) you should see `AP "SmartParking" on channel 1`.
   The LEDs run a green chase while it waits for the camera.
2. **Upload the dashboard** to the S3 (the sketch must already be flashed):
   ```bash
   scripts/upload_dashboard.sh /dev/cu.usbmodem101   # your S3 port
   ```
   The script builds the dashboard, gzips it into `firmware/esp32s3/data/`, reads the board's
   partition table to find SPIFFS, then flashes it with `mkspiffs` and `esptool` from the Arduino core.
   If you run it without a port, it only stages the files and prints the steps for the
   Arduino IDE SPIFFS-upload plugin.
3. **Flash the ESP32-CAM** using the ESP32-CAM-MB board. With the lot **empty**, power it on.
   - It joins the AP as `192.168.4.2`.
   - It locks exposure after 3 s.
   - On first boot it automatically captures the empty reference.
   - The status LED blinks 3 times when the reference is saved.
4. **Open the dashboard.** Join Wi-Fi `SmartParking` / `park1234` and open **http://192.168.4.1**.

## 5. Tuning detection

- **ROIs:** open `http://192.168.4.2:81/`. The slot rectangles and the dashed brightness-reference
  patch are drawn on the live image. Edit `SLOT_ROIS` and `REF_PATCH` in `esp32cam.ino` until
  each box sits inside one bay, then re-flash.
- **Recalibrate:** empty the lot, then either press the GPIO 13 button or click
  **Settings → Recalibrate Camera**. The camera averages 10 frames and saves them to
  `/ref.bin` in its SPIFFS.
- **Thresholds:** use **Settings → Detection Thresholds**. Values are stored in the camera's NVS
  and survive reboots.
  - Lower `pix_thresh` to catch dark cars on a dark mat.
  - Raise `t_high` if shadows cause false "occupied".
  - Score readouts (`Score: 72%` on each slot card) show the ratio the thresholds are compared against.

## 6. HTTP API (ESP32-S3, `192.168.4.1`)

| Method & path | Description |
|---|---|
| `GET /api/status` | Slot states, scores, `free_count`, `gate_open`, `cam_online`, `guidance`, `cam_stream_url`, … |
| `GET /api/history` | Per-slot `total_occupied_s` and `change_count` since boot |
| `GET /api/config` | Firmware version, AP info, current thresholds, `calib_count`, ROIs reported by the camera |
| `POST /api/calibrate` | Relays a calibration command to the camera (`503` if the camera is offline) |
| `POST /api/settings` | Body `{"pix_thresh":35,"t_high":0.30,"t_low":0.15}`, validated then relayed |
| `POST /api/time` | Body `{"epoch":…}`. The dashboard sends this automatically so `since` values are real Unix times |
| `GET /api/events?since=N` | Event log (slot changes, gate, tickets, camera, calibration) newer than sequence `N` |
| `GET /api/tickets` | Recent parking tickets with state, bay, duration and fee |
| `GET /api/ticket?id=1001` | One ticket, used by the phone ticket page |

`/api/status` also returns these fields beyond the original spec: `ir_active`, `cars_entered`,
`last_entry_ago_s`, `occupied_for_s` (per slot), `time_synced`, and `cam_last_seen_ms`.

Every response sends `Access-Control-Allow-Origin: *`, and `OPTIONS` preflights get a `204`.

ESP-NOW packets:
- Camera → controller: `parking_msg_t` (10 bytes), and `config_msg_t` (47 bytes) every 5 s.
- Controller → camera: `command_msg_t` (6 bytes), sent 3 times and de-duplicated by `cmd_id`.

## 7. Demo features

- **Vision debug view** (*Live Feed*): switch the stream between **Raw**, **Difference** (`|frame − reference|`)
  and **Mask** (pixels over the threshold), with live per-bay boxes and scores drawn over it. The camera
  serves these at `/stream?mode=raw|diff|mask`.
- **Parking tickets**: every gate opening issues a ticket for the suggested bay. The ticket is linked to
  the bay the car actually takes and closed with a fee when the car leaves. The fee is ₹20/hour with a
  ₹10 minimum; change `FEE_PER_HOUR` and `FEE_MINIMUM` in `esp32s3.ino`.
- **Entrance sign** (`http://192.168.4.1/#/sign`): a full-screen display for a tablet at the gate.
  It shows free spaces, the next bay, and "FULL". When a car enters it shows the bay and a QR code for
  the ticket. Press **Enable voice** once to turn on spoken announcements.
- **Phone ticket** (`#/ticket/<id>`): scan the QR code while connected to the SmartParking Wi-Fi to see
  the bay, live parking time and fee.
- **Timeline and activity** (*Analytics*): per-bay occupancy over the last 5 minutes, 15 minutes or 1 hour,
  with gate entries and turned-away cars marked, plus a live event log and a tickets table.

## 8. Developing the dashboard against real hardware

```bash
cd dashboard
cp .env.example .env.local      # VITE_API_URL=http://192.168.4.1
npm run dev                     # laptop must be on the SmartParking Wi-Fi
```

## Known limitations

- **One stream viewer at a time.** The ESP32-CAM's `esp_http_server` serves one MJPEG client.
  A second viewer sees "Camera Offline" and retries every 5 s. The dashboard closes its stream
  when you switch tabs, so the slot is freed.
- **No internet on the AP.** The Inter font can't load from Google Fonts, so the system font is used.
  Phones may warn "no internet". Choose *Stay connected*, and on Android turn off
  *Switch to mobile data* for this network.
- **Wrong reference if cars are present.** The automatic first-boot calibration assumes the lot is empty.
  If cars were parked at the time, recalibrate.
- **Session data resets.** History and the entry counter are kept in RAM and reset when the S3 reboots.
