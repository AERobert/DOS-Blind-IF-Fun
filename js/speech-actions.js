import { state } from './state.js';
import { ROWS } from './constants.js';
import { speak } from './speech.js';
import { rowToString, filterForSpeech, getLastResponseFromScreen } from './screen.js';

/* ═══════════════════════════════════════════
 * Speech Actions
 * ═══════════════════════════════════════════ */

export function speakScreen() {
    const lines = [];
    for (let r = 0; r < ROWS; r++) lines.push(rowToString(r).trim());
    const f = filterForSpeech(lines);
    speak(f.length ? f.join(". ") : "Screen is blank.");
}

export function speakLast() {
    const lines = getLastResponseFromScreen();
    if (lines.length > 0) {
        speak(lines.join(". "));
    } else if (state.lastResponseLines.length > 0) {
        /* Fallback to accumulated response */
        speak(state.lastResponseLines.join(". "));
    } else {
        speak("No response detected.");
    }
}

export function speakNew() {
    const f = filterForSpeech(state.pendingChanges);
    speak(f.length ? f.join(". ") : "No new changes.");
}
