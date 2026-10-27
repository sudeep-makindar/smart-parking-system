#!/usr/bin/env bash
#
# Build the React dashboard and upload it to the ESP32-S3's SPIFFS partition.
#
#   scripts/upload_dashboard.sh                      # build + stage only, then print instructions
#   scripts/upload_dashboard.sh /dev/cu.usbmodem101  # build + stage + flash SPIFFS over USB
#
# Options (environment variables):
#   SCHEME=default4mb|default8mb|default16mb   partition preset if auto-detection fails
#   SPIFFS_OFFSET=0x290000 SPIFFS_SIZE=0x160000  explicit partition (overrides everything)
#   SKIP_BUILD=1                                reuse the existing dashboard/dist
#   BAUD=921600
#
# Needs: node/npm, gzip, and for flashing `mkspiffs` + `esptool` (both ship with the
# ESP32 Arduino core; the script finds them in ~/Library/Arduino15 or ~/.arduino15).
#
# Close the Arduino IDE Serial Monitor before flashing; it holds the port.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASH="$ROOT/dashboard"
DATA="$ROOT/firmware/esp32s3/data"
BUILD_TMP="$ROOT/firmware/esp32s3/.spiffs_build"
PORT="${1:-${PORT:-}}"
BAUD="${BAUD:-921600}"
SCHEME="${SCHEME:-default4mb}"
SPIFFS_NAME_MAX=31  # SPIFFS_OBJ_NAME_LEN (32) minus the terminator

green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
red() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }
die() { red "Error: $*"; exit 1; }

# ── 1. Build ─────────────────────────────────────────────────────────
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  green "==> Building dashboard"
  command -v npm >/dev/null || die "npm not found. Install Node.js 18+."
  (
    cd "$DASH"
    [[ -d node_modules ]] || npm install
    npm run build
  )
fi
[[ -f "$DASH/dist/index.html" ]] || die "dashboard/dist/index.html missing. Did the build fail?"

# ── 2. Stage gzipped files into firmware/esp32s3/data ────────────────
green "==> Staging gzipped files in firmware/esp32s3/data"
rm -rf "$DATA"
mkdir -p "$DATA"
(
  cd "$DASH/dist"
  find . -type f | while read -r f; do
    rel="${f#./}"
    if [[ "$rel" == */* ]]; then
      die "nested file '$rel': SPIFFS has no folders, keep vite output flat (see vite.config.ts)"
    fi
    name="/$rel.gz"
    (( ${#name} <= SPIFFS_NAME_MAX )) || die "'$name' is ${#name} chars; SPIFFS allows $SPIFFS_NAME_MAX"
    gzip -9 -n -c "$rel" > "$DATA/$rel.gz"
  done
)
TOTAL_BYTES=$(find "$DATA" -type f -exec cat {} + | wc -c | tr -d ' ')
ls -l "$DATA" | awk 'NR>1 {printf "    %8d  %s\n", $5, $9}'
echo "    total: $TOTAL_BYTES bytes"

print_ide_instructions() {
  cat <<EOF

$(yellow "Upload with the Arduino IDE 2.x instead:")
  1. Install the SPIFFS upload plugin for IDE 2.x:
       https://github.com/espx-cz/arduino-spiffs-upload  (download the .vsix into
       ~/.arduinoIDE/plugins/ and restart the IDE)
  2. Open firmware/esp32s3/esp32s3.ino. Its data/ folder now holds the dashboard.
  3. Select the same board + Partition Scheme you flashed the sketch with.
  4. Close the Serial Monitor, then press Cmd/Ctrl+Shift+P and run
       "Upload SPIFFS to Pico/ESP8266/ESP32".
  5. Join Wi-Fi "SmartParking" (password park1234) and open http://192.168.4.1

Or pass the serial port to this script to flash directly:
  scripts/upload_dashboard.sh /dev/cu.usbmodem101
EOF
}

if [[ -z "$PORT" ]]; then
  print_ide_instructions
  exit 0
fi

# ── 3. Locate tools ──────────────────────────────────────────────────
find_tool() {
  local name="$1" sub="$2" found=""
  found="$(command -v "$name" 2>/dev/null || true)"
  if [[ -z "$found" ]]; then
    for base in "$HOME/Library/Arduino15" "$HOME/.arduino15" "${LOCALAPPDATA:-/nonexistent}/Arduino15"; do
      found="$(ls -1d "$base"/packages/esp32/tools/"$sub"/*/"$name" 2>/dev/null | sort -V | tail -1 || true)"
      [[ -n "$found" ]] && break
    done
  fi
  echo "$found"
}

MKSPIFFS="$(find_tool mkspiffs mkspiffs)"
ESPTOOL="$(find_tool esptool esptool_py)"
[[ -n "$ESPTOOL" ]] || ESPTOOL="$(find_tool esptool.py esptool_py)"
if [[ -z "$MKSPIFFS" || -z "$ESPTOOL" ]]; then
  red "Could not find mkspiffs and/or esptool."
  echo "  Install the ESP32 core in the Arduino IDE (Boards Manager > esp32), or put both on your PATH."
  print_ide_instructions
  exit 1
fi
echo "    mkspiffs: $MKSPIFFS"
echo "    esptool:  $ESPTOOL"

# ── 4. Find the SPIFFS partition ─────────────────────────────────────
# Reads the partition table at 0x8000 from the board and picks the data/spiffs
# entry (type 0x01, subtype 0x82). Falls back to the SCHEME preset.
detect_partition() {
  local pt="$BUILD_TMP/partitions.bin"
  "$ESPTOOL" --chip esp32s3 --port "$PORT" --baud "$BAUD" read_flash 0x8000 0xC00 "$pt" >/dev/null 2>&1 || return 1
  od -An -v -tx1 "$pt" | tr -s ' \n' ' ' | awk '{
    for (i = 1; i + 31 <= NF; i += 32) {
      if ($i != "aa" || $(i+1) != "50") continue
      if ($(i+2) == "01" && $(i+3) == "82") {
        printf "0x%s%s%s%s 0x%s%s%s%s\n", $(i+7),$(i+6),$(i+5),$(i+4), $(i+11),$(i+10),$(i+9),$(i+8)
        exit
      }
    }
  }'
}

