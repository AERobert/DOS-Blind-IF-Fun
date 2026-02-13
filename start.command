#!/bin/bash
#
# Accessible DOS Text Adventure Player — Launcher
# =================================================
# Double-click this file on macOS to:
#   1. Start a local web server in this folder
#   2. Open the game player in your default browser
#
# To stop the server, close the Terminal window that opens,
# or press Ctrl+C in that window.
#

# Move to the directory where this script lives
cd "$(dirname "$0")"

echo "============================================="
echo "  Accessible DOS Text Adventure Player"
echo "============================================="
echo ""
echo "Starting local web server on port 8000..."
echo "The game will open in your browser shortly."
echo ""
echo "To stop the server, close this window"
echo "or press Ctrl+C."
echo ""
echo "---------------------------------------------"

# Open the browser after a short delay (give server time to start)
(sleep 2 && open "http://localhost:8000/index.html") &

# Start the Python HTTP server (blocks until Ctrl+C)
python3 -m http.server 8000
