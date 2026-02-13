"use strict";

/* ═══════════════════════════════════════════
 * History Log & Navigation
 * ═══════════════════════════════════════════ */

function addToHistory(text, isCmd) {
    if (historyLog.children.length === 1 &&
        historyLog.firstChild.textContent.startsWith("History")) {
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
function navToResponse(index) {
    if (index < 0 || index >= responseLog.length) return;
    responseNavIndex = index;
    updateHistNav();

    const entry = responseLog[index];
    const text = entry.lines.join(". ");
    speak((entry.type === "command" ? "Command: " : "") + text);
}

function navPrevResponse() {
    if (responseNavIndex > 0) navToResponse(responseNavIndex - 1);
    else speak("At the beginning of history.");
}

function navNextResponse() {
    if (responseNavIndex < responseLog.length - 1) navToResponse(responseNavIndex + 1);
    else speak("At the end of history.");
}

function updateHistNav() {
    histPosition.textContent = responseLog.length > 0
        ? "Response " + (responseNavIndex + 1) + " of " + responseLog.length
        : "";
    histPrevBtn.disabled = responseNavIndex <= 0;
    histNextBtn.disabled = responseNavIndex >= responseLog.length - 1;
}
