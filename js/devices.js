/* ═══════════════════════════════════════════
 * DOS Device Monitor
 * ═══════════════════════════════════════════
 *
 * Captures output from DOS special devices:
 *   CON    — Console (screen text output)
 *   COM1   — Serial port (AUX is an alias)
 *   LPT1   — Printer (PRN is an alias)
 *
 * v86 exposes:
 *   - screen-put-char events  → CON capture
 *   - serial0-output-byte     → COM1/AUX capture
 *   - LPT1 via MODE LPT1:=COM1: redirect (mixed into serial stream)
 *
 * Each device has its own buffer that can be downloaded as a text file.
 * This lets users test directing game output (e.g. transcript) to
 * devices like COM1 or AUX and capture it in real-time without
 * filesystem flush issues.
 */

import { state,
         devConToggle, devConStatus, devConDownloadBtn, devConClearBtn,
         devCom1Toggle, devCom1Status, devCom1DownloadBtn, devCom1ClearBtn,
         devCom2Toggle, devCom2Status, devCom2DownloadBtn, devCom2ClearBtn, devCom2Preview,
         devCom2SpeakToggle, devCom2MuteScreenToggle, devCom2ReplaceScreenToggle,
         devLpt1Toggle, devLpt1Status, devLpt1DownloadBtn, devLpt1ClearBtn,
         devDownloadAllBtn, devClearAllBtn, devCom1RawToggle, devCom1StripAnsiToggle,
         devConPreview, devCom1Preview, devLpt1Preview,
         promptCharInput } from './state.js';
import { ROWS, COLS } from './constants.js';
import { triggerDownload, announce } from './ui-helpers.js';
import { trace } from './trace.js';
import { speak } from './speech.js';
import { rowToString } from './screen.js';
import { addToHistory, updateHistNav } from './history.js';
import { stripBorder } from './screen.js';

/* ─── CON (Console) capture ─── */

let conSnapshotTimer = null;

/**
 * Start periodic CON capture — snapshots the screen buffer every 200ms
 * and appends any new/changed lines to the CON device buffer.
 */
export function startConCapture() {
    state.deviceCapture.con.enabled = true;
    state.deviceConPrevLines = [];
    /* Take initial snapshot */
    if (state.isReady) {
        state.deviceConPrevLines = getCurrentScreenLines();
    }
    /* Poll for screen changes */
    if (!conSnapshotTimer) {
        conSnapshotTimer = setInterval(conSnapshotPoll, 250);
    }
    trace("DEVICE", "CON capture started");
    updateDeviceUI();
}

export function stopConCapture() {
    state.deviceCapture.con.enabled = false;
    if (conSnapshotTimer) {
        clearInterval(conSnapshotTimer);
        conSnapshotTimer = null;
    }
    trace("DEVICE", "CON capture stopped (" + state.deviceCapture.con.bytes + " bytes)");
    updateDeviceUI();
}

/** Get current screen text as an array of trimmed-right lines */
function getCurrentScreenLines() {
    var lines = [];
    for (var r = 0; r < ROWS; r++) {
        lines.push(rowToString(r));
    }
    return lines;
}

/** Compare current screen to previous snapshot, append new content */
function conSnapshotPoll() {
    if (!state.deviceCapture.con.enabled || !state.isReady) return;

    var current = getCurrentScreenLines();
    var prev = state.deviceConPrevLines;

    /* Simple diff: look for lines that changed */
    var changed = false;
    for (var r = 0; r < ROWS; r++) {
        var curLine = (r < current.length) ? current[r] : "";
        var prevLine = (r < prev.length) ? prev[r] : "";
        if (curLine !== prevLine) {
            var trimmed = curLine.trimEnd();
            if (trimmed.length > 0) {
                state.deviceCapture.con.buffer += trimmed + "\n";
                state.deviceCapture.con.bytes += trimmed.length + 1;
                changed = true;
            }
        }
    }

    state.deviceConPrevLines = current;

    if (changed) {
        updateDeviceStatusLine("con");
    }
}

/* ─── COM1 (Serial Port) capture ─── */

