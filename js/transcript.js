/* ═══════════════════════════════════════════
 * Transcript Capture — reads game's transcript file from disk
 * ═══════════════════════════════════════════
 *
 * Instead of intercepting serial-port framing (which is fragile),
 * we poll the actual FAT filesystem on the game disk. When the game
 * writes to its transcript file, DOS allocates clusters and updates
 * the FAT chain in real-time. The directory entry size stays 0 until
 * the file is closed, but the cluster data is there.
 */

import { state, promptCharInput, transcriptWatchFilename, transcriptWatchBtn, transcriptFlushBtn, transcriptDisconnectBtn, transcriptCapState, transcriptCapInfo, transcriptPollSpeedSelect, transcriptAutoSpeakToggle, transcriptReplaceScreenToggle, transcriptMuteScreenToggle, transcriptAutoFlushToggle, transcriptAutoFlushOptions, transcriptFlushDelay, transcriptFlushD1, transcriptFlushD2, transcriptFlushD3, recordBtn, downloadTranscriptBtn, clearTranscriptBtn, transcriptStats, transcriptPreview, transcriptFilename } from './state.js';
import { ROWS, COLS, TRANSCRIPT_TIMEOUT_MS } from './constants.js';
import { speak } from './speech.js';
import { announce, triggerDownload } from './ui-helpers.js';
import { trace } from './trace.js';
import { traceFATGeometry } from './trace.js';
import { getDiskBytes, parseFATGeometry, parseFATDir, readFATFile, readFATEntry, isEOF } from './fat.js';
import { typeToDOS } from './commands.js';
import { addToHistory, updateHistNav } from './history.js';
import { stripBorder } from './screen.js';

/**
 * Read ALL cluster data for a file by following its FAT chain.
 * Unlike readFATFile(), this ignores the directory entry's size field
 * (which stays 0 until fclose). Instead it follows the cluster chain
 * and reads every allocated cluster.
 */
export function readFATFileByChain(img, geo, firstCluster) {
    if (firstCluster < 2) return null;

    const chunks = [];
    let cluster = firstCluster;
    let safety = 10000; /* prevent infinite loops on corrupt FAT */

    while (cluster >= 2 && !isEOF(geo, cluster) && --safety > 0) {
        const offset = geo.dataStart + (cluster - 2) * geo.bytesPerCluster;
        chunks.push(img.slice(offset, offset + geo.bytesPerCluster));
        cluster = readFATEntry(img, geo, cluster);
    }

    if (chunks.length === 0) return null;

    /* Concatenate all cluster data */
    const totalBytes = chunks.reduce((s, c) => s + c.length, 0);
    const data = new Uint8Array(totalBytes);
    let pos = 0;
    for (const chunk of chunks) {
        data.set(chunk, pos);
        pos += chunk.length;
    }

    /* Trim trailing NUL bytes (unused space in last cluster) */
    let end = data.length;
    while (end > 0 && data[end - 1] === 0) end--;

    return end > 0 ? data.slice(0, end) : null;
}

/**
 * Poll the game disk for the transcript file.
 * Called on a timer at the interval selected in the poll speed dropdown.
 */
