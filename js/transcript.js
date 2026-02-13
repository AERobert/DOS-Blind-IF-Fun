"use strict";

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

/**
 * Read ALL cluster data for a file by following its FAT chain.
 * Unlike readFATFile(), this ignores the directory entry's size field
 * (which stays 0 until fclose). Instead it follows the cluster chain
 * and reads every allocated cluster.
 */
function readFATFileByChain(img, geo, firstCluster) {
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
function pollTranscriptFile() {
    if (!emulator || !isReady) return;

    const text = readTranscriptFromDisk();
    if (text === null || text.length === 0) return;

    /* Check if there's new content since our last read. */
    if (text.length < transcriptPollLastLength) {
        console.log("Transcript file appears re-created (shorter). Resetting.");
        transcriptPollLastLength = 0;
    }
    if (text.length <= transcriptPollLastLength) return;

    const newText = text.slice(transcriptPollLastLength);
    transcriptPollLastLength = text.length;

    /* First data arrival: activate transcript mode */
    if (!transcriptCapActive) {
        transcriptCapActive = true;
        console.log("Transcript file detected — transcript capture active");

        /* If muting screen speech, kill any pending screen-change speech */
        if (transcriptMuteScreenToggle.checked) {
            clearTimeout(changeSettleTimer);
            pendingChanges = [];
            awaitingResponse = false;
            window.speechSynthesis.cancel();
        }

        announce("Transcript connected. " + text.length + " bytes on disk.");
    }

    /* Reset the watchdog — fresh data just arrived */
    resetTranscriptWatchdog();

    /* Parse new text into lines */
    const prevLineCount = transcriptLines.length;
    let dirty = false;

    for (let i = 0; i < newText.length; i++) {
        const ch = newText[i];
        if (ch === "\r") continue;

        if (ch === "\n") {
            transcriptLines.push(transcriptLineBuffer);
            transcriptLineBuffer = "";
            dirty = true;
            continue;
        }

        transcriptLineBuffer += ch;

        /* Word-wrap at column width */
        if (transcriptLineBuffer.length >= COLS) {
            transcriptLines.push(transcriptLineBuffer);
            transcriptLineBuffer = "";
            dirty = true;
        }
    }

    if (!dirty) return;

    updateTranscriptConnectionUI();

    /* Optionally render transcript lines to the screen DOM */
    if (transcriptReplaceScreenToggle.checked) {
        const startIdx = Math.max(0, transcriptLines.length - ROWS);
        const displayLines = transcriptLines.slice(startIdx);
        if (transcriptLineBuffer.length > 0) {
            displayLines.push(transcriptLineBuffer);
        }

        for (let r = 0; r < ROWS; r++) {
            const lineText = (r < displayLines.length) ? displayLines[r] : "";
            const el = document.getElementById("screen-line-" + r);
            if (el) {
                el.textContent = lineText || "\u00A0";
                el.setAttribute("aria-label", "Line " + (r + 1) + ": " + (lineText || "blank"));
            }
            prevLines[r] = lineText.padEnd(COLS).slice(0, COLS);
        }
    }

    /* Optionally speak the new lines */
    const newLines = transcriptLines.slice(prevLineCount);

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
            responseLog.push(entry);
            responseNavIndex = responseLog.length - 1;
            updateHistNav();
            for (const line of filtered) addToHistory(line, false);
        }
    }

    /* Recording: capture transcript lines */
    if (isRecording && newLines.length > 0) {
        transcriptBuffer += newLines.join("\n") + "\n\n";
        updateTranscriptUI();
    }
}

/**
 * Start polling the disk for the transcript file.
 */
function startTranscriptPoll() {
    if (transcriptPollTimer) return; /* already polling */
    transcriptPollLastLength = 0;
    transcriptLines = [];
    transcriptLineBuffer = "";
    const ms = parseInt(transcriptPollSpeedSelect.value, 10) || 2000;
    transcriptPollTimer = setInterval(pollTranscriptFile, ms);
    updateTranscriptConnectionUI();
    announce("Watching for " + (transcriptWatchFilename.value || "SCRIPT.TXT") +
             " on disk. Type SCRIPT in the game to start.");
}

/**
 * Stop polling and deactivate transcript capture.
 */
function stopTranscriptPoll() {
    if (transcriptPollTimer) {
        clearInterval(transcriptPollTimer);
        transcriptPollTimer = null;
    }
    transcriptCapActive = false;
    clearTimeout(transcriptWatchdog);
    transcriptWatchdog = null;
    /* Reset prevLines so refreshScreen picks up current screen state */
    prevLines = new Array(ROWS).fill("");
    updateTranscriptConnectionUI();
    announce("Transcript watching stopped. Screen capture resumed.");
}