mkdir -p "$BUILD_TMP"
if [[ -n "${SPIFFS_OFFSET:-}" && -n "${SPIFFS_SIZE:-}" ]]; then
  OFFSET="$SPIFFS_OFFSET"; SIZE="$SPIFFS_SIZE"
  echo "    partition: from SPIFFS_OFFSET/SPIFFS_SIZE"
else
  green "==> Reading partition table from $PORT"
  DETECTED="$(detect_partition || true)"
  if [[ -n "$DETECTED" ]]; then
    read -r OFFSET SIZE <<<"$DETECTED"
    echo "    partition: detected on the board"
  else
    yellow "    could not read a SPIFFS partition from the board; using preset '$SCHEME'"
    case "$SCHEME" in
      default4mb)  OFFSET=0x290000; SIZE=0x160000 ;;  # Default 4MB with spiffs
      default8mb)  OFFSET=0x670000; SIZE=0x180000 ;;  # 8M with spiffs (3MB APP/1.5MB SPIFFS)
      default16mb) OFFSET=0xc90000; SIZE=0x360000 ;;  # default_16MB.csv (6.25MB APP/3.4MB SPIFFS)
      *) die "unknown SCHEME '$SCHEME'" ;;
    esac
  fi
fi
echo "    SPIFFS at $OFFSET, size $SIZE ($((SIZE)) bytes)"
(( TOTAL_BYTES < SIZE * 9 / 10 )) || die "dashboard ($TOTAL_BYTES B) does not fit comfortably in SPIFFS ($((SIZE)) B)"

# ── 5. Pack and flash ────────────────────────────────────────────────
IMG="$BUILD_TMP/spiffs.bin"
green "==> Packing SPIFFS image"
"$MKSPIFFS" -c "$DATA" -b 4096 -p 256 -s "$((SIZE))" "$IMG"

green "==> Flashing SPIFFS to $PORT"
"$ESPTOOL" --chip esp32s3 --port "$PORT" --baud "$BAUD" write_flash "$OFFSET" "$IMG"

green "==> Done. Join Wi-Fi \"SmartParking\" (park1234) and open http://192.168.4.1"