export function pollTranscriptFile() {
    if (!state.emulator || !state.isReady) return;

    const text = readTranscriptFromDisk();
    if (text === null || text.length === 0) {
        trace("POLL", "No transcript data on disk");
        return;
    }

    trace("POLL", "Disk read: " + text.length + " bytes (lastLength=" + state.transcriptPollLastLength + ")");

    /* Check if there's new content since our last read. */
    if (text.length < state.transcriptPollLastLength) {
        console.log("Transcript file appears re-created (shorter). Resetting.");
        trace("POLL", "File re-created (shorter: " + text.length + " < " + state.transcriptPollLastLength + "), resetting");
        state.transcriptPollLastLength = 0;
    }
    if (text.length <= state.transcriptPollLastLength) return;

    const newText = text.slice(state.transcriptPollLastLength);
    state.transcriptPollLastLength = text.length;
    trace("POLL", "New data: " + newText.length + " bytes, preview: " + JSON.stringify(newText.substring(0, 80)));

    /* First data arrival: activate transcript mode */
    if (!state.transcriptCapActive) {
        state.transcriptCapActive = true;
        console.log("Transcript file detected — transcript capture active");
        trace("TRANSCRIPT", "First data arrival — transcript capture activated, " + text.length + " bytes on disk");

        /* If muting screen speech, kill any pending screen-change speech */
        if (transcriptMuteScreenToggle.checked) {
            clearTimeout(state.changeSettleTimer);
            state.pendingChanges = [];
            state.awaitingResponse = false;
            window.speechSynthesis.cancel();
        }

        announce("Transcript connected. " + text.length + " bytes on disk.");
    }

    /* Reset the watchdog — fresh data just arrived */
    resetTranscriptWatchdog();

    /* Parse new text into lines */
    const prevLineCount = state.transcriptLines.length;
    let dirty = false;

    for (let i = 0; i < newText.length; i++) {
        const ch = newText[i];
        if (ch === "\r") continue;

        if (ch === "\n") {
            state.transcriptLines.push(state.transcriptLineBuffer);
            state.transcriptLineBuffer = "";
            dirty = true;
            continue;
        }

        state.transcriptLineBuffer += ch;

        /* Word-wrap at column width */
        if (state.transcriptLineBuffer.length >= COLS) {
            state.transcriptLines.push(state.transcriptLineBuffer);
            state.transcriptLineBuffer = "";
            dirty = true;
        }
    }

    if (!dirty) return;

    updateTranscriptConnectionUI();

    /* Optionally render transcript lines to the screen DOM */
    if (transcriptReplaceScreenToggle.checked) {
        const startIdx = Math.max(0, state.transcriptLines.length - ROWS);
        const displayLines = state.transcriptLines.slice(startIdx);
        if (state.transcriptLineBuffer.length > 0) {
            displayLines.push(state.transcriptLineBuffer);
        }

        for (let r = 0; r < ROWS; r++) {
            const lineText = (r < displayLines.length) ? displayLines[r] : "";
            const el = document.getElementById("screen-line-" + r);
            if (el) {
                el.textContent = lineText || "\u00A0";
                el.setAttribute("aria-label", "Line " + (r + 1) + ": " + (lineText || "blank"));
            }
            state.prevLines[r] = lineText.padEnd(COLS).slice(0, COLS);
        }
    }

    /* Optionally speak the new lines */
    const newLines = state.transcriptLines.slice(prevLineCount);

    if (transcriptAutoSpeakToggle.checked) {
        const cleanText = newLines
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .join(". ");

        if (cleanText) {
            console.log("Transcript speech:", cleanText.substring(0, 100) + "...");
            speak(cleanText);
        }
    }

    /* Always add to response log and history for F7/F8 navigation */
    if (newLines.length > 0) {
        const filtered = newLines.filter(l => l.trim());
        if (filtered.length > 0) {
            const entry = { type: "response", lines: filtered };
            state.responseLog.push(entry);
            state.responseNavIndex = state.responseLog.length - 1;
            updateHistNav();
            for (const line of filtered) addToHistory(line, false);
        }
    }

    /* Recording: capture transcript lines */
    if (state.isRecording && newLines.length > 0) {
        state.transcriptBuffer += newLines.join("\n") + "\n\n";
        updateTranscriptUI();
    }
}

/**
 * Start polling the disk for the transcript file.
 */
export function startTranscriptPoll() {
    if (state.transcriptPollTimer) return; /* already polling */
    state.transcriptPollLastLength = 0;
    state.transcriptLines = [];
    state.transcriptLineBuffer = "";
    const ms = parseInt(transcriptPollSpeedSelect.value, 10) || 2000;
    state.transcriptPollTimer = setInterval(pollTranscriptFile, ms);
    updateTranscriptConnectionUI();
    const fname = transcriptWatchFilename.value || "SCRIPT.TXT";
    trace("TRANSCRIPT", "Started polling for " + fname + " every " + ms + "ms");
    announce("Watching for " + fname +
             " on disk. Type SCRIPT in the game to start.");
}

/**
 * Stop polling and deactivate transcript capture.
 */