/**
 * Restart the poll timer at the new speed (called on dropdown change).
 */
function restartTranscriptPoll() {
    if (!transcriptPollTimer) return; /* not currently polling */
    clearInterval(transcriptPollTimer);
    const ms = parseInt(transcriptPollSpeedSelect.value, 10) || 2000;
    transcriptPollTimer = setInterval(pollTranscriptFile, ms);
}

/**
 * Force a transcript flush by sending "script off" to close the file,
 * then re-opening the transcript.
 */
async function flushTranscriptFile() {
    if (!emulator || !isReady) return;
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
function readTranscriptFromDisk() {
    if (!emulator || !isReady) return null;

    const img = getDiskBytes();
    if (!img) return null;

    const geo = parseFATGeometry(img);
    if (!geo) return null;

    const files = parseFATDir(img, geo);
    const target = (transcriptWatchFilename.value || "SCRIPT.TXT").toUpperCase().trim();

    const file = files.find(f => f.fullName.toUpperCase() === target);
    if (!file) return null;

    /* Try cluster chain first (works even when dir size = 0) */
    if (file.firstCluster >= 2) {
        const data = readFATFileByChain(img, geo, file.firstCluster);
        if (data && data.length > 0) {
            return new TextDecoder("ascii").decode(data);
        }
    }

    /* Fall back to directory size (works after fclose) */
    if (file.size > 0) {
        const data = readFATFile(img, geo, file);
        if (data && data.length > 0) {
            return new TextDecoder("ascii").decode(data);
        }
    }

    return null;
}

/**
 * Test Read button: read the transcript file from disk and announce its size.
 */
function testReadTranscript() {
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
function speakLastTranscript() {
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
        if (lines[i].trim().startsWith(promptStr)) {
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
async function autoFlushCycle() {
    if (!emulator || !isReady || autoFlushPending) return;
    autoFlushPending = true;

    /* Kill any pending/in-progress screen speech */
    clearTimeout(changeSettleTimer);
    pendingChanges = [];
    awaitingResponse = false;
    window.speechSynthesis.cancel();

    const fname = (transcriptWatchFilename.value || "SCRIPT.TXT").trim();
    const d1 = parseInt(transcriptFlushD1.value, 10) || 600;
    const d2 = parseInt(transcriptFlushD2.value, 10) || 600;
    const d3 = parseInt(transcriptFlushD3.value, 10) || 400;

    /* Phase 1: Flush to disk */
    await typeToDOS("script off", true);
    await new Promise(r => setTimeout(r, d1));

    /* Phase 2: Read + Parse + Speak */
    const text = readTranscriptFromDisk();

    if (text) {
        /* Update shared transcript state for read mode navigation */
        transcriptLines = [];
        transcriptLineBuffer = "";
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === "\r") continue;
            if (ch === "\n") {
                transcriptLines.push(transcriptLineBuffer);
                transcriptLineBuffer = "";
                continue;
            }
            transcriptLineBuffer += ch;
            if (transcriptLineBuffer.length >= COLS) {
                transcriptLines.push(transcriptLineBuffer);
                transcriptLineBuffer = "";
            }
        }
        transcriptPollLastLength = text.length;
        transcriptCapActive = true;

        /* Render last ROWS lines to DOM for read mode if checked */
        if (transcriptReplaceScreenToggle.checked) {
            const startIdx = Math.max(0, transcriptLines.length - ROWS);
            const displayLines = transcriptLines.slice(startIdx);
            if (transcriptLineBuffer.length > 0) displayLines.push(transcriptLineBuffer);
            for (let r = 0; r < ROWS; r++) {
                const lineText = (r < displayLines.length) ? displayLines[r] : "";
                const el = document.getElementById("screen-line-" + r);
                if (el) {
                    el.textContent = lineText || "\u00A0";
                    el.setAttribute("aria-label", "Line " + (r + 1) + ": " + (lineText || "blank"));
                }
                prevLines[r] = lineText.padEnd(COLS).slice(0, COLS);
            }
        }

        /* Extract the last response */
        const nonEmpty = text.split("\n").filter(l => l.trim().length > 0);
        const promptStr = promptCharInput.value || ">";

        const promptPositions = [];
        for (let i = 0; i < nonEmpty.length; i++) {
            if (nonEmpty[i].trim().startsWith(promptStr)) {
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
            responseLines = nonEmpty.slice(0, -1);
        }

        /* Filter out "Transcript off." confirmation */
        responseLines = responseLines.filter(l =>
            l.trim().toLowerCase() !== "transcript off." &&
            l.trim().toLowerCase() !== "transcript off");

        const cleanText = responseLines.map(l => l.trim()).filter(l => l.length > 0).join(". ");

        if (cleanText) {
            window.speechSynthesis.cancel();
            console.log("Auto-flush response:", cleanText.substring(0, 120));
            speak(cleanText);

            const filtered = responseLines.filter(l => l.trim());
            if (filtered.length > 0) {
                const entry = { type: "response", lines: filtered.map(l => l.trim()) };
                responseLog.push(entry);
                responseNavIndex = responseLog.length - 1;
                updateHistNav();
                for (const line of filtered) addToHistory(line.trim(), false);
            }

            if (isRecording) {
                transcriptBuffer += responseLines.join("\n") + "\n\n";
                updateTranscriptUI();
            }
        }
    }

    /* Phase 3: Re-open transcript (runs while speech is playing) */
    await typeToDOS("script", true);
    await new Promise(r => setTimeout(r, d2));

    /* Only clear pending screen changes, do NOT cancel speech */
    clearTimeout(changeSettleTimer);
    pendingChanges = [];

    await typeToDOS(fname, true);
    await new Promise(r => setTimeout(r, d3));

    clearTimeout(changeSettleTimer);
    pendingChanges = [];

    autoFlushPending = false;
}

/**
 * Schedule an auto-flush after the configured delay.
 */
function scheduleAutoFlush() {
    clearTimeout(autoFlushTimer);
    const delay = parseInt(transcriptFlushDelay.value, 10) || 500;
    autoFlushTimer = setTimeout(autoFlushCycle, delay);
}

/**
 * Update the transcript capture connection status UI.
 */
function updateTranscriptConnectionUI() {
    if (!transcriptCapState) return;
    const isPolling = !!transcriptPollTimer;

    if (transcriptCapActive) {
        transcriptCapState.textContent = "Connected";
        transcriptCapState.style.color = "var(--success, #2d8a4e)";
        transcriptCapInfo.textContent = transcriptLines.length + " lines captured";
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
function resetTranscriptWatchdog() {
    clearTimeout(transcriptWatchdog);
    transcriptWatchdog = setTimeout(function() {
        if (transcriptCapActive) {
            console.warn("Transcript watchdog fired — no data for " +
                         (TRANSCRIPT_TIMEOUT_MS / 1000) + "s, falling back");
            transcriptCapActive = false;
            prevLines = new Array(ROWS).fill("");
            updateTranscriptConnectionUI();
            announce("Transcript timed out. Still watching — will reconnect if new data appears.");
        }
    }, TRANSCRIPT_TIMEOUT_MS);
}

/* ═══════════════════════════════════════════
 * Transcript Recording
 * ═══════════════════════════════════════════ */

function toggleRecording() {
    isRecording = !isRecording;
    recordBtn.textContent = isRecording ? "Stop Recording" : "Start Recording";
    recordBtn.className = isRecording ? "btn-danger btn-sm" : "btn-success btn-sm";
    /* Show/hide REC badge on the section summary */
    const summary = document.querySelector("#section-transcript > summary");
    const badge = summary.querySelector(".recording-badge");
    if (isRecording) {
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

function updateTranscriptUI() {
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

function getCombinedTranscript() {
    let result = transcriptBuffer;
    if (serialBuffer.length > 0) {
        result += "\n--- Printer Output (captured from serial redirect) ---\n";
        result += serialBuffer;
    }
    /* Include clean transcript from game's SCRIPT command if available */
    if (transcriptLines.length > 0) {
        result += "\n--- Game Transcript (captured from file writes via TextCap) ---\n";
        result += transcriptLines.join("\n");
        if (transcriptLineBuffer.length > 0) {
            result += "\n" + transcriptLineBuffer;
        }
    }
    return result;
}

function downloadTranscript() {
    const text = getCombinedTranscript();
    if (!text) return;
    triggerDownload(
        new Uint8Array(new TextEncoder().encode(text)),
        transcriptFilename.value || "transcript.txt",
        "text/plain"
    );
}

function clearTranscript() {
    transcriptBuffer = "";
    serialBuffer = "";
    transcriptLines = [];
    transcriptLineBuffer = "";
    transcriptPollLastLength = 0;
    updateTranscriptUI();
    speak("Transcript cleared.");
}
