#!/bin/bash
#
# Accessible Retro Text Adventure Player — Launcher
# ===================================================
# Double-click this file on macOS to:
#   1. Download any missing emulator libraries and game disks
#   2. Start a local web server in this folder
#   3. Open the game player in your default browser
#
# To stop the server, close the Terminal window that opens,
# or press Ctrl+C in that window.
#

# Move to the directory where this script lives
cd "$(dirname "$0")"

echo "============================================="
echo "  Accessible Retro Text Adventure Player"
echo "============================================="
echo ""

# ── Helper: download a file if it doesn't exist ──────────────────
download() {
    local url="$1"
    local dest="$2"
    if [ -f "$dest" ]; then
        return 0
    fi
    mkdir -p "$(dirname "$dest")"
    echo "  Downloading $(basename "$dest")..."
    curl -sL -A "Mozilla/5.0" -o "$dest" "$url"
    if [ ! -s "$dest" ]; then
        echo "    WARNING: download failed or empty — $dest"
        rm -f "$dest"
        return 1
    fi
    return 0
}

# ── Check for missing emulator libraries ─────────────────────────
NEED_DOWNLOAD=0

for f in \
    lib/apple2/apple2-lib.bundle.js \
    lib/c64/viciious-lib.js \
    lib/jsbeeb/jsbeeb-lib.js \
    lib/jsbeeb/roms/os.rom \
    lib/jsbeeb/roms/BASIC.ROM \
    lib/jsbeeb/roms/b/DFS-1.2.rom \
    libv86.js \
    v86.wasm \
    lib/fflate.min.js \
; do
    if [ ! -f "$f" ]; then
        NEED_DOWNLOAD=1
        break
    fi
done

if [ "$NEED_DOWNLOAD" = "1" ]; then
    echo "Checking emulator libraries..."
    echo ""

    # v86 (DOS emulator)
    download "https://github.com/nickvdp/nickvdp.github.io/raw/master/libv86.js" \
             "libv86.js"
    download "https://github.com/nickvdp/nickvdp.github.io/raw/master/v86.wasm" \
             "v86.wasm"

    # fflate (compression library)
    download "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js" \
             "lib/fflate.min.js"

    echo ""
fi

# ── Download game disk images ────────────────────────────────────
HAVE_DISKS=0
for dir in gameDisks/bbc gameDisks/apple2 gameDisks/c64; do
    if [ -d "$dir" ] && [ "$(ls -A "$dir" 2>/dev/null)" ]; then
        HAVE_DISKS=1
    fi
done

echo "Checking game disk images..."
echo ""

# ── BBC Micro games (from bbcmicro.co.uk) ────────────────────────

download "https://bbcmicro.co.uk/gameimg/discs/2116/Disc999-GiantKiller.ssd" \
         "gameDisks/bbc/GiantKiller.ssd"

download "https://bbcmicro.co.uk/gameimg/discs/1631/Disc999-QuondamFIN.ssd" \
         "gameDisks/bbc/Quondam.ssd"

download "https://bbcmicro.co.uk/gameimg/discs/1678/Disc094-ColossalAdventureSTD.ssd" \
         "gameDisks/bbc/ColossalAdventure.ssd"

download "https://bbcmicro.co.uk/gameimg/discs/2021/Disc999-ACHETONFin.ssd" \
         "gameDisks/bbc/Acheton.ssd"

download "https://bbcmicro.co.uk/gameimg/discs/2311/Disc999-PhilQuestFIN.ssd" \
         "gameDisks/bbc/PhilosophersQuest.ssd"

# ── Apple II games (from archive.org) ────────────────────────────

download "https://archive.org/download/a2_Zork_I_The_Great_Underground_Empire_1980_Infocom/Zork%20I%20-%20The%20Great%20Underground%20Empire%20%281980%29%28Infocom%29.dsk" \
         "gameDisks/apple2/zork1-apple2.dsk"

download "https://archive.org/download/a2_Hitchhikers_Guide_to_the_Galaxy_The_1984_Infocom_a/Hitchhiker%27s%20Guide%20to%20the%20Galaxy%2C%20The%20%281984%29%28Infocom%29%5Ba%5D.dsk" \
         "gameDisks/apple2/hitchhiker-apple2.dsk"

download "https://archive.org/download/a2_Planetfall_1983_Infocom_a/Planetfall%20%281983%29%28Infocom%29%5Ba%5D.dsk" \
         "gameDisks/apple2/planetfall-apple2.dsk"

# ── Commodore 64 games (from archive.org) ────────────────────────

download "https://archive.org/download/d64_Zork_I_The_Great_Underground_Empire_1983_Infocom/Zork_I_The_Great_Underground_Empire_1983_Infocom.d64" \
         "gameDisks/c64/zork1-c64.d64"

download "https://archive.org/download/Hitchhikers_Guide_to_the_Galaxy_The_1984_Infocom_Side_A/Hitchhikers_Guide_to_the_Galaxy_The_1984_Infocom_Side_A.d64" \
         "gameDisks/c64/hitchhiker-c64.d64"

download "https://archive.org/download/d64_Lurking_Horror_The_1987_Infocom/Lurking_Horror_The_1987_Infocom.d64" \
         "gameDisks/c64/lurking-horror-c64.d64"

echo ""

# ── Count available games ────────────────────────────────────────
DOS_COUNT=$(ls gameDisks/*.img 2>/dev/null | wc -l)
BBC_COUNT=$(ls gameDisks/bbc/*.ssd 2>/dev/null | wc -l)
A2_COUNT=$(ls gameDisks/apple2/*.dsk 2>/dev/null | wc -l)
C64_COUNT=$(ls gameDisks/c64/*.d64 2>/dev/null | wc -l)

echo "Games available:"
echo "  DOS:        $DOS_COUNT disk images"
echo "  BBC Micro:  $BBC_COUNT disk images"
echo "  Apple II:   $A2_COUNT disk images"
echo "  C64:        $C64_COUNT disk images"
echo ""
echo "Starting local web server on port 8000..."
echo "The game will open in your browser shortly."
echo ""
echo "To stop the server, close this window"
echo "or press Ctrl+C."
echo ""
echo "---------------------------------------------"

# Open the browser after a short delay (give server time to start)
# Use 'open' on macOS, 'xdg-open' on Linux, 'start' on Windows/Git Bash
if command -v open &>/dev/null; then
    (sleep 2 && open "http://localhost:8000/index.html") &
elif command -v xdg-open &>/dev/null; then
    (sleep 2 && xdg-open "http://localhost:8000/index.html") &
elif command -v start &>/dev/null; then
    (sleep 2 && start "http://localhost:8000/index.html") &
else
    echo "Open http://localhost:8000/index.html in your browser."
fi

# Start the Python HTTP server (blocks until Ctrl+C)
python3 -m http.server 8000