export function stopTranscriptPoll() {
    trace("TRANSCRIPT", "Stopping poll (had " + state.transcriptLines.length + " lines)");
    if (state.transcriptPollTimer) {
        clearInterval(state.transcriptPollTimer);
        state.transcriptPollTimer = null;
    }
    state.transcriptCapActive = false;
    clearTimeout(state.transcriptWatchdog);
    state.transcriptWatchdog = null;
    /* Reset prevLines so refreshScreen picks up current screen state */
    state.prevLines = new Array(ROWS).fill("");
    updateTranscriptConnectionUI();
    announce("Transcript watching stopped. Screen capture resumed.");
}

/**
 * Restart the poll timer at the new speed (called on dropdown change).
 */
export function restartTranscriptPoll() {
    if (!state.transcriptPollTimer) return; /* not currently polling */
    clearInterval(state.transcriptPollTimer);
    state.transcriptPollLastLength = 0;
    const ms = parseInt(transcriptPollSpeedSelect.value, 10) || 2000;
    state.transcriptPollTimer = setInterval(pollTranscriptFile, ms);
}

/**
 * Force a transcript flush by sending "script off" to close the file,
 * then re-opening the transcript.
 */
export async function flushTranscriptFile() {
    if (!state.emulator || !state.isReady) return;
    const fname = (transcriptWatchFilename.value || "SCRIPT.TXT").trim();

    announce("Flushing transcript...");

    /* Close the transcript file */
    await typeToDOS("script off", true);

    await new Promise(r => setTimeout(r, 1500));
    pollTranscriptFile(); /* immediate extra poll */

    /* Re-open the transcript */
    await new Promise(r => setTimeout(r, 500));
    await typeToDOS("script", true);
    await new Promise(r => setTimeout(r, 1000));
    await typeToDOS(fname, true);

    announce("Transcript flushed and re-opened.");
}

/**
 * Read the transcript file from disk and return its text content.
 * Returns null if file not found or empty.
 */
export function readTranscriptFromDisk() {
    if (!state.emulator || !state.isReady) {
        trace("FAT", "readTranscriptFromDisk: skipped (emulator=" + !!state.emulator + " isReady=" + state.isReady + ")");
        return null;
    }

    const img = getDiskBytes();
    if (!img) { trace("FAT", "getDiskBytes returned null"); return null; }

    const geo = parseFATGeometry(img);
    if (!geo) { trace("FAT", "parseFATGeometry returned null"); return null; }
    /* Use deduplicating geometry logger — suppresses repeated identical lines */
    traceFATGeometry(geo);

    const files = parseFATDir(img, geo);
    const target = (transcriptWatchFilename.value || "SCRIPT.TXT").toUpperCase().trim();

    const file = files.find(f => f.fullName.toUpperCase() === target);
    if (!file) {
        trace("FAT", target + " not found. Files: " + files.map(f => f.fullName).join(", "));
        return null;
    }
    trace("FAT", file.fullName + " cluster=" + file.firstCluster + " dirSize=" + file.size);

    /* Try cluster chain first (works even when dir size = 0) */
    if (file.firstCluster >= 2) {
        const data = readFATFileByChain(img, geo, file.firstCluster);
        if (data && data.length > 0) {
            trace("FAT", "Read via chain: " + data.length + " bytes");
            return new TextDecoder("ascii").decode(data);
        }
        trace("FAT", "Chain read returned empty/null");
    }

    /* Fall back to directory size (works after fclose) */
    if (file.size > 0) {
        const data = readFATFile(img, geo, file);
        if (data && data.length > 0) {
            trace("FAT", "Read via dirSize: " + data.length + " bytes");
            return new TextDecoder("ascii").decode(data);
        }
        trace("FAT", "DirSize read returned empty/null");
    }

    trace("FAT", "No data for " + target);
    return null;
}

/**
 * Test Read button: read the transcript file from disk and announce its size.
 */
export function testReadTranscript() {
    const text = readTranscriptFromDisk();
    if (text === null) {
        const fname = (transcriptWatchFilename.value || "SCRIPT.TXT").trim();
        speak("File " + fname + " not found on disk, or has no data.");
        return;
    }

    const lines = text.split("\n").filter(l => l.trim().length > 0);
    const bytes = text.length;
    const first = lines.length > 0 ? lines[0].trim() : "(empty)";
    const last = lines.length > 0 ? lines[lines.length - 1].trim() : "(empty)";

    const msg = bytes + " bytes, " + lines.length + " lines. " +
                "First: " + first + ". Last: " + last + ".";
    console.log("Test Read:", msg);
    speak(msg);
}

