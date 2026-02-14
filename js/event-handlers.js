"use strict";

/* ═══════════════════════════════════════════
 * Keyboard Shortcuts (F-keys)
 * ═══════════════════════════════════════════ */

document.addEventListener("keydown", function(e) {
    /*
     * CRITICAL: v86 listens on window for keydown/keyup and sends them to DOS.
     * We ALWAYS stop propagation to prevent ANY keyboard events from reaching
     * v86. All communication with DOS goes through our explicit
     * keyboard_send_text() and keyboard_send_scancodes() calls.
     */
    e.stopPropagation();

    /* F-keys work globally in both modes */
    if (e.key === "F2") { e.preventDefault(); speakScreen(); return; }
    if (e.key === "F3") { e.preventDefault(); speakLast(); return; }
    if (e.key === "F4") { e.preventDefault(); speakNew(); return; }
    if (e.key === "F5") { e.preventDefault(); stopSpeech(); return; }
    if (e.key === "F6") { e.preventDefault(); setMode("insert"); return; }
    if (e.key === "F9") { e.preventDefault(); if (isReady) refreshFileManager(); return; }
    if (e.key === "F10") { e.preventDefault(); if (isReady) saveState(); return; }
    if (e.key === "F11") { e.preventDefault(); if (isReady) stateRestoreInput.click(); return; }
    if (e.key === "F12") {
        e.preventDefault();
        if (transcriptPollTimer) {
            /* Already watching — flush and re-open the transcript */
            flushTranscriptFile();
        } else {
            /* Not watching — start */
            startTranscriptPoll();
        }
        return;
    }

    /* In INSERT mode, F7/F8 navigate response history (legacy behavior) */
    if (keyMode === "insert") {
        if (e.key === "F7") { e.preventDefault(); navPrevResponse(); return; }
        if (e.key === "F8") { e.preventDefault(); navNextResponse(); return; }
    }

    /* In READ mode, route all non-F-key presses through the read handler */
    if (keyMode === "read") {
        const tag = e.target.tagName;
        /* Don't intercept typing in other inputs (filename field, etc.) */
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        handleReadKey(e);
    }
});

/* Block ALL keyup events from reaching v86 */
document.addEventListener("keyup", function(e) {
    e.stopPropagation();
});

/* ═══════════════════════════════════════════
 * Event Handlers
 * ═══════════════════════════════════════════ */

bootBtn.addEventListener("click", () => bootEmulator(true));
bootPromptBtn.addEventListener("click", () => bootEmulator(false));

