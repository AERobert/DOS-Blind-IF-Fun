import { state, screenEl, promptCharInput, skipDecorToggle, promptDepthSelect, speakAfterCmdToggle, autoSpeakToggle, transcriptReplaceScreenToggle, transcriptMuteScreenToggle } from './state.js';
import { ROWS, COLS, CP437, BOX_RE, BORDER_STRIP_RE, BORDER_STRIP_END_RE } from './constants.js';
import { speak } from './speech.js';
import { trace, traceTextPattern } from './trace.js';
import { addToHistory, updateHistNav } from './history.js';
import { updateTranscriptUI } from './transcript.js';
import { textCapRowToString } from './textcap.js';

/* ═══════════════════════════════════════════
 * Screen Buffer
 * ═══════════════════════════════════════════ */

export function initBuffer() {
    state.screenBuffer = []; state.prevLines = [];
    for (let r = 0; r < ROWS; r++) {
        state.screenBuffer[r] = new Uint8Array(COLS).fill(0x20);
        state.prevLines[r] = " ".repeat(COLS);
    }
    state.pendingChanges = []; state.lastResponseLines = [];
}

export function initScreenDOM() {
    screenEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
        const d = document.createElement("div");
        d.className = "screen-line";
        d.setAttribute("role", "text");
        d.setAttribute("aria-label", "Line " + (r+1) + ": blank");
        d.setAttribute("tabindex", "-1");
        d.id = "screen-line-" + r;
        d.textContent = " ".repeat(COLS);
        screenEl.appendChild(d);
    }
}

/* ═══════════════════════════════════════════
 * Screen Display & Filtering
 * ═══════════════════════════════════════════ */

export function rowToString(r) {
    /*
     * Screen content source priority:
     * 1. Transcript capture — only when "Replace screen" is checked
     * 2. TextCap screen buffer (ANSI-positioned INT 10h text via serial)
     * 3. VGA screen buffer (screen-put-char events in text mode)
     */
    if (state.transcriptCapActive && transcriptReplaceScreenToggle.checked
        && state.transcriptLines.length > 0) {
        const startIdx = Math.max(0, state.transcriptLines.length - ROWS);
        const displayLines = state.transcriptLines.slice(startIdx);
        if (state.transcriptLineBuffer.length > 0) {
            displayLines.push(state.transcriptLineBuffer);
        }
        if (r < displayLines.length) {
            return displayLines[r].padEnd(COLS).slice(0, COLS);
        }
        return " ".repeat(COLS);
    }

    if (state.textCapActive && state.textCapBuffer && state.textCapBuffer[r]) {
        return textCapRowToString(r);
    }

    let s = "";
    for (let c = 0; c < COLS; c++) {
        const code = state.screenBuffer[r][c];
        s += (code < CP437.length) ? CP437[code] : " ";
    }
    return s;
}

/** Test if a line is purely box-drawing decoration */
export function isDecor(text) { return BOX_RE.test(text.trim()); }

/** ♦► prompt characters (CP437 4=♦, 16=►) — default, can be changed in settings */
export function getPromptStr() { return promptCharInput.value || "\u2666\u25ba"; }

/**
 * Strip box-drawing border characters from the start of a line.
 * This handles games like Mindwheel that wrap text in ║...║ borders.
 */
export function stripBorder(text) {
    return text.replace(BORDER_STRIP_RE, "");
}

/** Strip box-drawing border characters from both sides of a line */
export function stripBorderBoth(text) {
    return text.replace(BORDER_STRIP_RE, "").replace(BORDER_STRIP_END_RE, "");
}

/** Test if a line contains the game prompt (after stripping borders) */
export function isPromptLine(text) { return stripBorder(text).startsWith(getPromptStr()); }

/** Filter lines for speech: remove blanks, optionally borders, and strip border chars */
export function filterForSpeech(lines) {
    const skip = skipDecorToggle.checked;
    return lines.map(t => stripBorderBoth(t)).filter(t => {
        if (!t) return false;
        if (skip && isDecor(t)) return false;
        return true;
    });
}