/**
 * Speak Last button: read the transcript file from disk and speak
 * the last response.
 */
export function speakLastTranscript() {
    const text = readTranscriptFromDisk();
    if (text === null) {
        speak("No transcript file found on disk.");
        return;
    }

    const lines = text.split("\n").filter(l => l.trim().length > 0);
    if (lines.length === 0) {
        speak("Transcript file is empty.");
        return;
    }

    /* Find the last prompt line */
    const promptStr = promptCharInput.value || ">";
    let lastPromptIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (stripBorder(lines[i].trim()).startsWith(promptStr)) {
            lastPromptIdx = i;
            break;
        }
    }

    /* Extract response */
    let response;
    if (lastPromptIdx >= 0 && lastPromptIdx < lines.length - 1) {
        response = lines.slice(lastPromptIdx + 1);
    } else if (lastPromptIdx === lines.length - 1) {
        const start = Math.max(0, lastPromptIdx - 5);
        response = lines.slice(start, lastPromptIdx);
    } else {
        response = lines.slice(-5);
    }

    const cleanText = response.map(l => l.trim()).join(". ");
    if (cleanText) {
        speak(cleanText);
    } else {
        speak("No response found in transcript.");
    }
}

/**
 * Auto-flush cycle: triggered after each command when auto-flush is on.
 */
