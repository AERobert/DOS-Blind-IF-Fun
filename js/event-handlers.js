import { state, bootBtn, bootPromptBtn, commandInput, sendBtn, enterOnlyBtn, singleKeyToggle, speakScreenBtn, speakLastBtn, speakNewBtn, stopSpeechBtn, testSpeechBtn, rateSlider, rateValue, pitchSlider, pitchValue, histPrevBtn, histNextBtn, fmRefreshBtn, fmUploadBtn, fmUploadInput, fmDlFloppyBtn, stateSaveBtn, stateRestoreBtn, stateRestoreInput, recordBtn, downloadTranscriptBtn, clearTranscriptBtn, transcriptWatchBtn, transcriptFlushBtn, transcriptDisconnectBtn, transcriptPollSpeedSelect, transcriptTestReadBtn, transcriptSpeakLastBtn, transcriptAutoFlushToggle, transcriptAutoFlushOptions, traceToggleBtn, traceDownloadBtn, traceClearBtn, traceFSTrackToggle, traceFSSnapBtn, traceFSDiffBtn, histCopyBtn, historyLog, preloadFilesBtn, preloadFilesInput, preloadFilesList, preloadFilesCount, typingFeedbackSelect, transcriptFlushDelay, transcriptFlushD1, transcriptFlushD2, transcriptFlushD3, transcriptFlushTotal, gameSelect, modeIndicator,
         devConToggle, devCom1Toggle, devCom2Toggle, devLpt1Toggle,
         devConDownloadBtn, devCom1DownloadBtn, devCom2DownloadBtn, devLpt1DownloadBtn,
         devConClearBtn, devCom1ClearBtn, devCom2ClearBtn, devLpt1ClearBtn,
         devDownloadAllBtn, devClearAllBtn } from './state.js';