/** Main screen refresh (every 200ms) */
export function refreshScreen() {
    /*
     * When transcript capture is active, behavior depends on checkboxes:
     * - "Replace screen" checked: skip DOM updates (poll handles them)
     * - "Mute screen speech" checked: skip speech (poll handles it)
     * Both off: refreshScreen runs normally alongside transcript polling.
     */

    /* If transcript is replacing the screen, don't overwrite its DOM content */
    if (state.transcriptCapActive && transcriptReplaceScreenToggle.checked) return;

    let anyChanged = false;
    for (let r = 0; r < ROWS; r++) {
        const cur = rowToString(r);
        if (cur === state.prevLines[r]) continue;
        anyChanged = true;
        const el = document.getElementById("screen-line-" + r);
        if (el) {
            el.textContent = cur;
            const t = cur.trim();
            el.setAttribute("aria-label", "Line "+(r+1)+": "+(t||"blank"));
        }
        const trimmed = cur.trim();
        if (trimmed) state.pendingChanges.push(trimmed);
        state.prevLines[r] = cur;
    }
    if (anyChanged) {
        clearTimeout(state.changeSettleTimer);
        state.changeSettleTimer = setTimeout(onScreenSettled, 700);
    }
}

/**
 * Fired 700ms after the last screen change.
 * Deduplicates, logs, and optionally speaks.
 */
export function onScreenSettled() {
    if (!state.pendingChanges.length) return;

    trace("SCREEN", "Settled with " + state.pendingChanges.length + " changes, mute=" + transcriptMuteScreenToggle.checked + " autoFlush=" + state.autoFlushPending);

    /* Feed screen text into pattern detector (for text-mode games) */
    if (state.traceEnabled && state.pendingChanges.length > 0) {
        traceTextPattern(state.pendingChanges.join(" "));
    }

    /* Mute screen speech: either explicitly checked, or during auto-flush. */
    if (transcriptMuteScreenToggle.checked || state.autoFlushPending) {
        trace("SCREEN", "Muted — discarding " + state.pendingChanges.length + " changes");
        state.pendingChanges = [];
        state.awaitingResponse = false;
        return;
    }

    /* De-dup consecutive identical lines */
    const unique = [];
    for (const line of state.pendingChanges) {
        if (!unique.length || unique[unique.length - 1] !== line) unique.push(line);
    }

    const speakable = filterForSpeech(unique);
    state.lastResponseLines = speakable.slice();

    /* Add to responseLog and visible history */
    if (speakable.length > 0) {
        const entry = { type: "response", lines: speakable.slice() };
        state.responseLog.push(entry);
        state.responseNavIndex = state.responseLog.length - 1;
        updateHistNav();

        for (const line of speakable) addToHistory(line, false);
    }

    /* Transcript recording: capture all unique non-blank lines */
    if (state.isRecording && unique.length > 0) {
        state.transcriptBuffer += unique.join("\n") + "\n\n";
        updateTranscriptUI();
    }

    /* Auto-speak: use smart prompt detection for command responses */
    if (state.isReady && speakable.length > 0) {
        if (speakAfterCmdToggle.checked && state.awaitingResponse) {
            /* Use ♦► prompt detection for cleaner response extraction */
            const smartLines = getLastResponseFromScreen();
            speak(smartLines.length ? smartLines.join(". ") : speakable.join(". "));
        } else if (autoSpeakToggle.checked) {
            speak(speakable.join(". "));
        }
    }

    state.pendingChanges = [];
    state.awaitingResponse = false;
}

/**
 * Smart "last response" extraction using ♦► prompt detection.
 * Scans the current screen for prompt lines.
 */
export function getLastResponseFromScreen() {
    const lines = [];
    for (let r = 0; r < ROWS; r++) lines.push(rowToString(r));

    /* Find all lines that contain the game prompt (after stripping borders) */
    const promptIndices = [];
    for (let i = 0; i < lines.length; i++) {
        if (isPromptLine(lines[i])) promptIndices.push(i);
    }

    if (promptIndices.length === 0) {
        /* No prompts found — return all non-blank lines */
        return filterForSpeech(lines.map(l => l.trim()));
    }

    const depthMode = promptDepthSelect.value;
    let startRow, endRow;

    if (depthMode === "below") {
        startRow = promptIndices[promptIndices.length - 1] + 1;
        endRow = ROWS;
    } else {
        if (promptIndices.length >= 2) {
            startRow = promptIndices[promptIndices.length - 2] + 1;
            endRow = promptIndices[promptIndices.length - 1];
        } else {
            startRow = 0;
            endRow = promptIndices[0];
        }
    }

    const result = [];
    for (let r = startRow; r < endRow; r++) {
        result.push(lines[r].trim());
    }
    return filterForSpeech(result);
}