commandInput.addEventListener("keydown", function(e) {
    /*
     * CRITICAL: v86 captures keydown on window. We must ALWAYS stop
     * propagation from the input field.
     */
    e.stopPropagation();

    if (!isReady) return;

    /* If in read mode, don't process input keystrokes */
    if (keyMode === "read") {
        e.preventDefault();
        return;
    }

    /* Escape: switch to read mode (always available) */
    if (e.key === "Escape") {
        e.preventDefault(); setMode("read"); return;
    }

    /*
     * Single-key mode: each keypress goes directly to DOS without Enter.
     */
    if (singleKeyToggle.checked) {
        e.preventDefault();

        /* Let F-keys through to the global handler */
        if (e.key.startsWith("F") && e.key.length <= 3) return;

        if (e.key === "Enter") {
            awaitingResponse = true; pendingChanges = [];
            emulator.keyboard_send_scancodes(SCANCODES.ENTER);
            return;
        }
        if (e.key === "Backspace") {
            emulator.keyboard_send_scancodes([0x0E, 0x8E]);
            return;
        }
        if (e.key === "ArrowUp") {
            emulator.keyboard_send_scancodes([0x48, 0xC8]);
            speak("up"); return;
        }
        if (e.key === "ArrowDown") {
            emulator.keyboard_send_scancodes([0x50, 0xD0]);
            speak("down"); return;
        }
        if (e.key === "ArrowLeft") {
            emulator.keyboard_send_scancodes([0x4B, 0xCB]);
            return;
        }
        if (e.key === "ArrowRight") {
            emulator.keyboard_send_scancodes([0x4D, 0xCD]);
            return;
        }

        /* Printable characters: send via keyboard_send_text */
        if (e.key.length === 1) {
            awaitingResponse = true; pendingChanges = [];
            emulator.keyboard_send_text(e.key);
            speak(e.key);
            return;
        }
        return;
    }

    /* ─── Normal INSERT mode below ─── */

    /* Enter: send command */
    if (e.key === "Enter") {
        e.preventDefault(); sendCommand(this.value); this.value = ""; return;
    }

    /* Arrow Up: command history with speech */
    if (e.key === "ArrowUp") {
        e.preventDefault();
        if (commandHistory.length) {
            historyIndex = (historyIndex === -1) ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
            this.value = commandHistory[historyIndex];
            speak(this.value);
        }
        return;
    }

    /* Arrow Down: command history with speech */
    if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex >= 0) {
            historyIndex++;
            if (historyIndex >= commandHistory.length) {
                historyIndex = -1; this.value = ""; speak("empty");
            } else {
                this.value = commandHistory[historyIndex]; speak(this.value);
            }
        }
        return;
    }

    /* Arrow Left: speak character at cursor */
    if (e.key === "ArrowLeft") {
        setTimeout(() => {
            const pos = this.selectionStart;
            const ch = this.value[pos];
            if (ch !== undefined) speak(ch === " " ? "space" : ch);
        }, 10);
        return;
    }

    /* Arrow Right: speak character just passed */
    if (e.key === "ArrowRight") {
        setTimeout(() => {
            const pos = this.selectionStart;
            const ch = this.value[pos - 1];
            if (ch !== undefined) speak(ch === " " ? "space" : ch);
            else speak("end");
        }, 10);
        return;
    }

    /* Backspace: speak deleted character */
    if (e.key === "Backspace") {
        const pos = this.selectionStart;
        if (pos > 0) {
            const deleted = this.value[pos - 1];
            speak(deleted === " " ? "space" : deleted);
        }
        return;
    }

    /* Typing feedback: speak characters or words as user types */
    const feedbackMode = typingFeedbackSelect.value;
    if (feedbackMode !== "none" && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (feedbackMode === "characters") {
            /* Speak every character as it's typed */
            speak(e.key === " " ? "space" : e.key);
        } else if (feedbackMode === "words" && e.key === " ") {
            /* On space, extract and speak the word just completed */
            setTimeout(() => {
                const val = this.value;
                const pos = this.selectionStart;
                /* Walk back from just before the space to find the word */
                let end = pos - 1; /* the space we just typed */
                while (end > 0 && val[end - 1] === " ") end--;
                let start = end;
                while (start > 0 && val[start - 1] !== " ") start--;
                const word = val.slice(start, end).trim();
                if (word) speak(word);
            }, 10);
        }
    }
});

/* Also block keyup from input reaching v86 (prevents shift/modifier stuck state) */
commandInput.addEventListener("keyup", function(e) { e.stopPropagation(); });

sendBtn.addEventListener("click", () => { if (!isReady) return; sendCommand(commandInput.value); commandInput.value = ""; commandInput.focus(); });
enterOnlyBtn.addEventListener("click", () => { if (!isReady || !emulator) return; sendEnter(); commandInput.focus(); });

speakScreenBtn.addEventListener("click", speakScreen);
speakLastBtn.addEventListener("click", speakLast);
speakNewBtn.addEventListener("click", speakNew);
stopSpeechBtn.addEventListener("click", stopSpeech);
testSpeechBtn.addEventListener("click", () => speak("Speech test. Speed " + rateSlider.value + ", pitch " + pitchSlider.value + "."));

