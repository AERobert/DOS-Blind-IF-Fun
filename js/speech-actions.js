"use strict";

/* ═══════════════════════════════════════════
 * Speech Actions
 * ═══════════════════════════════════════════ */

function speakScreen() {
    const lines = [];
    for (let r = 0; r < ROWS; r++) lines.push(rowToString(r).trim());
    const f = filterForSpeech(lines);
    speak(f.length ? f.join(". ") : "Screen is blank.");
}

function speakLast() {
    const lines = getLastResponseFromScreen();
    if (lines.length > 0) {
        speak(lines.join(". "));
    } else if (lastResponseLines.length > 0) {
        /* Fallback to accumulated response */
        speak(lastResponseLines.join(". "));
    } else {
        speak("No response detected.");
    }
}

function speakNew() {
    const f = filterForSpeech(pendingChanges);
    speak(f.length ? f.join(". ") : "No new changes.");
}
