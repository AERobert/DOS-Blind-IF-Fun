#!/bin/bash
#
# Accessible DOS Text Adventure Player — Launcher
# =================================================
# Double-click this file on macOS to:
#   1. Start a local web server in this folder
#   2. Open the game player in your default browser
#
# Prefers the Node.js server (with workspace support) if node/npm
# are installed.  Falls back to Python's built-in HTTP server.
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

PORT=${PORT:-8000}

# Open the browser after a short delay (give server time to start)
(sleep 2 && open "http://localhost:$PORT/index.html" 2>/dev/null || true) &

if command -v node >/dev/null 2>&1 && [ -f package.json ]; then
    # Install dependencies if needed
    if [ ! -d node_modules ]; then
        echo "Installing dependencies..."
        npm install --production 2>&1
        echo ""
    fi

    echo "Starting Node.js server on port $PORT..."
    echo "(Workspace features enabled)"
    echo ""
    echo "To stop the server, close this window"
    echo "or press Ctrl+C."
    echo ""
    echo "---------------------------------------------"
    node server.js
else
    echo "Starting Python HTTP server on port $PORT..."
    echo "(Workspace features require Node.js — install"
    echo " Node.js and run 'npm install' to enable them)"
    echo ""
    echo "To stop the server, close this window"
    echo "or press Ctrl+C."
    echo ""
    echo "---------------------------------------------"
    python3 -m http.server "$PORT"
fi