rateSlider.addEventListener("input", () => { rateValue.textContent = parseFloat(rateSlider.value).toFixed(1); });
pitchSlider.addEventListener("input", () => { pitchValue.textContent = parseFloat(pitchSlider.value).toFixed(1); });

histPrevBtn.addEventListener("click", navPrevResponse);
histNextBtn.addEventListener("click", navNextResponse);

fmRefreshBtn.addEventListener("click", refreshFileManager);
fmUploadBtn.addEventListener("click", () => fmUploadInput.click());
fmUploadInput.addEventListener("change", function() { if (this.files.length) uploadFiles(this.files); this.value = ""; });
fmDlFloppyBtn.addEventListener("click", downloadFloppyImage);

stateSaveBtn.addEventListener("click", saveState);
stateRestoreBtn.addEventListener("click", () => stateRestoreInput.click());
stateRestoreInput.addEventListener("change", function() { if (this.files.length) restoreState(this.files[0]); this.value = ""; });

recordBtn.addEventListener("click", toggleRecording);
downloadTranscriptBtn.addEventListener("click", downloadTranscript);
clearTranscriptBtn.addEventListener("click", clearTranscript);
transcriptWatchBtn.addEventListener("click", startTranscriptPoll);
transcriptFlushBtn.addEventListener("click", flushTranscriptFile);
transcriptDisconnectBtn.addEventListener("click", stopTranscriptPoll);
transcriptPollSpeedSelect.addEventListener("change", restartTranscriptPoll);
transcriptTestReadBtn.addEventListener("click", testReadTranscript);
transcriptSpeakLastBtn.addEventListener("click", speakLastTranscript);
transcriptAutoFlushToggle.addEventListener("change", function() {
    transcriptAutoFlushOptions.style.display = this.checked ? "" : "none";
    if (this.checked) {
        announce("Auto-flush enabled. Each command will flush and speak the response.");
    }
});

/* Update the total time display when any delay field changes */
function updateFlushTotal() {
    const d0 = parseInt(transcriptFlushDelay.value, 10) || 0;
    const d1 = parseInt(transcriptFlushD1.value, 10) || 0;
    const d2 = parseInt(transcriptFlushD2.value, 10) || 0;
    const d3 = parseInt(transcriptFlushD3.value, 10) || 0;
    transcriptFlushTotal.textContent = (d0 + d1 + d2 + d3).toString();
}
transcriptFlushDelay.addEventListener("input", updateFlushTotal);
transcriptFlushD1.addEventListener("input", updateFlushTotal);
transcriptFlushD2.addEventListener("input", updateFlushTotal);
transcriptFlushD3.addEventListener("input", updateFlushTotal);

/* Debug tracing */
traceToggleBtn.addEventListener("click", toggleTrace);
traceDownloadBtn.addEventListener("click", downloadTrace);
traceClearBtn.addEventListener("click", clearTrace);
traceFSTrackToggle.addEventListener("change", toggleFSTracking);
traceFSSnapBtn.addEventListener("click", takeSnapshotNow);
traceFSDiffBtn.addEventListener("click", function() { traceFSDiff("manual"); });

/* Copy history to clipboard */
histCopyBtn.addEventListener("click", function() {
    const entries = historyLog.querySelectorAll(".history-entry");
    if (!entries.length) {
        announce("No history to copy.");
        return;
    }
    const lines = [];
    for (const entry of entries) {
        lines.push(entry.textContent);
    }
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(function() {
        announce("History copied to clipboard.");
    }, function() {
        /* Fallback for older browsers or permission denied */
        announce("Could not copy to clipboard.");
    });
});

window.addEventListener("load", () => {
    if (typeof V86Starter === "undefined" && typeof V86 === "undefined") {
        setStatus("error", "v86 not loaded. Serve via HTTP. Use start.command or: python3 -m http.server 8000");
        bootBtn.disabled = true; bootPromptBtn.disabled = true;
    }
});
