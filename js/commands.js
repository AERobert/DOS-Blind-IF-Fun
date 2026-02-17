import { state, transcriptAutoFlushToggle } from './state.js';
import { CHAR_DELAY_MS, SCANCODES, MODIFIER_RELEASE } from './constants.js';
import { trace } from './trace.js';
import { addToHistory } from './history.js';
import { scheduleAutoFlush } from './transcript.js';

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
export function typeToDOS(text, sendEnterAfter) {
    return new Promise(resolve => {
        if (!state.emulator) { resolve(); return; }
        if (!text.length && !sendEnterAfter) { resolve(); return; }

        /* Release any stuck modifier keys before sending characters */
        state.emulator.keyboard_send_scancodes(MODIFIER_RELEASE);

        for (let i = 0; i < text.length; i++) {
            setTimeout(() => state.emulator.keyboard_send_text(text[i]), i * CHAR_DELAY_MS);
        }

        const afterChars = text.length * CHAR_DELAY_MS + 50;
        if (sendEnterAfter) {
            setTimeout(() => {
                state.emulator.keyboard_send_scancodes(SCANCODES.ENTER);
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
export function sendCommand(text) {
    if (!state.emulator) return;
    trace("CMD", "sendCommand: " + JSON.stringify(text));
    state.awaitingResponse = true;
    state.pendingChanges = [];

    typeToDOS(text, true);

    if (text.trim()) {
        state.commandHistory.push(text);
        state.historyIndex = -1;
        addToHistory(text, true);
        state.responseLog.push({ type: "command", lines: [text] });

        /* Auto-flush: after each command, schedule a flush cycle */
        if (transcriptAutoFlushToggle.checked && !state.autoFlushPending) {
            scheduleAutoFlush();
        }
    }
}

export function sendEnter() {
    if (!state.emulator) return;
    state.awaitingResponse = true; state.pendingChanges = [];
    state.emulator.keyboard_send_scancodes(SCANCODES.ENTER);
}