/**
 * ANSI stripping state machine for COM1 capture.
 * Same logic as the LPT1 stripper but independent state.
 * States: 0=normal, 1=got ESC, 2=in CSI sequence
 */
let com1AnsiState = 0;

/**
 * Called from emulator.js for every serial0-output-byte.
 * This captures ALL serial bytes regardless of TextCap or other processing.
 * If "Strip ANSI" is checked, ANSI escape sequences are filtered out.
 */
export function feedCom1Byte(byte) {
    if (!state.deviceCapture.com1.enabled) return;

    state.deviceCapture.com1.bytes++;
    state.deviceCapture.com1.rawBytes.push(byte);

    var stripAnsi = devCom1StripAnsiToggle && devCom1StripAnsiToggle.checked;

    /* If stripping ANSI, use the state machine to skip escape sequences */
    if (stripAnsi) {
        switch (com1AnsiState) {
            case 0: /* normal */
                if (byte === 0x1B) {
                    com1AnsiState = 1;
                    return;
                }
                break; /* fall through to normal text handling */
            case 1: /* got ESC */
                if (byte === 0x5B) {
                    com1AnsiState = 2; /* CSI */
                } else if (byte >= 0x40 && byte <= 0x5F) {
                    com1AnsiState = 0; /* Fe escape, done */
                } else {
                    com1AnsiState = 0; /* unknown, back to normal */
                }
                return;
            case 2: /* in CSI */
                if (byte >= 0x40 && byte <= 0x7E) {
                    com1AnsiState = 0; /* final byte, done */
                }
                return;
        }
    }

    /* Text representation */
    if (byte === 0x0D) {
        /* CR — skip (will get LF next) */
        return;
    }
    if (byte === 0x0A) {
        state.deviceCapture.com1.buffer += "\n";
        return;
    }
    if (byte >= 0x20 && byte < 0x7F) {
        state.deviceCapture.com1.buffer += String.fromCharCode(byte);
    } else {
        /* Non-printable: show as hex if raw mode, skip otherwise */
        if (devCom1RawToggle && devCom1RawToggle.checked) {
            state.deviceCapture.com1.buffer += "<" + byte.toString(16).padStart(2, "0") + ">";
        }
    }
}

/* ─── COM2 (Serial Port 2 — clean transcript channel) ─── */

/** Debounce delay for batching lines before speaking (ms) */
var COM2_SPEECH_DEBOUNCE = 600;

/**
 * Called from emulator.js for every serial1-output-byte (COM2).
 * This is a CLEAN channel — TextCap only uses COM1, so COM2 has
 * only data explicitly sent to it (e.g. game transcript via "script COM2").
 * No ANSI stripping needed since there's no TextCap interference.
 *
 * When "Speak responses" is enabled, accumulates lines and uses a
 * debounce timer + prompt detection to speak game responses.
 */
export function feedCom2Byte(byte) {
    if (!state.deviceCapture.com2.enabled) return;

    state.deviceCapture.com2.bytes++;

    if (byte === 0x0D) return; /* CR — skip */

    if (byte === 0x0A) {
        /* Complete line arrived */
        var line = state.com2LineBuffer;
        state.com2LineBuffer = "";

        /* Always append to download buffer */
        state.deviceCapture.com2.buffer += line + "\n";

        /* Speech processing */
        if (devCom2SpeakToggle && devCom2SpeakToggle.checked) {
            processCom2Line(line);
        }

        /* Keep read-mode transcript source in sync with COM2 capture */
        state.transcriptLines = state.deviceCapture.com2.buffer
            .split("\n")
            .filter(function(l) { return l.length > 0; });
        state.transcriptLineBuffer = "";

        /* Render to screen DOM if replace-screen is enabled */
        if (devCom2ReplaceScreenToggle && devCom2ReplaceScreenToggle.checked) {
            renderCom2ToScreen();
        }
        return;
    }

    if (byte >= 0x20 && byte < 0x7F) {
        state.com2LineBuffer += String.fromCharCode(byte);

        /* Expose in-progress line to read mode and replace-screen rendering */
        state.transcriptLines = state.deviceCapture.com2.buffer
            .split("\n")
            .filter(function(l) { return l.length > 0; });
        state.transcriptLineBuffer = state.com2LineBuffer;

        if (devCom2ReplaceScreenToggle && devCom2ReplaceScreenToggle.checked) {
            renderCom2ToScreen();
        }
    }
}

