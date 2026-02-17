import { state, historyLog, histPrevBtn, histNextBtn, histPosition } from './state.js';
import { speak } from './speech.js';
import { isPromptLine } from './screen.js';

/* ═══════════════════════════════════════════
 * History Log & Navigation
 * ═══════════════════════════════════════════ */

export function addToHistory(text, isCmd) {
    if (historyLog.children.length === 1 &&
        historyLog.firstChild.textContent === "History appears here after the game starts.") {
        historyLog.innerHTML = "";
    }
    const d = document.createElement("div");
    d.className = "history-entry" + (isCmd ? " command" : "");
    d.setAttribute("tabindex", "-1");

    /* Mark prompt lines distinctly */
    if (isPromptLine(text)) {
        d.className += " prompt-marker";
    }
    d.textContent = isCmd ? "> " + text : text;
    historyLog.appendChild(d);
    historyLog.scrollTop = historyLog.scrollHeight;
}

/** Navigate to a specific response in the responseLog */
export function navToResponse(index) {
    if (index < 0 || index >= state.responseLog.length) return;
    state.responseNavIndex = index;
    updateHistNav();

    const entry = state.responseLog[index];
    const text = entry.lines.join(". ");
    speak((entry.type === "command" ? "Command: " : "") + text);
}

export function navPrevResponse() {
    if (state.responseNavIndex > 0) navToResponse(state.responseNavIndex - 1);
    else speak("At the beginning of history.");
}

export function navNextResponse() {
    if (state.responseNavIndex < state.responseLog.length - 1) navToResponse(state.responseNavIndex + 1);
    else speak("At the end of history.");
}

export function updateHistNav() {
    histPosition.textContent = state.responseLog.length > 0
        ? "Response " + (state.responseNavIndex + 1) + " of " + state.responseLog.length
        : "";
    histPrevBtn.disabled = state.responseNavIndex <= 0;
    histNextBtn.disabled = state.responseNavIndex >= state.responseLog.length - 1;
}