export async function autoFlushCycle() {
    if (!state.emulator || !state.isReady || state.autoFlushPending) {
        trace("FLUSH", "autoFlushCycle skipped: emulator=" + !!state.emulator + " isReady=" + state.isReady + " pending=" + state.autoFlushPending);
        return;
    }
    state.autoFlushPending = true;
    trace("FLUSH", "Phase 1: sending 'script off'");

    /* Kill any pending/in-progress screen speech */
    clearTimeout(state.changeSettleTimer);
    state.pendingChanges = [];
    state.awaitingResponse = false;
    window.speechSynthesis.cancel();

    const fname = (transcriptWatchFilename.value || "SCRIPT.TXT").trim();
    const d1 = parseInt(transcriptFlushD1.value, 10) || 600;
    const d2 = parseInt(transcriptFlushD2.value, 10) || 600;
    const d3 = parseInt(transcriptFlushD3.value, 10) || 400;
    trace("FLUSH", "Delays: d1=" + d1 + " d2=" + d2 + " d3=" + d3 + " file=" + fname);

    /* Phase 1: Flush to disk */
    await typeToDOS("script off", true);
    await new Promise(r => setTimeout(r, d1));

    /* Phase 2: Read + Parse + Speak */
    trace("FLUSH", "Phase 2: reading transcript from disk");
    const text = readTranscriptFromDisk();
    trace("FLUSH", "Disk read: " + (text ? text.length + " bytes" : "null"));

    if (text) {
        /* Update shared transcript state for read mode navigation */
        state.transcriptLines = [];
        state.transcriptLineBuffer = "";
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === "\r") continue;
            if (ch === "\n") {
                state.transcriptLines.push(state.transcriptLineBuffer);
                state.transcriptLineBuffer = "";
                continue;
            }
            state.transcriptLineBuffer += ch;
            if (state.transcriptLineBuffer.length >= COLS) {
                state.transcriptLines.push(state.transcriptLineBuffer);
                state.transcriptLineBuffer = "";
            }
        }
        state.transcriptPollLastLength = text.length;
        state.transcriptCapActive = true;

        /* Render last ROWS lines to DOM for read mode if checked */
        if (transcriptReplaceScreenToggle.checked) {
            const startIdx = Math.max(0, state.transcriptLines.length - ROWS);
            const displayLines = state.transcriptLines.slice(startIdx);
            if (state.transcriptLineBuffer.length > 0) displayLines.push(state.transcriptLineBuffer);
            for (let r = 0; r < ROWS; r++) {
                const lineText = (r < displayLines.length) ? displayLines[r] : "";
                const el = document.getElementById("screen-line-" + r);
                if (el) {
                    el.textContent = lineText || "\u00A0";
                    el.setAttribute("aria-label", "Line " + (r + 1) + ": " + (lineText || "blank"));
                }
                state.prevLines[r] = lineText.padEnd(COLS).slice(0, COLS);
            }
        }

        /* Extract the last response */
        const nonEmpty = text.split("\n").filter(l => l.trim().length > 0);
        const promptStr = promptCharInput.value || ">";

        const promptPositions = [];
        for (let i = 0; i < nonEmpty.length; i++) {
            if (stripBorder(nonEmpty[i].trim()).startsWith(promptStr)) {
                promptPositions.push(i);
            }
        }

        let responseLines = [];
        if (promptPositions.length >= 2) {
            const prevPrompt = promptPositions[promptPositions.length - 2];
            const lastPrompt = promptPositions[promptPositions.length - 1];
            responseLines = nonEmpty.slice(prevPrompt + 1, lastPrompt);
        } else if (promptPositions.length === 1) {
            const candidates = nonEmpty.slice(promptPositions[0] + 1);
            if (candidates.length > 0 &&
                candidates[candidates.length - 1].trim().toLowerCase() === "script off") {
                candidates.pop();
            }
            responseLines = candidates;
        } else {
            /* No prompts found — use all non-empty lines */
            responseLines = nonEmpty.slice();
        }

        /* Filter out "script off" / "transcript off" echoes and confirmations */
        responseLines = responseLines.filter(l => {
            const t = l.trim().toLowerCase();
            return t !== "transcript off." &&
                   t !== "transcript off" &&
                   t !== "script off" &&
                   t !== "script off.";
        });

        trace("FLUSH", "Prompts found: " + promptPositions.length + " at positions [" + promptPositions.join(",") + "]");
        trace("FLUSH", "Response lines: " + responseLines.length);

        const cleanText = responseLines.map(l => l.trim()).filter(l => l.length > 0).join(". ");

        if (cleanText) {
            window.speechSynthesis.cancel();
            console.log("Auto-flush response:", cleanText.substring(0, 120));
            trace("FLUSH", "Speaking: " + cleanText.substring(0, 120));
            speak(cleanText);

            const filtered = responseLines.filter(l => l.trim());
            if (filtered.length > 0) {
                const entry = { type: "response", lines: filtered.map(l => l.trim()) };
                state.responseLog.push(entry);
                state.responseNavIndex = state.responseLog.length - 1;
                updateHistNav();
                for (const line of filtered) addToHistory(line.trim(), false);
            }

            if (state.isRecording) {
                state.transcriptBuffer += responseLines.join("\n") + "\n\n";
                updateTranscriptUI();
            }
        }
    }

    /* Phase 3: Re-open transcript (runs while speech is playing) */
    trace("FLUSH", "Phase 3: re-opening transcript with 'script' + '" + fname + "'");
    await typeToDOS("script", true);
    await new Promise(r => setTimeout(r, d2));

    /* Only clear pending screen changes, do NOT cancel speech */
    clearTimeout(state.changeSettleTimer);
    state.pendingChanges = [];

    await typeToDOS(fname, true);
    await new Promise(r => setTimeout(r, d3));

    clearTimeout(state.changeSettleTimer);
    state.pendingChanges = [];

    state.autoFlushPending = false;
    trace("FLUSH", "Auto-flush cycle complete");
}

/**
 * Schedule an auto-flush after the configured delay.
 */
export function scheduleAutoFlush() {
    clearTimeout(state.autoFlushTimer);
    const delay = parseInt(transcriptFlushDelay.value, 10) || 500;
    state.autoFlushTimer = setTimeout(autoFlushCycle, delay);
}

/**
 * Update the transcript capture connection status UI.
 */
export function updateTranscriptConnectionUI() {
    if (!transcriptCapState) return;
    const isPolling = !!state.transcriptPollTimer;

    if (state.transcriptCapActive) {
        transcriptCapState.textContent = "Connected";
        transcriptCapState.style.color = "var(--success, #2d8a4e)";
        transcriptCapInfo.textContent = state.transcriptLines.length + " lines captured";
    } else if (isPolling) {
        transcriptCapState.textContent = "Watching";
        transcriptCapState.style.color = "var(--warning, #b58900)";
        transcriptCapInfo.textContent = "Polling disk for " +
            (transcriptWatchFilename.value || "SCRIPT.TXT") + "...";
    } else {
        transcriptCapState.textContent = "Idle";
        transcriptCapState.style.color = "var(--dim, #888)";
        transcriptCapInfo.textContent = "Type SCRIPT in the game, then click Watch.";
    }

    /* Show/hide buttons based on state */
    transcriptWatchBtn.style.display = isPolling ? "none" : "";
    transcriptFlushBtn.style.display = isPolling ? "" : "none";
    transcriptDisconnectBtn.style.display = isPolling ? "" : "none";
}

