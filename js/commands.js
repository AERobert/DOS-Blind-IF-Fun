"use strict";

/* ═══════════════════════════════════════════
 * Commands
 * ═══════════════════════════════════════════ */

/**
 * Low-level: drip-feed text to DOS one character at a time.
 * Returns a Promise that resolves after all chars + optional Enter are sent.
 *
 * Before sending any characters, we release all modifier keys (Shift, Ctrl,
 * Alt) to clear any stuck state.
 */
function typeToDOS(text, sendEnterAfter) {
    return new Promise(resolve => {
        if (!emulator) { resolve(); return; }
        if (!text.length && !sendEnterAfter) { resolve(); return; }

        /* Release any stuck modifier keys before sending characters */
        emulator.keyboard_send_scancodes(MODIFIER_RELEASE);

        for (let i = 0; i < text.length; i++) {
            setTimeout(() => emulator.keyboard_send_text(text[i]), i * CHAR_DELAY_MS);
        }

        const afterChars = text.length * CHAR_DELAY_MS + 50;
        if (sendEnterAfter) {
            setTimeout(() => {
                emulator.keyboard_send_scancodes(SCANCODES.ENTER);
                setTimeout(resolve, 100);
            }, afterChars);
        } else {
            setTimeout(resolve, afterChars);
        }
    });
}

/**
 * Send a command to DOS with proper character pacing.
 * Logs to history and responseLog.
 */
function sendCommand(text) {
    if (!emulator) return;
    awaitingResponse = true;
    pendingChanges = [];

    typeToDOS(text, true);

    if (text.trim()) {
        commandHistory.push(text);
        historyIndex = -1;
        addToHistory(text, true);
        responseLog.push({ type: "command", lines: [text] });

        /* Auto-flush: after each command, schedule a flush cycle */
        if (transcriptAutoFlushToggle.checked && !autoFlushPending) {
            scheduleAutoFlush();
        }

        /* Workspace live sync: push disk to server shortly after command */
        schedulePostCommandSync();
    }
}

function sendEnter() {
    if (!emulator) return;
    awaitingResponse = true; pendingChanges = [];
    emulator.keyboard_send_scancodes(SCANCODES.ENTER);
}
