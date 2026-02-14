"use strict";

/* ═══════════════════════════════════════════
 * Game Image Discovery & Presets
 * ═══════════════════════════════════════════ */

/**
 * Populate the game selector by probing for each known .img file.
 * Uses HEAD requests so only a few bytes are exchanged per file.
 * Also adds any previously-remembered custom image filename.
 */
async function populateGameSelect() {
    gameSelect.innerHTML = "";
    const found = [];

    /* Probe each known image file */
    for (const [filename, info] of Object.entries(KNOWN_GAMES)) {
        try {
            const resp = await fetch(filename, { method: "HEAD" });
            if (resp.ok) found.push({ filename, label: info.label });
        } catch(e) { /* file not present, skip */ }
    }

    if (found.length === 0) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = "No .img files found \u2014 use 'Load Custom .img'";
        gameSelect.appendChild(o);
    } else {
        for (const g of found) {
            const o = document.createElement("option");
            o.value = g.filename;
            o.textContent = g.label + " (" + g.filename + ")";
            gameSelect.appendChild(o);
        }
    }

    /* If settings had a saved game selection, restore it */
    try {
        const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            if (s.selectedGame && gameSelect.querySelector('option[value="' + s.selectedGame + '"]')) {
                gameSelect.value = s.selectedGame;
            }
        }
    } catch(e) {}

    /* Apply presets (and load per-game settings) for the initially selected game */
    applyGamePreset();
}

/**
 * Apply game preset and load per-game settings.
 * Loads saved per-game customizations, falling back to preset defaults
 * for any settings the user hasn't customized yet.
 */
function applyGamePreset() {
    const filename = gameSelect.value;
    const preset = KNOWN_GAMES[filename];

    /* Load per-game settings (merges preset defaults with saved overrides) */
    loadGameSettings();

    /* Warn about graphics-mode games that can't be screen-read */
    if (preset && preset.graphics) {
        setStatus("loading", preset.label + " uses graphics mode. Screen reader access will be limited after boot.");
    }

    /* Clear custom blob when switching to a known image */
    customFloppyBlob = null;
}

/** Handle loading a custom .img file from the file picker */
function handleCustomImgUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function() {
        customFloppyBlob = reader.result; /* ArrayBuffer */
        /* Add or update a "Custom" option in the game selector */
        let opt = gameSelect.querySelector('option[data-custom="1"]');
        if (!opt) {
            opt = document.createElement("option");
            opt.setAttribute("data-custom", "1");
            gameSelect.appendChild(opt);
        }
        opt.value = file.name;
        opt.textContent = "Custom: " + file.name;
        gameSelect.value = file.name;
        setStatus("loading", "Custom image loaded: " + file.name + " (" + (file.size / 1024).toFixed(0) + " KB)");
    };
    reader.readAsArrayBuffer(file);
}

/* Save selected game in global settings and apply preset */
gameSelect.addEventListener("change", function() {
    applyGamePreset();
    try {
        const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
        const s = raw ? JSON.parse(raw) : {};
        s.selectedGame = gameSelect.value;
        localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(s));
    } catch(e) {}
});

loadCustomImgBtn.addEventListener("click", () => customImgInput.click());
customImgInput.addEventListener("change", function() {
    if (this.files.length) handleCustomImgUpload(this.files[0]);
    this.value = "";
});

/* Scan for images on page load */
populateGameSelect();
