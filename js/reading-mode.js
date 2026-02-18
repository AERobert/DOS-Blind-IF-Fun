import { state, commandInput, modeIndicator } from './state.js';
import { ROWS, COLS } from './constants.js';
import { speak } from './speech.js';
import { rowToString, stripBorderBoth } from './screen.js';

/* ═══════════════════════════════════════════
 * VI-like Reading Mode
 * ═══════════════════════════════════════════ */

/** Switch between insert and read modes */
export function setMode(mode) {
    state.keyMode = mode;
    if (mode === "insert") {
        commandInput.focus();
        clearReadingCursor();
        speak("Insert mode", true);
    } else {
        /* Blur the input so keystrokes don't leak into the command box */
        commandInput.blur();
        /* Start at first non-blank line */
        const firstNB = findFirstNonBlankLine();
        if (firstNB >= 0) state.readRow = firstNB;
        state.readCol = 0;
        updateReadingCursor();
        speakCurrentLine();
    }
    /* Update the mode indicator LAST — after focus changes and speech
       calls — so no side-effects can interfere with the visual state. */
    modeIndicator.textContent = mode.toUpperCase();
    modeIndicator.className = mode;
    modeIndicator.setAttribute("aria-label", "Current mode: " + mode.toUpperCase() + ". Click to toggle.");
}

export function findFirstNonBlankLine() {
    for (let r = 0; r < ROWS; r++) if (rowToString(r).trim()) return r;
    return 0;
}

export function findLastNonBlankLine() {
    for (let r = ROWS - 1; r >= 0; r--) if (rowToString(r).trim()) return r;
    return 0;
}

export function clearReadingCursor() {
    document.querySelectorAll(".screen-line.reading-cursor").forEach(el => el.classList.remove("reading-cursor"));
}

export function updateReadingCursor() {
    clearReadingCursor();
    const el = document.getElementById("screen-line-" + state.readRow);
    if (el) { el.classList.add("reading-cursor"); el.focus(); }
}

export function speakCurrentLine() {
    const text = stripBorderBoth(rowToString(state.readRow));
    speak(text || "blank line");
}

export function speakCharAtCursor() {
    const line = rowToString(state.readRow);
    const ch = (state.readCol < line.length) ? line[state.readCol] : "end of line";
    speak(ch === " " ? "space" : ch);
}

export function getCurrentWord() {
    const line = rowToString(state.readRow);
    let start = state.readCol, end = state.readCol;
    while (start > 0 && line[start - 1] !== " ") start--;
    while (end < line.length && line[end] !== " ") end++;
    const word = line.slice(start, end).trim();
    return { word: word || "space", start, end };
}

/** Handle keydown events in READ mode */
export function handleReadKey(e) {
    const key = e.key;
    switch (key) {
        case "i": case "Escape":
            e.preventDefault(); setMode("insert"); break;
        case "j": /* Down one line */
            e.preventDefault();
            if (state.readRow < ROWS - 1) state.readRow++;
            state.readCol = 0; updateReadingCursor(); speakCurrentLine(); break;
        case "k": /* Up one line */
            e.preventDefault();
            if (state.readRow > 0) state.readRow--;
            state.readCol = 0; updateReadingCursor(); speakCurrentLine(); break;
        case "l": /* Right one char */
            e.preventDefault();
            if (state.readCol < COLS - 1) state.readCol++;
            speakCharAtCursor(); break;
        case "h": /* Left one char */
            e.preventDefault();
            if (state.readCol > 0) state.readCol--;
            speakCharAtCursor(); break;
        case "w": { /* Next word */
            e.preventDefault();
            const line = rowToString(state.readRow);
            while (state.readCol < COLS && line[state.readCol] !== " ") state.readCol++;
            while (state.readCol < COLS && line[state.readCol] === " ") state.readCol++;
            if (state.readCol >= COLS) state.readCol = COLS - 1;
            speak(getCurrentWord().word); break;
        }
        case "b": { /* Previous word */
            e.preventDefault();
            const line = rowToString(state.readRow);
            while (state.readCol > 0 && line[state.readCol - 1] === " ") state.readCol--;
            while (state.readCol > 0 && line[state.readCol - 1] !== " ") state.readCol--;
            speak(getCurrentWord().word); break;
        }
        case "g": /* First line */
            e.preventDefault();
            state.readRow = findFirstNonBlankLine(); state.readCol = 0;
            updateReadingCursor(); speakCurrentLine(); break;
        case "G": /* Last non-blank line */
            e.preventDefault();
            state.readRow = findLastNonBlankLine(); state.readCol = 0;
            updateReadingCursor(); speakCurrentLine(); break;
        case "F7": /* Page up */
            e.preventDefault();
            state.readRow = Math.max(0, state.readRow - 10); state.readCol = 0;
            updateReadingCursor(); speakCurrentLine(); break;
        case "F8": /* Page down */
            e.preventDefault();
            state.readRow = Math.min(ROWS - 1, state.readRow + 10); state.readCol = 0;
            updateReadingCursor(); speakCurrentLine(); break;
        case "^": { /* Beginning of line (first non-space char) */
            e.preventDefault();
            const line = rowToString(state.readRow);
            state.readCol = 0;
            while (state.readCol < COLS && line[state.readCol] === " ") state.readCol++;
            speakCharAtCursor(); break;
        }
        case "$": { /* End of line (last non-space char) */
            e.preventDefault();
            const line = rowToString(state.readRow);
            state.readCol = COLS - 1;
            while (state.readCol > 0 && line[state.readCol] === " ") state.readCol--;
            speakCharAtCursor(); break;
        }
        case "0": /* Column 0 (absolute start) */
            e.preventDefault();
            state.readCol = 0; speakCharAtCursor(); break;
        case "c": /* Left-click at reading cursor position */
            e.preventDefault();
            simulateMouseClick(state.readRow, state.readCol, false);
            break;
        case "C": /* Right-click at reading cursor position */
            e.preventDefault();
            simulateMouseClick(state.readRow, state.readCol, true);
            break;
        default:
            /* F-keys still pass through to global handler; block everything else */
            if (!key.startsWith("F")) e.preventDefault();
            break;
    }
}

