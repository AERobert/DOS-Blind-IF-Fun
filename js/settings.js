"use strict";

/* ═══════════════════════════════════════════
 * localStorage: persist speech settings
 * ═══════════════════════════════════════════ */

function saveSettings() {
    try {
        const s = {
            voiceURI: voiceSelect.value,
            rate: rateSlider.value,
            pitch: pitchSlider.value,
            autoSpeak: autoSpeakToggle.checked,
            speakAfterCmd: speakAfterCmdToggle.checked,
            skipDecor: skipDecorToggle.checked,
            typingFeedback: typingFeedbackSelect.value,
            promptChar: promptCharInput.value,
            promptDepth: promptDepthSelect.value,
            diskType: diskTypeSelect.value,
            autorun: autorunInput.value,
            singleKey: singleKeyToggle.checked
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch(e) { /* storage unavailable, ignore */ }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.rate) { rateSlider.value = s.rate; rateValue.textContent = parseFloat(s.rate).toFixed(1); }
        if (s.pitch) { pitchSlider.value = s.pitch; pitchValue.textContent = parseFloat(s.pitch).toFixed(1); }
        if (s.autoSpeak !== undefined) autoSpeakToggle.checked = s.autoSpeak;
        if (s.speakAfterCmd !== undefined) speakAfterCmdToggle.checked = s.speakAfterCmd;
        if (s.skipDecor !== undefined) skipDecorToggle.checked = s.skipDecor;
        if (s.typingFeedback) typingFeedbackSelect.value = s.typingFeedback;
        if (s.promptChar !== undefined) promptCharInput.value = s.promptChar;
        if (s.promptDepth) promptDepthSelect.value = s.promptDepth;
        if (s.diskType) diskTypeSelect.value = s.diskType;
        if (s.autorun !== undefined) autorunInput.value = s.autorun;
        if (s.singleKey !== undefined) singleKeyToggle.checked = s.singleKey;
        /* Voice is restored after voices load — store URI for later */
        if (s.voiceURI) voiceSelect.dataset.savedVoice = s.voiceURI;
    } catch(e) {}
}

/* Auto-save whenever settings change */
[rateSlider, pitchSlider].forEach(el => el.addEventListener("change", saveSettings));
[autoSpeakToggle, speakAfterCmdToggle, skipDecorToggle, singleKeyToggle].forEach(el => el.addEventListener("change", saveSettings));
voiceSelect.addEventListener("change", saveSettings);
typingFeedbackSelect.addEventListener("change", saveSettings);
promptCharInput.addEventListener("change", saveSettings);
promptDepthSelect.addEventListener("change", saveSettings);
diskTypeSelect.addEventListener("change", saveSettings);
autorunInput.addEventListener("change", saveSettings);

/* ═══════════════════════════════════════════
 * Collapsible Section Persistence
 * ═══════════════════════════════════════════ */

/** Save open/closed state of all collapsible panels to localStorage */
function saveCollapseStates() {
    document.querySelectorAll("details.cpanel[id]").forEach(d => {
        try { localStorage.setItem(COLLAPSE_PREFIX + d.id, d.open ? "1" : "0"); } catch(e) {}
    });
}

/** Restore collapse states from localStorage */
function restoreCollapseStates() {
    document.querySelectorAll("details.cpanel[id]").forEach(d => {
        try {
            const val = localStorage.getItem(COLLAPSE_PREFIX + d.id);
            if (val !== null) d.open = (val === "1");
        } catch(e) {}
    });
}

/* Listen for toggle events on all collapsible panels */
document.querySelectorAll("details.cpanel[id]").forEach(d => {
    d.addEventListener("toggle", saveCollapseStates);
});
restoreCollapseStates();
