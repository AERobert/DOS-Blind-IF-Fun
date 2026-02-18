import { state, transcriptAutoFlushToggle } from './state.js';
import { CHAR_DELAY_MS, SCANCODES, MODIFIER_RELEASE } from './constants.js';
import { trace } from './trace.js';
import { addToHistory } from './history.js';
import { scheduleAutoFlush } from './transcript.js';
import { applyAliases, getMultiCommandDelay } from './aliases.js';

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

    /* Apply command aliases — may return a string or array (macro expansion) */
    var result = applyAliases(text);

    if (Array.isArray(result)) {
        sendMultiCommands(result, text);
        return;
    }

    text = result;
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

/**
 * Send multiple commands sequentially (from macro expansion).
 * Each command is typed and sent with Enter, with a configurable delay
 * between commands to let the game process each one.
 * @param {string[]} commands - Array of command strings to send
 * @param {string} originalText - The original macro trigger text (for history)
 */
async function sendMultiCommands(commands, originalText) {
    var delay = getMultiCommandDelay();

    /* Log the macro trigger in history */
    if (originalText.trim()) {
        state.commandHistory.push(originalText);
        state.historyIndex = -1;
        addToHistory(originalText + "  [macro \u2192 " + commands.join("; ") + "]", true);
        state.responseLog.push({ type: "command", lines: [originalText] });
    }

    for (var i = 0; i < commands.length; i++) {
        var cmd = commands[i];
        trace("CMD", "sendMultiCommands [" + (i + 1) + "/" + commands.length + "]: " + JSON.stringify(cmd));
        state.awaitingResponse = true;
        state.pendingChanges = [];

        await typeToDOS(cmd, true);

        /* Wait between commands so the game can process each one */
        if (i < commands.length - 1) {
            await new Promise(function(resolve) { setTimeout(resolve, delay); });
        }
    }

    /* Auto-flush after all macro commands are sent */
    if (transcriptAutoFlushToggle.checked && !state.autoFlushPending) {
        scheduleAutoFlush();
    }
}

export function sendEnter() {
    if (!state.emulator) return;
    state.awaitingResponse = true; state.pendingChanges = [];
    state.emulator.keyboard_send_scancodes(SCANCODES.ENTER);
}