/**
 * Process a complete line from COM2 for auto-speech.
 * Uses prompt detection to separate player input from game responses.
 * Batches response lines with a debounce timer.
 */
function processCom2Line(line) {
    var trimmed = line.trim();
    if (trimmed.length === 0) return; /* skip blank lines */

    var promptStr = (promptCharInput && promptCharInput.value) || ">";

    /* Check if this line is a player input prompt */
    var stripped = stripBorder(trimmed);
    var isPrompt = stripped.startsWith(promptStr);

    if (isPrompt) {
        /* Prompt line = end of a response block. Speak what we have immediately. */
        flushCom2Speech();
        return;
    }

    /* It's a game response line — add to pending batch */
    state.com2SpeechPending.push(trimmed);

    /* Reset debounce timer — more lines may follow */
    clearTimeout(state.com2SpeechTimer);
    state.com2SpeechTimer = setTimeout(flushCom2Speech, COM2_SPEECH_DEBOUNCE);
}

/**
 * Speak all pending COM2 response lines as a single utterance.
 * Also adds to response log for F7/F8 navigation.
 */
function flushCom2Speech() {
    clearTimeout(state.com2SpeechTimer);
    state.com2SpeechTimer = null;

    if (state.com2SpeechPending.length === 0) return;

    var lines = state.com2SpeechPending;
    state.com2SpeechPending = [];

    var text = lines.join(". ");

    trace("COM2", "Speaking " + lines.length + " lines: " + text.substring(0, 120));

    /* Cancel any ongoing speech (screen changes etc.) and speak response */
    speak(text);

    /* Add to response log for F7/F8 navigation */
    var entry = { type: "response", lines: lines };
    state.responseLog.push(entry);
    state.responseNavIndex = state.responseLog.length - 1;
    updateHistNav();
    for (var i = 0; i < lines.length; i++) {
        addToHistory(lines[i], false);
    }

    /* If recording, add to transcript buffer */
    if (state.isRecording) {
        state.transcriptBuffer += lines.join("\n") + "\n\n";
    }

    /* Render to screen DOM if replace-screen is enabled */
    if (devCom2ReplaceScreenToggle && devCom2ReplaceScreenToggle.checked) {
        renderCom2ToScreen();
    }
}

/**
 * Render the last ROWS of COM2 transcript to the accessible screen.
 * This replaces the VGA screen content with clean transcript text.
 */
function renderCom2ToScreen() {
    var allLines = state.deviceCapture.com2.buffer
        .split("\n")
        .filter(function(l) { return l.length > 0; });

    if (state.com2LineBuffer.length > 0) {
        allLines.push(state.com2LineBuffer);
    }

    var startIdx = Math.max(0, allLines.length - ROWS);
    var displayLines = allLines.slice(startIdx);

    for (var r = 0; r < ROWS; r++) {
        var lineText = (r < displayLines.length) ? displayLines[r] : "";
        var el = document.getElementById("screen-line-" + r);
        if (el) {
            el.textContent = lineText || "\u00A0";
            el.setAttribute("aria-label", "Line " + (r + 1) + ": " + (lineText || "blank"));
        }
        state.prevLines[r] = lineText.padEnd(COLS).slice(0, COLS);
    }
}

/**
 * Called from emulator.js for ALL serial bytes (before TextCap processing).
 * Strips ANSI escape sequences to produce clean readable text.
 *
 * When TextCap is active, the serial stream is full of ANSI cursor
 * positioning (ESC[row;colH) and line clearing (ESC[K) codes.
 * This state machine strips them out, keeping only printable text.
 *
 * ANSI escape sequence format:
 *   ESC (0x1B) followed by:
 *   - '[' + parameters + final byte (0x40-0x7E)  = CSI sequence
 *   - single byte (0x40-0x5F)                     = Fe escape
 *   - ']' + ... + BEL/ST                          = OSC (rare)
 *
 * State machine:
 *   0 = normal (pass through printable bytes)
 *   1 = got ESC, waiting for next byte
 *   2 = in CSI sequence (ESC[...), waiting for final byte
 */
