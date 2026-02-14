"use strict";

/* ═══════════════════════════════════════════
 * localStorage: persist settings
 *
 * Global settings (same across all games):
 *   voice, speed (rate), pitch, selectedGame
 *   Stored under GLOBAL_STORAGE_KEY
 *
 * Per-game settings (start with preset defaults, user overrides persist):
 *   autoSpeak, speakAfterCmd, skipDecor, typingFeedback,
 *   promptChar, promptDepth, diskType, autorun, singleKey
 *   Stored under GAME_STORAGE_PREFIX + "<game-filename>"
 * ═══════════════════════════════════════════ */

/* ── Migration from old single-key format ── */
function migrateSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);

        /* Migrate global settings */
        const g = {};
        if (s.voiceURI) g.voiceURI = s.voiceURI;
        if (s.rate) g.rate = s.rate;
        if (s.pitch) g.pitch = s.pitch;
        if (s.selectedGame) g.selectedGame = s.selectedGame;
        localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(g));

        /* Migrate game-specific settings under the selected game key */
        if (s.selectedGame) {
            const gm = {};
            if (s.autoSpeak !== undefined) gm.autoSpeak = s.autoSpeak;
            if (s.speakAfterCmd !== undefined) gm.speakAfterCmd = s.speakAfterCmd;
            if (s.skipDecor !== undefined) gm.skipDecor = s.skipDecor;
            if (s.typingFeedback) gm.typingFeedback = s.typingFeedback;
            if (s.promptChar !== undefined) gm.promptChar = s.promptChar;
            if (s.promptDepth) gm.promptDepth = s.promptDepth;
            if (s.diskType) gm.diskType = s.diskType;
            if (s.autorun !== undefined) gm.autorun = s.autorun;
            if (s.singleKey !== undefined) gm.singleKey = s.singleKey;
            localStorage.setItem(GAME_STORAGE_PREFIX + s.selectedGame, JSON.stringify(gm));
        }

        /* Remove legacy key */
        localStorage.removeItem(STORAGE_KEY);
    } catch(e) {}
}

/* ── Global settings (voice / rate / pitch) ── */

function saveGlobalSettings() {
    try {
        const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
        const s = raw ? JSON.parse(raw) : {};
        s.voiceURI = voiceSelect.value;
        s.rate = rateSlider.value;
        s.pitch = pitchSlider.value;
        localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(s));
    } catch(e) {}
}

function loadGlobalSettings() {
    try {
        const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.rate) { rateSlider.value = s.rate; rateValue.textContent = parseFloat(s.rate).toFixed(1); }
        if (s.pitch) { pitchSlider.value = s.pitch; pitchValue.textContent = parseFloat(s.pitch).toFixed(1); }
        /* Voice is restored after voices load — store URI for later */
        if (s.voiceURI) voiceSelect.dataset.savedVoice = s.voiceURI;
    } catch(e) {}
}

/* ── Per-game settings ── */

function saveGameSettings() {
    const gameName = gameSelect.value;
    if (!gameName) return;
    try {
        const s = {
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
        localStorage.setItem(GAME_STORAGE_PREFIX + gameName, JSON.stringify(s));
    } catch(e) {}
}

/**
 * Load game-specific settings for the currently selected game.
 * Merges preset defaults → saved overrides → applies to DOM.
 */
function loadGameSettings() {
    const gameName = gameSelect.value;
    if (!gameName) return;

    /* Start with base defaults */
    const defaults = Object.assign({}, GAME_SETTING_DEFAULTS);

    /* Overlay preset values for known games */
    const preset = KNOWN_GAMES[gameName];
    if (preset) {
        if (preset.prompt !== undefined) defaults.promptChar = preset.prompt;
        if (preset.depth) defaults.promptDepth = preset.depth;
        if (preset.disk) defaults.diskType = preset.disk;
        if (preset.autorun) defaults.autorun = preset.autorun;
        if (preset.singleKey !== undefined) defaults.singleKey = preset.singleKey;
    }

    /* Overlay any saved per-game customizations */
    let s = defaults;
    try {
        const raw = localStorage.getItem(GAME_STORAGE_PREFIX + gameName);
        if (raw) {
            const saved = JSON.parse(raw);
            s = Object.assign(defaults, saved);
        }
    } catch(e) {}

    /* Apply to DOM */
    autoSpeakToggle.checked = !!s.autoSpeak;
    speakAfterCmdToggle.checked = s.speakAfterCmd !== false;
    skipDecorToggle.checked = s.skipDecor !== false;
    typingFeedbackSelect.value = s.typingFeedback || "characters";
    promptCharInput.value = s.promptChar !== undefined ? s.promptChar : ">";
    promptDepthSelect.value = s.promptDepth || "last";
    diskTypeSelect.value = s.diskType || "floppy";
    autorunInput.value = s.autorun !== undefined ? s.autorun : "";
    singleKeyToggle.checked = !!s.singleKey;
}

/* ── Combined save/load (backward-compatible wrapper) ── */

function saveSettings() {
    saveGlobalSettings();
    saveGameSettings();
}

function loadSettings() {
    migrateSettings();
    loadGlobalSettings();
    /* Game-specific settings are loaded by applyGamePreset()
       after the game selector is populated in games.js */
}

/* ── Auto-save on change ── */

/* Global settings: voice, rate, pitch */
[rateSlider, pitchSlider].forEach(el => el.addEventListener("change", saveGlobalSettings));
voiceSelect.addEventListener("change", saveGlobalSettings);

/* Per-game settings */
[autoSpeakToggle, speakAfterCmdToggle, skipDecorToggle, singleKeyToggle].forEach(el =>
    el.addEventListener("change", saveGameSettings)
);
typingFeedbackSelect.addEventListener("change", saveGameSettings);
promptCharInput.addEventListener("change", saveGameSettings);
promptDepthSelect.addEventListener("change", saveGameSettings);
diskTypeSelect.addEventListener("change", saveGameSettings);
autorunInput.addEventListener("change", saveGameSettings);

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
