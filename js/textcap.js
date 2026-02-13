"use strict";

/* ═══════════════════════════════════════════
 * TextCap — serial-based text capture for graphics-mode games
 * ═══════════════════════════════════════════
 *
 * When the TEXTCAP.COM TSR is running in the guest, it hooks INT 10h
 * and mirrors all BIOS text output to COM1 with ANSI cursor positioning.
 * This parser receives those serial bytes and maintains a virtual
 * 25x80 text buffer that replaces the VGA screen buffer for the
 * accessible display.
 *
 * Protocol from TSR:
 *   Startup marker:  ESC [ T C ]
 *   Cursor move:     ESC [ row ; col H   (1-based, standard ANSI CUP)
 *   Text:            raw bytes (printable ASCII)
 *   Newlines:        CR (0x0D) and LF (0x0A) advance cursor accordingly
 */

/**
 * Initialize the TextCap screen buffer — a 25x80 grid of spaces.
 * Called when we detect the TSR startup marker on the serial port.
 */
function initTextCapBuffer() {
    textCapBuffer = [];
    for (let r = 0; r < ROWS; r++) {
        textCapBuffer[r] = new Array(COLS).fill(0x20);
    }
    textCapCurRow = 0;
    textCapCurCol = 0;
    textCapDirty = false;
    textCapParseState = TC_NORMAL;
    textCapCsiParams = "";
}

/**
 * Convert a TextCap buffer row to a display string.
 * Uses CP437 mapping for consistency with the VGA screen buffer.
 */
function textCapRowToString(r) {
    if (!textCapBuffer || !textCapBuffer[r]) return " ".repeat(COLS);
    let s = "";
    for (let c = 0; c < COLS; c++) {
        const code = textCapBuffer[r][c];
        /* TextCap sends ASCII; map through CP437 for consistency */
        s += (code < CP437.length) ? CP437[code] : String.fromCharCode(code);
    }
    return s;
}

/**
 * Process one serial byte through the TextCap ANSI parser.
 * Handles the subset of ANSI we emit: ESC[row;colH for cursor
 * positioning, plus raw printable characters.
 */
function textCapParseByte(byte) {
    switch (textCapParseState) {

    case TC_NORMAL:
        if (byte === 0x1B) {
            /* ESC — begin escape sequence */
            textCapParseState = TC_ESC;
        } else if (byte === 0x0D) {
            /* Carriage Return — move to column 0 */
            textCapCurCol = 0;
        } else if (byte === 0x0A) {
            /* Line Feed — advance row, scroll if needed */
            textCapCurRow++;
            if (textCapCurRow >= ROWS) {
                textCapScrollUp();
                textCapCurRow = ROWS - 1;
            }
            textCapDirty = true;
        } else if (byte === 0x08) {
            /* Backspace — move cursor left */
            if (textCapCurCol > 0) textCapCurCol--;
        } else if (byte >= 0x20) {
            /* Printable character — write to buffer and advance */
            if (textCapCurRow >= 0 && textCapCurRow < ROWS &&
                textCapCurCol >= 0 && textCapCurCol < COLS) {
                textCapBuffer[textCapCurRow][textCapCurCol] = byte;
                textCapDirty = true;
            }
            textCapCurCol++;
            if (textCapCurCol >= COLS) {
                /* Wrap to next line */
                textCapCurCol = 0;
                textCapCurRow++;
                if (textCapCurRow >= ROWS) {
                    textCapScrollUp();
                    textCapCurRow = ROWS - 1;
                }
            }
        }
        break;

    case TC_ESC:
        if (byte === 0x5B) {
            /* ESC [ — begin CSI sequence */
            textCapParseState = TC_CSI;
            textCapCsiParams = "";
        } else {
            /* Unknown escape, return to normal */
            textCapParseState = TC_NORMAL;
        }
        break;

    case TC_CSI:
        if (byte >= 0x30 && byte <= 0x3F) {
            /* Parameter byte: digits 0-9, semicolon, etc. */
            textCapCsiParams += String.fromCharCode(byte);
        } else if (byte >= 0x20 && byte <= 0x2F) {
            /* Intermediate byte — accumulate but we don't use these */
            textCapCsiParams += String.fromCharCode(byte);
        } else {
            /* Final byte — dispatch the CSI command */
            textCapDispatchCSI(byte, textCapCsiParams);
            textCapParseState = TC_NORMAL;
        }
        break;

    default:
        textCapParseState = TC_NORMAL;
    }
}