let lpt1AnsiState = 0;

export function feedLpt1Byte(byte) {
    if (!state.deviceCapture.lpt1.enabled) return;

    switch (lpt1AnsiState) {
        case 0: /* normal */
            if (byte === 0x1B) {
                /* Start of escape sequence — enter escape state */
                lpt1AnsiState = 1;
                return;
            }
            /* Pass through printable text */
            if (byte === 0x0D) return; /* CR — skip */
            if (byte === 0x0A) {
                state.deviceCapture.lpt1.buffer += "\n";
                state.deviceCapture.lpt1.bytes++;
                return;
            }
            if (byte >= 0x20 && byte < 0x7F) {
                state.deviceCapture.lpt1.buffer += String.fromCharCode(byte);
                state.deviceCapture.lpt1.bytes++;
            }
            /* Skip other control bytes (STX, ETX, BEL, etc.) */
            return;

        case 1: /* got ESC */
            if (byte === 0x5B) {
                /* ESC[ = CSI — enter CSI sequence state */
                lpt1AnsiState = 2;
            } else if (byte >= 0x40 && byte <= 0x5F) {
                /* Fe escape (ESC + single byte like ESC D, ESC M) — done */
                lpt1AnsiState = 0;
            } else if (byte === 0x5D) {
                /* ESC] = OSC — skip until BEL (0x07) or ST (ESC\) */
                /* For simplicity, just go back to normal and let it filter */
                lpt1AnsiState = 0;
            } else {
                /* Unknown escape — go back to normal */
                lpt1AnsiState = 0;
            }
            return;

        case 2: /* in CSI sequence (ESC[...) */
            /* CSI parameters are 0x30-0x3F, intermediates are 0x20-0x2F,
             * final byte is 0x40-0x7E. Stay in state 2 until final byte. */
            if (byte >= 0x40 && byte <= 0x7E) {
                /* Final byte — sequence complete, back to normal */
                lpt1AnsiState = 0;
            }
            /* Otherwise stay in CSI state (parameter/intermediate bytes) */
            return;
    }
}

/** Reset the LPT1 ANSI parser state (call when clearing capture) */
function resetLpt1AnsiState() {
    lpt1AnsiState = 0;
}

/* ─── UI update ─── */

let deviceUITimer = null;

/** Update the status line for a single device */
function updateDeviceStatusLine(dev) {
    var cap = state.deviceCapture[dev];
    var statusEl = null;
    var preview = null;
    if (dev === "con") { statusEl = devConStatus; preview = devConPreview; }
    else if (dev === "com1") { statusEl = devCom1Status; preview = devCom1Preview; }
    else if (dev === "com2") { statusEl = devCom2Status; preview = devCom2Preview; }
    else if (dev === "lpt1") { statusEl = devLpt1Status; preview = devLpt1Preview; }

    if (statusEl) {
        var bytes = cap.bytes;
        var sizeStr = bytes < 1024 ? bytes + " bytes" :
                      bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + " KB" :
                      (bytes / (1024 * 1024)).toFixed(1) + " MB";
        statusEl.textContent = cap.enabled ? sizeStr + " captured" : "off";
        statusEl.style.color = cap.enabled && cap.bytes > 0 ? "var(--success, #2d8a4e)" :
                               cap.enabled ? "var(--warning, #b58900)" : "var(--dim, #888)";
    }

    /* Update preview tail */
    if (preview && cap.enabled && cap.buffer.length > 0) {
        var tail = cap.buffer.length > 300 ? "..." + cap.buffer.slice(-300) : cap.buffer;
        preview.textContent = tail;
        preview.style.display = "";
        preview.scrollTop = preview.scrollHeight;
    } else if (preview) {
        preview.style.display = "none";
    }
}

