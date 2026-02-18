import { state, gameSelect, autorunInput, diskTypeSelect, customImgInput, loadCustomImgBtn } from './state.js';
import { KNOWN_GAMES } from './game-configs.js';
import { loadGameSettings } from './settings.js';
import { setStatus } from './ui-helpers.js';
import { GLOBAL_STORAGE_KEY } from './constants.js';

/* ═══════════════════════════════════════════
 * Game Image Discovery & Presets
 * ═══════════════════════════════════════════ */

/** Directories to search for game disk images (in order of preference). */
const DISK_SEARCH_PATHS = ["gameDisks/", ""];

/**
 * Populate the game selector by probing for each known .img file.
 * Searches for images in DISK_SEARCH_PATHS so disks can live either
 * in the gameDisks/ folder or the project root.
 * Uses HEAD requests so only a few bytes are exchanged per file.
 * Also adds any previously-remembered custom image filename.
 */
export async function populateGameSelect() {
    gameSelect.innerHTML = "";
    const found = [];

    /* Probe each known image file in each search path */
    for (const [filename, info] of Object.entries(KNOWN_GAMES)) {
        for (const prefix of DISK_SEARCH_PATHS) {
            try {
                const url = prefix + filename;
                const resp = await fetch(url, { method: "HEAD" });
                if (resp.ok) {
                    found.push({ filename, label: info.label, path: url });
                    break; /* found — stop searching other paths */
                }
            } catch(e) { /* file not present at this path, try next */ }
        }
    }

    if (found.length === 0) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = "No .img files found \u2014 use 'Load Custom .img'";
        gameSelect.appendChild(o);
    } else {
        for (const g of found) {
            const o = document.createElement("option");
            o.value = g.filename;
            o.dataset.path = g.path;
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
export function applyGamePreset() {
    const filename = gameSelect.value;
    const preset = KNOWN_GAMES[filename];

    /* Load per-game settings (merges preset defaults with saved overrides) */
    loadGameSettings();

    /* Warn about graphics-mode games that can't be screen-read */
    if (preset && preset.graphics) {
        setStatus("loading", preset.label + " uses graphics mode. Screen reader access will be limited after boot.");
    }

    /* Clear custom blob when switching to a known image */
    state.customFloppyBlob = null;
}

/**
 * Return the URL path to the currently selected disk image.
 * Resolves via the data-path attribute set during discovery,
 * falling back to the raw filename.
 */
export function getSelectedDiskPath() {
    const opt = gameSelect.selectedOptions[0];
    return (opt && opt.dataset.path) ? opt.dataset.path : gameSelect.value;
}

/** Handle loading a custom .img file from the file picker */
function handleCustomImgUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function() {
        state.customFloppyBlob = reader.result; /* ArrayBuffer */
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
