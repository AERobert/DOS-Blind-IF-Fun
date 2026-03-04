import { state, gameSelect, autorunInput, diskTypeSelect, customImgInput, loadCustomImgBtn } from './state.js';
import { KNOWN_GAMES, getGamesByPlatform } from './game-configs.js';
import { loadGameSettings } from './settings.js';
import { setStatus } from './ui-helpers.js';
import { GLOBAL_STORAGE_KEY } from './constants.js';

/* ═══════════════════════════════════════════
 * Game Image Discovery & Presets
 * ═══════════════════════════════════════════ */

/** Directories to search for game disk images (in order of preference). */
const DISK_SEARCH_PATHS = ["gameDisks/", ""];

/**
 * Populate the game selector by probing for each known disk image.
 * Filters by the currently selected platform.
 * Searches for images in platform-specific paths so disks can live in
 * dedicated subdirectories (gameDisks/apple2/, gameDisks/c64/, etc.)
 * or the project root.
 * Uses HEAD requests so only a few bytes are exchanged per file.
 */
export async function populateGameSelect() {
    gameSelect.innerHTML = "";
    const found = [];
    const platform = platformSelect ? platformSelect.value : "dos";
    const searchPaths = PLATFORM_DISK_PATHS[platform] || DISK_SEARCH_PATHS;

    /* Get games for the current platform */
    const platformGames = getGamesByPlatform(platform);

    /* Probe each known image file in each search path */
    for (const info of platformGames) {
        const filename = info.filename;
        let foundFile = false;
        for (const prefix of searchPaths) {
            try {
                const url = prefix + filename;
                const resp = await fetch(url, { method: "HEAD" });
                if (resp.ok) {
                    found.push({ filename, label: info.label, path: url });
                    foundFile = true;
                    break; /* found — stop searching other paths */
                }
            } catch(e) { /* file not present at this path, try next */ }
        }
        /* For non-DOS platforms, also list configured games even if the disk
         * image isn't present yet (user may load it later via custom upload) */
        if (!foundFile && platform !== "dos") {
            found.push({
                filename,
                label: info.label,
                path: filename,
                missing: true,
            });
        }
    }

    if (found.length === 0) {
        const ext = platform === "dos" ? ".img" : (
            platform === "apple2" ? ".dsk" :
            platform === "c64" ? ".d64" :
            platform === "bbc" ? ".ssd" : ".img"
        );
        const o = document.createElement("option");
        o.value = "";
        o.textContent = "No " + ext + " files found \u2014 use 'Load Custom'";
        gameSelect.appendChild(o);
    } else {
        for (const g of found) {
            const o = document.createElement("option");
            o.value = g.filename;
            o.dataset.path = g.path;
            const suffix = g.missing ? " [disk image needed]" : "";
            o.textContent = g.label + " (" + g.filename + ")" + suffix;
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

/* ── Platform selector ──
 * When the platform dropdown changes, re-populate the game list
 * to show only games for the selected platform.
 */
const platformSelect = document.getElementById("platform-select");

const PLATFORM_DISK_PATHS = {
    dos:    ["gameDisks/", ""],
    apple2: ["gameDisks/apple2/", "gameDisks/", ""],
    c64:    ["gameDisks/c64/", "gameDisks/", ""],
    bbc:    ["gameDisks/bbc/", "gameDisks/", ""],
};

const PLATFORM_LABELS = {
    dos:    "DOS",
    apple2: "Apple II",
    c64:    "Commodore 64",
    bbc:    "BBC Micro",
};

const PLATFORM_DESCRIPTIONS = {
    apple2: "<strong>Apple II</strong> &mdash; 40x24 text screen. " +
        "Reads text from screen memory at $0400-$07FF (interleaved row layout). " +
        "Emulator: apple2js (bundled, 614KB). " +
        "Disk formats: .dsk, .do, .po, .woz, .nib. " +
        "Classic games: Zork, Hitchhiker's Guide, Planetfall, Enchanter.",
    c64: "<strong>Commodore 64</strong> &mdash; 40x25 text screen. " +
        "Reads PETSCII screen codes from $0400-$07E7. " +
        "Emulator: Viciious (bundled, 249KB, public domain). " +
        "Disk formats: .d64, .t64, .prg. " +
        "Classic games: Zork, Hitchhiker's Guide, The Lurking Horror.",
    bbc: "<strong>BBC Micro</strong> &mdash; Mode 7 teletext (40x25) or bitmap text modes. " +
        "Reads from $7C00 (Mode 7) or hooks OSWRCH ($FFEE) for bitmap modes. " +
        "Emulator: jsbeeb (bundled, 294KB). " +
        "Disk formats: .ssd, .dsd, .uef. " +
        "Classic games: Colossal Adventure, Acheton, Giant Killer, Quondam.",
};

function onPlatformChange() {
    const platform = platformSelect ? platformSelect.value : "dos";
    state.currentPlatform = platform;

    /* Show/hide DOS-specific UI elements */
    const dosOnlyEls = [
        document.getElementById("section-transcript-cap"),
        document.getElementById("section-device-monitor"),
    ];
    for (const el of dosOnlyEls) {
        if (el) el.style.display = (platform === "dos") ? "" : "none";
    }

    /* Show/hide platform info panel */
    const infoPanel = document.getElementById("platform-info");
    const infoText = document.getElementById("platform-info-text");
    if (infoPanel && infoText) {
        if (platform !== "dos" && PLATFORM_DESCRIPTIONS[platform]) {
            infoText.innerHTML = PLATFORM_DESCRIPTIONS[platform];
            infoPanel.style.display = "";
        } else {
            infoPanel.style.display = "none";
        }
    }

    /* Re-populate game list for the new platform */
    populateGameSelect();
}

if (platformSelect) {
    platformSelect.addEventListener("change", onPlatformChange);
}

/* Scan for images on page load */
populateGameSelect();
