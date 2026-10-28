# Node API

Every response is JSON with `Access-Control-Allow-Origin: *` (and
`Access-Control-Allow-Private-Network: true`), so the dashboard can be served from anywhere.
POST bodies are JSON; they can be sent as `text/plain` to avoid a CORS preflight.

## Camera node: `http://192.168.4.1`

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Live slot array and node health |
| GET | `/api/config` | Thresholds, calibration state, ROI rectangles |
| POST | `/api/calibrate` | Capture a new empty-lot reference (about 1 s) |
| POST | `/api/settings` | `{"pix_thresh": 35, "t_high": 0.30, "t_low": 0.15}`, stored in flash |
| GET | `:81/` | Viewer page with slot boxes |
| GET | `:81/stream?mode=raw\|diff\|mask&overlay=0\|1` | MJPEG stream (one viewer at a time) |

```json
// GET /api/status
{
  "node": "camera", "name": "parking-cam", "firmware": "2.1.0", "zone": "A",
  "slots": [1, 0, 0, 0], "scores": [72, 6, 4, 9],
  "seq": 118, "uptime_s": 342,
  "calibrated": true, "calibrating": false, "calib_count": 1,
  "ip": "192.168.4.1", "rssi": 0, "clients": 2, "stream_port": 81
}
```

## Controller node: `http://<ip from OLED>`

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Slots with durations, gate, IR, LEDs, buzzer, camera link, counters |
| GET | `/api/history` | Per-slot occupied time and number of changes since boot |
| GET | `/api/events?since=N` | Events newer than sequence number `N` |
| GET | `/api/tickets` | Last 16 tickets, newest first |
| GET | `/api/ticket?id=1001` | One ticket |
| POST | `/api/gate` | `{"mode": "auto" \| "open" \| "closed"}` |
| POST | `/api/buzzer` | `{"pattern": "beep" \| "double" \| "long"}` |
| POST | `/api/time` | `{"epoch": 1793000000}` (the dashboard sends this automatically) |

```json
// GET /api/status (abridged)
{
  "node": "controller", "ip": "192.168.4.2", "zone": "A",
  "slots": [{"id": "A1", "occupied": true, "score": 72, "since": 1793000000, "occupied_for_s": 95}],
  "leds": {"slots": [false, true, true, true], "pass": false, "stop": true},
  "free_count": 3, "total_slots": 4, "guidance": "Go to Slot A2",
  "cam_online": true, "cam_last_seen_ms": 210,
  "gate_open": false, "gate_mode": "auto", "servo_angle": 0,
  "ir_active": false, "buzzer_on": false,
  "cars_entered": 5, "cars_denied": 1, "last_entry_ago_s": 40,
  "event_seq": 37, "last_ticket": {"id": 1005, "bay": "A2", "entry_ago_s": 40}
}
```

**Event types:**
- `slot_occupied`, `slot_free`
- `gate_open`, `gate_close`, `gate_mode`
- `entry_denied` (value 0 = full, 1 = gate held closed)
- `ticket_issued`, `ticket_closed`
- `cam_online`, `cam_offline`

## ESP-NOW frame (camera → controller)

```c
typedef struct __attribute__((packed)) {
  uint8_t zone_id;    // 'A'
  uint8_t slots[4];   // 1 = occupied
  uint8_t scores[4];  // 0-100
  uint8_t sequence;   // rolling counter
} parking_msg_t;      // 10 bytes, broadcast
```