/**
 * Dispatch a CSI (Control Sequence Introducer) command.
 * We only handle 'H' (Cursor Position), 'J' (Erase Display), and 'K' (Erase in Line).
 */
function textCapDispatchCSI(cmd, params) {
    const parts = params.split(";").map(s => {
        const n = parseInt(s, 10);
        return isNaN(n) ? -1 : n; /* -1 = parameter was absent */
    });

    switch (cmd) {
    case 0x48: /* 'H' — Cursor Position: ESC[row;colH (defaults 1;1) */
        textCapCurRow = Math.max(0, Math.min(ROWS - 1, (parts[0] > 0 ? parts[0] : 1) - 1));
        textCapCurCol = Math.max(0, Math.min(COLS - 1, (parts[1] > 0 ? parts[1] : 1) - 1));

        /* Auto-clear from cursor to end of line when the game repositions. */
        for (let c = textCapCurCol; c < COLS; c++) {
            textCapBuffer[textCapCurRow][c] = 0x20;
        }
        textCapDirty = true;
        break;

    case 0x4A: /* 'J' — Erase in Display (default 0, we handle 2) */
        if (parts[0] === 2) {
            /* Clear entire screen */
            for (let r = 0; r < ROWS; r++) {
                textCapBuffer[r].fill(0x20);
            }
            textCapDirty = true;
        }
        break;

    case 0x4B: /* 'K' — Erase in Line (default 0 = cursor to EOL) */
        if (parts[0] <= 0) { /* 0 or absent (-1) both mean "erase to EOL" */
            /* Clear from cursor to end of line */
            for (let c = textCapCurCol; c < COLS; c++) {
                textCapBuffer[textCapCurRow][c] = 0x20;
            }
            textCapDirty = true;
        }
        break;
    }
}

/**
 * Scroll the TextCap buffer up by one line.
 * The top line is lost; the bottom line becomes blank.
 */
function textCapScrollUp() {
    if (!textCapBuffer) return;
    textCapBuffer.shift();
    textCapBuffer.push(new Array(COLS).fill(0x20));
    textCapDirty = true;
}

/**
 * Render the TextCap buffer to the accessible screen DOM.
 * Called periodically when textCapDirty is true and graphics mode
 * is detected (no screen-put-char events available).
 */
function renderTextCapScreen() {
    if (!textCapBuffer || !textCapDirty) return;
    textCapDirty = false;

    for (let r = 0; r < ROWS; r++) {
        const el = document.getElementById("screen-line-" + r);
        if (!el) continue;
        const line = textCapRowToString(r);
        const trimmed = line.trimEnd();
        el.textContent = trimmed || "\u00A0";
        el.setAttribute("aria-label", "Line " + (r + 1) + ": " + (trimmed || "blank"));
    }
}

/**
 * Detect the TextCap TSR startup marker: ESC [ T C ]
 * Returns true if the 5-byte marker has been fully received.
 */
function checkTextCapMarker(byte) {
    if (byte === TC_MARKER[textCapMarkerPos]) {
        textCapMarkerPos++;
        if (textCapMarkerPos >= TC_MARKER.length) {
            textCapMarkerPos = 0;
            return true; /* marker fully matched */
        }
    } else {
        textCapMarkerPos = 0;
    }
    return false;
}