/**
 * Reset the transcript watchdog timer.
 */
export function resetTranscriptWatchdog() {
    clearTimeout(state.transcriptWatchdog);
    state.transcriptWatchdog = setTimeout(function() {
        if (state.transcriptCapActive) {
            console.warn("Transcript watchdog fired — no data for " +
                         (TRANSCRIPT_TIMEOUT_MS / 1000) + "s, falling back");
            trace("TRANSCRIPT", "Watchdog fired — no data for " + (TRANSCRIPT_TIMEOUT_MS / 1000) + "s, deactivating");
            state.transcriptCapActive = false;
            state.transcriptLines = [];
            state.transcriptLineBuffer = "";
            state.prevLines = new Array(ROWS).fill("");
            updateTranscriptConnectionUI();
            announce("Transcript timed out. Still watching — will reconnect if new data appears.");
        }
    }, TRANSCRIPT_TIMEOUT_MS);
}

/* ═══════════════════════════════════════════
 * Transcript Recording
 * ═══════════════════════════════════════════ */

export function toggleRecording() {
    state.isRecording = !state.isRecording;
    recordBtn.textContent = state.isRecording ? "Stop Recording" : "Start Recording";
    recordBtn.className = state.isRecording ? "btn-danger btn-sm" : "btn-success btn-sm";
    /* Show/hide REC badge on the section summary */
    const summary = document.querySelector("#section-transcript > summary");
    const badge = summary.querySelector(".recording-badge");
    if (state.isRecording) {
        if (!badge) {
            const b = document.createElement("span");
            b.className = "recording-badge";
            b.textContent = "REC";
            summary.appendChild(b);
        }
        speak("Recording started.");
    } else {
        if (badge) badge.remove();
        speak("Recording stopped.");
    }
}

export function updateTranscriptUI() {
    const combined = getCombinedTranscript();
    const hasData = combined.length > 0;
    downloadTranscriptBtn.style.display = hasData ? "" : "none";
    downloadTranscriptBtn.disabled = !hasData;
    clearTranscriptBtn.style.display = hasData ? "" : "none";
    clearTranscriptBtn.disabled = !hasData;
    transcriptStats.style.display = hasData ? "" : "none";
    transcriptPreview.style.display = hasData ? "" : "none";
    if (hasData) {
        const lines = combined.split("\n").length;
        const bytes = new Blob([combined]).size;
        transcriptStats.textContent = lines + " lines, " + (bytes / 1024).toFixed(1) + " KB";
        /* Show tail in preview */
        const tail = combined.length > 500 ? "..." + combined.slice(-500) : combined;
        transcriptPreview.textContent = tail;
        transcriptPreview.scrollTop = transcriptPreview.scrollHeight;
    }
}

export function getCombinedTranscript() {
    let result = state.transcriptBuffer;
    if (state.serialBuffer.length > 0) {
        result += "\n--- Printer Output (captured from serial redirect) ---\n";
        result += state.serialBuffer;
    }
    /* Include clean transcript from game's SCRIPT command if available */
    if (state.transcriptLines.length > 0) {
        result += "\n--- Game Transcript (captured from file writes via TextCap) ---\n";
        result += state.transcriptLines.join("\n");
        if (state.transcriptLineBuffer.length > 0) {
            result += "\n" + state.transcriptLineBuffer;
        }
    }
    return result;
}

export function downloadTranscript() {
    const text = getCombinedTranscript();
    if (!text) return;
    triggerDownload(
        new Uint8Array(new TextEncoder().encode(text)),
        transcriptFilename.value || "transcript.txt",
        "text/plain"
    );
}

export function clearTranscript() {
    state.transcriptBuffer = "";
    state.serialBuffer = "";
    state.transcriptLines = [];
    state.transcriptLineBuffer = "";
    state.transcriptPollLastLength = 0;
    updateTranscriptUI();
    speak("Transcript cleared.");
}