/* ═══════════════════════════════════════════
 * Mouse Click Simulation
 * ═══════════════════════════════════════════ */

/**
 * Send a series of mouse-delta packets via the v86 bus.
 * Chunks large movements into max +-200 per packet with 20ms gaps.
 */
export async function sendMouseDeltas(totalX, totalY) {
    if (!state.emulator || !state.emulator.bus) return;
    const CHUNK = 200;

    while (totalX !== 0 || totalY !== 0) {
        /* Clamp each axis to +-CHUNK */
        const dx = Math.max(-CHUNK, Math.min(CHUNK, totalX));
        const dy = Math.max(-CHUNK, Math.min(CHUNK, totalY));

        state.emulator.bus.send("mouse-delta", [dx, dy]);

        totalX -= dx;
        totalY -= dy;

        /* Brief pause between packets so the PS2 controller processes them */
        await new Promise(r => setTimeout(r, 20));
    }
}

/**
 * Simulate a mouse click at the screen position (row, col).
 */
export async function simulateMouseClick(row, col, rightClick) {
    if (!state.emulator || !state.emulator.bus) {
        speak("No emulator running.");
        return;
    }

    const container = document.getElementById("v86-screen-container");
    const canvas = container ? container.querySelector("canvas") : null;

    let canvasW = 640, canvasH = 200; /* EGA default fallback */
    if (canvas && canvas.width > 0) {
        canvasW = canvas.width;
        canvasH = canvas.height;
    }

    const cellW = canvasW / COLS;
    const cellH = canvasH / ROWS;

    /* Target: center of the character cell */
    const targetX = Math.round(col * cellW + cellW / 2);
    const targetY = Math.round(row * cellH + cellH / 2);

    const lineText = rowToString(row).trim();
    const charAtPos = (col < lineText.length) ? lineText[col] : "blank";
    speak((rightClick ? "Right-clicking " : "Clicking ") +
          "row " + (row + 1) + " column " + (col + 1) +
          ": " + charAtPos);

    /* Step 1: Reset cursor to top-left corner (0, 0). */
    await sendMouseDeltas(-1200, 1200);

    /* Small pause for the mouse driver to clamp to boundary */
    await new Promise(r => setTimeout(r, 50));

    /* Step 2: Move to target position. */
    await sendMouseDeltas(targetX, -targetY);

    /* Small pause before clicking */
    await new Promise(r => setTimeout(r, 50));

    /* Step 3: Click — press then release after a short hold */
    if (rightClick) {
        state.emulator.bus.send("mouse-click", [false, false, true]);
    } else {
        state.emulator.bus.send("mouse-click", [true, false, false]);
    }

    /* Hold click for 100ms then release */
    await new Promise(r => setTimeout(r, 100));
    state.emulator.bus.send("mouse-click", [false, false, false]);
}
