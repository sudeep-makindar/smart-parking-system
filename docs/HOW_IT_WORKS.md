# How it works

## Network

The ESP32-CAM runs a Wi-Fi access point, **`ParkingCam`** (`park1234`, channel 1, IP
`192.168.4.1`). The controller and the dashboard device join it as normal Wi-Fi clients.
Because the controller is on the camera's channel, ESP-NOW frames between the two boards
reach it directly.

| Link | Protocol | Carries |
|---|---|---|
| Camera → controller | ESP-NOW broadcast, about every 500 ms and on change | `parking_msg_t`: zone, 4 slot states, 4 scores, sequence number (10 bytes) |
| Camera → dashboard | HTTP `:80`, MJPEG `:81` | Slot array, scores, calibration and thresholds; live video |
| Controller → dashboard | HTTP `:80` | Gate, IR, LEDs, buzzer, slots with durations, tickets, events |
| Dashboard → nodes | HTTP POST | Calibrate, thresholds (camera); gate mode, buzzer test, clock (controller) |

ESP-NOW is used between the boards because it's a single direct radio frame. It needs no
connection set-up or HTTP, and it keeps working even when the dashboard is closed.

## Occupancy detection (camera node)

The sensor delivers 320×240 JPEG frames. They go straight to the video stream with no CPU work.
About twice a second, one frame is also decoded for detection:

1. **Grayscale:** the frame is decoded and converted to 8-bit grayscale.
2. **Smoothing:** a separable 5×5 Gaussian filter (`[1 4 6 4 1] / 16` in each direction)
   removes sensor noise.
3. **Brightness correction:** the mean of the always-empty **REF** patch in the reference image
   is compared with its mean now. The difference (limited to ±80) is added to every pixel, which
   cancels uniform light changes.
4. **Background subtraction:** inside each slot's rectangle (ROI), a pixel counts as *changed*
   when `|frame + offset − reference| > PIX_THRESH` (default 35).
5. **Score:** `changed pixels / ROI pixels × 100`.
6. **Hysteresis:** a slot becomes occupied above **T_HIGH** (30%) and free below **T_LOW** (15%).
   In between, it keeps its previous state.
7. **Debounce:** a new state must hold for **4 consecutive checks** (about 2 s), so hands and
   shadows passing over a slot are ignored.

**Calibration** averages 10 smoothed frames of the empty lot into the reference image and saves
it to SPIFFS, so it survives a restart. It happens automatically on first boot, and on demand
from the dashboard or the GPIO 13 button. Auto-exposure is locked 3 s after start-up, so the
camera doesn't readjust when a dark car appears.

The **Live Feed** page can show the stages:

| View | What it shows |
|---|---|
| **Raw** | The camera image |
| **Difference** | `|frame − reference|`, brightened 3× |
| **Mask** | Pixels above the threshold |

## Gate logic (controller node)

| Mode | Behaviour |
|---|---|
| **Auto** (default) | Car at the IR sensor and a slot free → gate opens, short beep, ticket issued. The gate closes 5 s after the sensor clears. Lot full → stays closed, double beep, *entry denied* logged. A refused car that keeps waiting is let in as soon as a slot frees. |
| **Open** | Barrier held open; arriving cars still get tickets |
| **Closed** | Barrier held closed; arriving cars are refused |

The IR input is debounced (50 ms). If no ESP-NOW frame arrives for 3 s, the camera link is
marked offline.

## Tickets and events

- **Tickets:** every admitted car gets a ticket (from #1001) for the first free slot. The
  ticket is linked to whichever slot the car actually occupies, so a driver who picks a
  different slot is still tracked. When that slot frees, the ticket closes with a fee of
  ₹20/hour, rounded up to the minute, with a ₹10 minimum.
- **Events:** slot changes, gate moves, refusals, tickets, camera link changes and gate-mode
  changes go into a 120-entry ring buffer. The dashboard reads only the events it hasn't seen
  (`/api/events?since=N`).

## Dashboard

- **Nodes:** the dashboard keeps a list of nodes (name, type, IP) in the browser's local
  storage. The first camera and first controller drive the pages.
- **Polling:** both nodes are polled every second. Slot states come **directly from the camera**;
  durations, gate, tickets and events come from the controller.
- **Clock:** the browser sets the controller's clock on first contact, because the board has
  no real-time clock.
