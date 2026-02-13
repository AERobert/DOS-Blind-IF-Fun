"use strict";

/* ═══════════════════════════════════════════
 * VI-like Reading Mode
 * ═══════════════════════════════════════════ */

/** Switch between insert and read modes */
function setMode(mode) {
    keyMode = mode;
    modeIndicator.textContent = mode.toUpperCase();
    modeIndicator.className = mode;
    if (mode === "insert") {
        commandInput.focus();
        clearReadingCursor();
        speak("Insert mode", true);
    } else {
        /* Blur the input so keystrokes don't leak into the command box */
        commandInput.blur();
        /* Start at first non-blank line */
        const firstNB = findFirstNonBlankLine();
        if (firstNB >= 0) readRow = firstNB;
        readCol = 0;
        updateReadingCursor();
        speakCurrentLine();
    }
}

function findFirstNonBlankLine() {
    for (let r = 0; r < ROWS; r++) if (rowToString(r).trim()) return r;
    return 0;
}

function findLastNonBlankLine() {
    for (let r = ROWS - 1; r >= 0; r--) if (rowToString(r).trim()) return r;
    return 0;
}

function clearReadingCursor() {
    document.querySelectorAll(".screen-line.reading-cursor").forEach(el => el.classList.remove("reading-cursor"));
}

function updateReadingCursor() {
    clearReadingCursor();
    const el = document.getElementById("screen-line-" + readRow);
    if (el) { el.classList.add("reading-cursor"); el.focus(); }
}

function speakCurrentLine() {
    const text = stripBorderBoth(rowToString(readRow));
    speak(text || "blank line");
}

function speakCharAtCursor() {
    const line = rowToString(readRow);
    const ch = (readCol < line.length) ? line[readCol] : "end of line";
    speak(ch === " " ? "space" : ch);
}

function getCurrentWord() {
    const line = rowToString(readRow);
    let start = readCol, end = readCol;
    while (start > 0 && line[start - 1] !== " ") start--;
    while (end < line.length && line[end] !== " ") end++;
    const word = line.slice(start, end).trim();
    return { word: word || "space", start, end };
}

/** Handle keydown events in READ mode */
function handleReadKey(e) {
    const key = e.key;
    switch (key) {
        case "i": case "Escape":
            e.preventDefault(); setMode("insert"); break;
        case "j": /* Down one line */
            e.preventDefault();
            if (readRow < ROWS - 1) readRow++;
            readCol = 0; updateReadingCursor(); speakCurrentLine(); break;
        case "k": /* Up one line */
            e.preventDefault();
            if (readRow > 0) readRow--;
            readCol = 0; updateReadingCursor(); speakCurrentLine(); break;
        case "l": /* Right one char */
            e.preventDefault();
            if (readCol < COLS - 1) readCol++;
            speakCharAtCursor(); break;
        case "h": /* Left one char */
            e.preventDefault();
            if (readCol > 0) readCol--;
            speakCharAtCursor(); break;
        case "w": { /* Next word */
            e.preventDefault();
            const line = rowToString(readRow);
            while (readCol < COLS && line[readCol] !== " ") readCol++;
            while (readCol < COLS && line[readCol] === " ") readCol++;
            if (readCol >= COLS) readCol = COLS - 1;
            speak(getCurrentWord().word); break;
        }
        case "b": { /* Previous word */
            e.preventDefault();
            const line = rowToString(readRow);
            while (readCol > 0 && line[readCol - 1] === " ") readCol--;
            while (readCol > 0 && line[readCol - 1] !== " ") readCol--;
            speak(getCurrentWord().word); break;
        }
        case "g": /* First line */
            e.preventDefault();
            readRow = findFirstNonBlankLine(); readCol = 0;
            updateReadingCursor(); speakCurrentLine(); break;
        case "G": /* Last non-blank line */
            e.preventDefault();
            readRow = findLastNonBlankLine(); readCol = 0;
            updateReadingCursor(); speakCurrentLine(); break;
        case "F7": /* Page up */
            e.preventDefault();
            readRow = Math.max(0, readRow - 10); readCol = 0;
            updateReadingCursor(); speakCurrentLine(); break;
        case "F8": /* Page down */
            e.preventDefault();
            readRow = Math.min(ROWS - 1, readRow + 10); readCol = 0;
            updateReadingCursor(); speakCurrentLine(); break;
        case "^": { /* Beginning of line (first non-space char) */
            e.preventDefault();
            const line = rowToString(readRow);
            readCol = 0;
            while (readCol < COLS && line[readCol] === " ") readCol++;
            speakCharAtCursor(); break;
        }
        case "$": { /* End of line (last non-space char) */
            e.preventDefault();
            const line = rowToString(readRow);
            readCol = COLS - 1;
            while (readCol > 0 && line[readCol] === " ") readCol--;
            speakCharAtCursor(); break;
        }
        case "0": /* Column 0 (absolute start) */
            e.preventDefault();
            readCol = 0; speakCharAtCursor(); break;
        case "c": /* Left-click at reading cursor position */
            e.preventDefault();
            simulateMouseClick(readRow, readCol, false);
            break;
        case "C": /* Right-click at reading cursor position */
            e.preventDefault();
            simulateMouseClick(readRow, readCol, true);
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
async function sendMouseDeltas(totalX, totalY) {
    if (!emulator || !emulator.bus) return;
    const CHUNK = 200;

    while (totalX !== 0 || totalY !== 0) {
        /* Clamp each axis to +-CHUNK */
        const dx = Math.max(-CHUNK, Math.min(CHUNK, totalX));
        const dy = Math.max(-CHUNK, Math.min(CHUNK, totalY));

        emulator.bus.send("mouse-delta", [dx, dy]);

        totalX -= dx;
        totalY -= dy;

        /* Brief pause between packets so the PS2 controller processes them */
        await new Promise(r => setTimeout(r, 20));
    }
}

/**
 * Simulate a mouse click at the screen position (row, col).
 */
async function simulateMouseClick(row, col, rightClick) {
    if (!emulator || !emulator.bus) {
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
        emulator.bus.send("mouse-click", [false, false, true]);
    } else {
        emulator.bus.send("mouse-click", [true, false, false]);
    }

    /* Hold click for 100ms then release */
    await new Promise(r => setTimeout(r, 100));
    emulator.bus.send("mouse-click", [false, false, false]);
}