/** Full UI refresh for all devices */
export function updateDeviceUI() {
    updateDeviceStatusLine("con");
    updateDeviceStatusLine("com1");
    updateDeviceStatusLine("com2");
    updateDeviceStatusLine("lpt1");

    /* Enable/disable download/clear buttons */
    if (devConDownloadBtn) {
        devConDownloadBtn.disabled = state.deviceCapture.con.bytes === 0;
        devConClearBtn.disabled = state.deviceCapture.con.bytes === 0;
    }
    if (devCom1DownloadBtn) {
        devCom1DownloadBtn.disabled = state.deviceCapture.com1.bytes === 0;
        devCom1ClearBtn.disabled = state.deviceCapture.com1.bytes === 0;
    }
    if (devCom2DownloadBtn) {
        devCom2DownloadBtn.disabled = state.deviceCapture.com2.bytes === 0;
        devCom2ClearBtn.disabled = state.deviceCapture.com2.bytes === 0;
    }
    if (devLpt1DownloadBtn) {
        devLpt1DownloadBtn.disabled = state.deviceCapture.lpt1.bytes === 0;
        devLpt1ClearBtn.disabled = state.deviceCapture.lpt1.bytes === 0;
    }
}

/** Start periodic UI refresh when any device is active */
export function startDeviceUIRefresh() {
    if (deviceUITimer) return;
    deviceUITimer = setInterval(updateDeviceUI, 1000);
}

export function stopDeviceUIRefresh() {
    if (deviceUITimer) {
        clearInterval(deviceUITimer);
        deviceUITimer = null;
    }
}

/* ─── Toggle handlers ─── */

export function toggleConCapture() {
    if (state.deviceCapture.con.enabled) {
        stopConCapture();
    } else {
        startConCapture();
    }
    checkDeviceTimers();
}

export function toggleCom1Capture() {
    state.deviceCapture.com1.enabled = !state.deviceCapture.com1.enabled;
    if (state.deviceCapture.com1.enabled) {
        trace("DEVICE", "COM1 capture started");
    } else {
        trace("DEVICE", "COM1 capture stopped (" + state.deviceCapture.com1.bytes + " bytes)");
    }
    updateDeviceUI();
    checkDeviceTimers();
}

export function toggleCom2Capture() {
    state.deviceCapture.com2.enabled = !state.deviceCapture.com2.enabled;
    if (state.deviceCapture.com2.enabled) {
        trace("DEVICE", "COM2 capture started (clean transcript channel)");
    } else {
        trace("DEVICE", "COM2 capture stopped (" + state.deviceCapture.com2.bytes + " bytes)");
        /* Reset speech state on disable */
        state.com2LineBuffer = "";
        state.com2SpeechPending = [];
        clearTimeout(state.com2SpeechTimer);
        state.com2SpeechTimer = null;
    }
    updateDeviceUI();
    checkDeviceTimers();
}

export function toggleLpt1Capture() {
    state.deviceCapture.lpt1.enabled = !state.deviceCapture.lpt1.enabled;
    if (state.deviceCapture.lpt1.enabled) {
        trace("DEVICE", "LPT1 capture started");
    } else {
        trace("DEVICE", "LPT1 capture stopped (" + state.deviceCapture.lpt1.bytes + " bytes)");
    }
    updateDeviceUI();
    checkDeviceTimers();
}

/** Start/stop UI refresh timer depending on whether any device is active */
function checkDeviceTimers() {
    var anyActive = state.deviceCapture.con.enabled ||
                    state.deviceCapture.com1.enabled ||
                    state.deviceCapture.com2.enabled ||
                    state.deviceCapture.lpt1.enabled;
    if (anyActive) {
        startDeviceUIRefresh();
    } else {
        stopDeviceUIRefresh();
    }
}

/* ─── Download handlers ─── */

export function downloadConCapture() {
    var data = state.deviceCapture.con.buffer;
    if (!data) { announce("No CON data captured."); return; }
    triggerDownload(
        new Uint8Array(new TextEncoder().encode(data)),
        "dos-con-output.txt", "text/plain"
    );
    announce("CON output downloaded. " + state.deviceCapture.con.bytes + " bytes.");
}