import { SCANCODES } from './constants.js';
import { speakScreen, speakLast, speakNew } from './speech-actions.js';
import { speak, stopSpeech } from './speech.js';
import { setMode, handleReadKey } from './reading-mode.js';
import { setStatus, announce, formatSize } from './ui-helpers.js';
import { bootEmulator } from './emulator.js';
import { sendCommand, sendEnter } from './commands.js';
import { navPrevResponse, navNextResponse } from './history.js';
import { refreshFileManager, uploadFiles, downloadFloppyImage } from './file-manager.js';
import { saveState, restoreState } from './state-save.js';
import { toggleRecording, downloadTranscript, clearTranscript, startTranscriptPoll, flushTranscriptFile, stopTranscriptPoll, restartTranscriptPoll, testReadTranscript, speakLastTranscript } from './transcript.js';
import { toggleTrace, downloadTrace, clearTrace, toggleFSTracking, takeSnapshotNow, traceFSDiff } from './trace.js';
import { saveFileToStorage, fileDB, renderStoredFilesTable } from './file-storage.js';
import { toggleConCapture, toggleCom1Capture, toggleCom2Capture, toggleLpt1Capture,
         downloadConCapture, downloadCom1Capture, downloadCom2Capture, downloadLpt1Capture, downloadAllCaptures,
         clearConCapture, clearCom1Capture, clearCom2Capture, clearLpt1Capture, clearAllCaptures } from './devices.js';

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
    if (e.key === "F9") { e.preventDefault(); if (state.isReady) refreshFileManager(); return; }
    if (e.key === "F10") { e.preventDefault(); if (state.isReady) saveState(); return; }
    if (e.key === "F11") { e.preventDefault(); if (state.isReady) stateRestoreInput.click(); return; }
    if (e.key === "F12") {
        e.preventDefault();
        if (state.transcriptPollTimer) {
            /* Already watching — flush and re-open the transcript */
            flushTranscriptFile();
        } else {
            /* Not watching — start */
            startTranscriptPoll();
        }
        return;
    }

    /* In INSERT mode, F7/F8 navigate response history (legacy behavior) */
    if (state.keyMode === "insert") {
        if (e.key === "F7") { e.preventDefault(); navPrevResponse(); return; }
        if (e.key === "F8") { e.preventDefault(); navNextResponse(); return; }
    }

    /* In READ mode, route all non-F-key presses through the read handler */
    if (state.keyMode === "read") {
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

    if (!state.isReady) return;

    /* If in read mode, don't process input keystrokes */
    if (state.keyMode === "read") {
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
            state.awaitingResponse = true; state.pendingChanges = [];
            state.emulator.keyboard_send_scancodes(SCANCODES.ENTER);
            return;
        }
        if (e.key === "Backspace") {
            state.emulator.keyboard_send_scancodes([0x0E, 0x8E]);
            return;
        }
        if (e.key === "ArrowUp") {
            state.emulator.keyboard_send_scancodes([0x48, 0xC8]);
            speak("up"); return;
        }
        if (e.key === "ArrowDown") {
            state.emulator.keyboard_send_scancodes([0x50, 0xD0]);
            speak("down"); return;
        }
        if (e.key === "ArrowLeft") {
            state.emulator.keyboard_send_scancodes([0x4B, 0xCB]);
            return;
        }
        if (e.key === "ArrowRight") {
            state.emulator.keyboard_send_scancodes([0x4D, 0xCD]);
            return;
        }

        /* Printable characters: send via keyboard_send_text */
        if (e.key.length === 1) {
            state.awaitingResponse = true; state.pendingChanges = [];
            state.emulator.keyboard_send_text(e.key);
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
        if (state.commandHistory.length) {
            state.historyIndex = (state.historyIndex === -1) ? state.commandHistory.length - 1 : Math.max(0, state.historyIndex - 1);
            this.value = state.commandHistory[state.historyIndex];
            speak(this.value);
        }
        return;
    }

    /* Arrow Down: command history with speech */
    if (e.key === "ArrowDown") {
        e.preventDefault();
        if (state.historyIndex >= 0) {
            state.historyIndex++;
            if (state.historyIndex >= state.commandHistory.length) {
                state.historyIndex = -1; this.value = ""; speak("empty");
            } else {
                this.value = state.commandHistory[state.historyIndex]; speak(this.value);
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

sendBtn.addEventListener("click", () => { if (!state.isReady) return; sendCommand(commandInput.value); commandInput.value = ""; commandInput.focus(); });
enterOnlyBtn.addEventListener("click", () => { if (!state.isReady || !state.emulator) return; sendEnter(); commandInput.focus(); });

/* Mode indicator toggle button — cycles between INSERT and READ */
modeIndicator.addEventListener("click", function() {
    setMode(state.keyMode === "insert" ? "read" : "insert");
});

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

/* ═══════════════════════════════════════════
 * Pre-load Files (queued before boot)
 * ═══════════════════════════════════════════ */

function renderPreloadFilesList() {
    preloadFilesList.innerHTML = "";
    if (state.preloadFiles.length === 0) {
        preloadFilesCount.textContent = "";
        return;
    }
    preloadFilesCount.textContent = state.preloadFiles.length + " file(s) queued";
    for (let i = 0; i < state.preloadFiles.length; i++) {
        const pf = state.preloadFiles[i];
        const item = document.createElement("div");
        item.className = "preload-file-item";

        const nameSpan = document.createElement("span");
        nameSpan.className = "file-name";
        nameSpan.textContent = pf.name;
        item.appendChild(nameSpan);

        const sizeSpan = document.createElement("span");
        sizeSpan.className = "file-size";
        sizeSpan.textContent = formatSize(pf.data.byteLength);
        item.appendChild(sizeSpan);

        /* Save to persistent storage */
        if (fileDB) {
            const saveBtn = document.createElement("button");
            saveBtn.className = "save-btn";
            saveBtn.textContent = "Save";
            saveBtn.title = "Save to persistent storage";
            saveBtn.setAttribute("aria-label", "Save " + pf.name + " to storage");
            saveBtn.addEventListener("click", (function(file) {
                return function() {
                    saveFileToStorage(file.name, file.data, gameSelect.value).then(function() {
                        announce("Saved " + file.name + " to storage.");
                        renderStoredFilesTable();
                    }).catch(function() {
                        announce("Failed to save " + file.name + ".");
                    });
                };
            })(pf));
            item.appendChild(saveBtn);
        }

        const removeBtn = document.createElement("button");
        removeBtn.className = "remove-btn";
        removeBtn.textContent = "\u00D7";
        removeBtn.title = "Remove " + pf.name;
        removeBtn.setAttribute("aria-label", "Remove " + pf.name);
        removeBtn.addEventListener("click", (function(idx) {
            return function() {
                state.preloadFiles.splice(idx, 1);
                renderPreloadFilesList();
            };
        })(i));
        item.appendChild(removeBtn);

        preloadFilesList.appendChild(item);
    }
}

preloadFilesBtn.addEventListener("click", () => preloadFilesInput.click());
preloadFilesInput.addEventListener("change", function() {
    if (!this.files.length) return;
    let pending = this.files.length;
    for (const f of this.files) {
        const reader = new FileReader();
        const name = f.name;
        reader.onload = function() {
            state.preloadFiles.push({ name: name, data: reader.result });
            pending--;
            if (pending === 0) renderPreloadFilesList();
        };
        reader.readAsArrayBuffer(f);
    }
    this.value = "";
});

/* ═══════════════════════════════════════════
 * DOS Device Monitor
 * ═══════════════════════════════════════════ */

if (devConToggle) devConToggle.addEventListener("change", toggleConCapture);
if (devCom1Toggle) devCom1Toggle.addEventListener("change", toggleCom1Capture);
if (devCom2Toggle) devCom2Toggle.addEventListener("change", toggleCom2Capture);
if (devLpt1Toggle) devLpt1Toggle.addEventListener("change", toggleLpt1Capture);
if (devConDownloadBtn) devConDownloadBtn.addEventListener("click", downloadConCapture);
if (devCom1DownloadBtn) devCom1DownloadBtn.addEventListener("click", downloadCom1Capture);
if (devCom2DownloadBtn) devCom2DownloadBtn.addEventListener("click", downloadCom2Capture);
if (devLpt1DownloadBtn) devLpt1DownloadBtn.addEventListener("click", downloadLpt1Capture);
if (devConClearBtn) devConClearBtn.addEventListener("click", clearConCapture);
if (devCom1ClearBtn) devCom1ClearBtn.addEventListener("click", clearCom1Capture);
if (devCom2ClearBtn) devCom2ClearBtn.addEventListener("click", clearCom2Capture);
if (devLpt1ClearBtn) devLpt1ClearBtn.addEventListener("click", clearLpt1Capture);
if (devDownloadAllBtn) devDownloadAllBtn.addEventListener("click", downloadAllCaptures);
if (devClearAllBtn) devClearAllBtn.addEventListener("click", clearAllCaptures);

window.addEventListener("load", () => {
    if (typeof V86Starter === "undefined" && typeof V86 === "undefined") {
        setStatus("error", "v86 not loaded. Serve via HTTP. Use start.command or: python3 -m http.server 8000");
        bootBtn.disabled = true; bootPromptBtn.disabled = true;
    }
});