export function downloadCom1Capture() {
    var cap = state.deviceCapture.com1;
    if (!cap.buffer && cap.rawBytes.length === 0) {
        announce("No COM1 data captured."); return;
    }

    /* Offer raw binary if raw toggle is on, otherwise text */
    if (devCom1RawToggle && devCom1RawToggle.checked && cap.rawBytes.length > 0) {
        triggerDownload(
            new Uint8Array(cap.rawBytes),
            "dos-com1-raw.bin", "application/octet-stream"
        );
        announce("COM1 raw binary downloaded. " + cap.rawBytes.length + " bytes.");
    } else {
        triggerDownload(
            new Uint8Array(new TextEncoder().encode(cap.buffer)),
            "dos-com1-output.txt", "text/plain"
        );
        announce("COM1 text output downloaded. " + cap.bytes + " bytes.");
    }
}

export function downloadCom2Capture() {
    var data = state.deviceCapture.com2.buffer;
    if (!data) { announce("No COM2 data captured."); return; }
    triggerDownload(
        new Uint8Array(new TextEncoder().encode(data)),
        "dos-com2-transcript.txt", "text/plain"
    );
    announce("COM2 transcript downloaded. " + state.deviceCapture.com2.bytes + " bytes.");
}

export function downloadLpt1Capture() {
    var data = state.deviceCapture.lpt1.buffer;
    if (!data) { announce("No LPT1 data captured."); return; }
    triggerDownload(
        new Uint8Array(new TextEncoder().encode(data)),
        "dos-lpt1-output.txt", "text/plain"
    );
    announce("LPT1 output downloaded. " + state.deviceCapture.lpt1.bytes + " bytes.");
}

export function downloadAllCaptures() {
    var sections = [];

    if (state.deviceCapture.con.buffer) {
        sections.push("═══ CON (Console/Screen) ═══\n" + state.deviceCapture.con.buffer);
    }
    if (state.deviceCapture.com1.buffer) {
        sections.push("═══ COM1 / AUX (Serial Port 1) ═══\n" + state.deviceCapture.com1.buffer);
    }
    if (state.deviceCapture.com2.buffer) {
        sections.push("═══ COM2 (Serial Port 2 — Transcript) ═══\n" + state.deviceCapture.com2.buffer);
    }
    if (state.deviceCapture.lpt1.buffer) {
        sections.push("═══ LPT1 / PRN (Printer) ═══\n" + state.deviceCapture.lpt1.buffer);
    }

    if (sections.length === 0) {
        announce("No device data captured.");
        return;
    }

    var header = "DOS Device Monitor Capture\n" +
                 "Generated: " + new Date().toISOString() + "\n" +
                 "═══════════════════════════════════════════\n\n";

    var text = header + sections.join("\n\n");
    triggerDownload(
        new Uint8Array(new TextEncoder().encode(text)),
        "dos-device-capture.txt", "text/plain"
    );
    announce("All device captures downloaded.");
}

/* ─── Clear handlers ─── */

export function clearConCapture() {
    state.deviceCapture.con.buffer = "";
    state.deviceCapture.con.bytes = 0;
    state.deviceConPrevLines = [];
    updateDeviceUI();
}

export function clearCom1Capture() {
    state.deviceCapture.com1.buffer = "";
    state.deviceCapture.com1.bytes = 0;
    state.deviceCapture.com1.rawBytes = [];
    com1AnsiState = 0;
    updateDeviceUI();
}

export function clearCom2Capture() {
    state.deviceCapture.com2.buffer = "";
    state.deviceCapture.com2.bytes = 0;
    state.com2LineBuffer = "";
    state.com2SpeechPending = [];
    clearTimeout(state.com2SpeechTimer);
    state.com2SpeechTimer = null;
    state.transcriptLines = [];
    state.transcriptLineBuffer = "";

    if (devCom2ReplaceScreenToggle && devCom2ReplaceScreenToggle.checked) {
        renderCom2ToScreen();
    }
    updateDeviceUI();
}

export function clearLpt1Capture() {
    state.deviceCapture.lpt1.buffer = "";
    state.deviceCapture.lpt1.bytes = 0;
    resetLpt1AnsiState();
    updateDeviceUI();
}

export function clearAllCaptures() {
    clearConCapture();
    clearCom1Capture();
    clearCom2Capture();
    clearLpt1Capture();
    announce("All device captures cleared.");
}
