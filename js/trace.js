"use strict";

/* ═══════════════════════════════════════════
 * Emulator Debug Tracing
 * ═══════════════════════════════════════════
 *
 * When enabled, logs detailed internal events to an in-memory array.
 * The user can download the trace as a text file for debugging.
 */

/** Add a timestamped entry to the trace log */
function trace(category, message) {
    if (!traceEnabled) return;
    const elapsed = ((Date.now() - traceStartTime) / 1000).toFixed(3);
    traceLog.push("[" + elapsed + "s] [" + category + "] " + message);
}

/** Start tracing */
var traceUITimer = null;
function startTrace() {
    traceEnabled = true;
    traceLog = [];
    traceStartTime = Date.now();
    trace("TRACE", "Tracing started");
    trace("STATE", "isReady=" + isReady +
          " transcriptCapActive=" + transcriptCapActive +
          " textCapActive=" + textCapActive +
          " autoFlushPending=" + autoFlushPending +
          " keyMode=" + keyMode);
    if (emulator) {
        trace("STATE", "Emulator running, game=" + (gameSelect.value || "(custom)"));
    } else {
        trace("STATE", "Emulator not started");
    }
    updateTraceUI();
    /* Periodically refresh the entry count while tracing */
    clearInterval(traceUITimer);
    traceUITimer = setInterval(updateTraceUI, 2000);
}

/** Stop tracing */
function stopTrace() {
    trace("TRACE", "Tracing stopped (" + traceLog.length + " entries)");
    traceEnabled = false;
    clearInterval(traceUITimer);
    traceUITimer = null;
    updateTraceUI();
}

/** Toggle tracing on/off */
function toggleTrace() {
    if (traceEnabled) {
        stopTrace();
    } else {
        startTrace();
    }
}

/** Download the trace log as a text file */
function downloadTrace() {
    if (traceLog.length === 0) {
        announce("No trace data to download.");
        return;
    }

    const header = [
        "═══════════════════════════════════════════",
        " DOS Adventure Player — Debug Trace",
        " Generated: " + new Date().toISOString(),
        " Entries: " + traceLog.length,
        " Game: " + (gameSelect.value || "(custom)"),
        " User Agent: " + navigator.userAgent,
        "═══════════════════════════════════════════",
        ""
    ].join("\n");

    const text = header + traceLog.join("\n") + "\n";
    triggerDownload(
        new Uint8Array(new TextEncoder().encode(text)),
        "emulator-trace-" + Date.now() + ".txt",
        "text/plain"
    );
    announce("Trace downloaded. " + traceLog.length + " entries.");
}

/** Clear the trace log */
function clearTrace() {
    traceLog = [];
    if (traceEnabled) {
        traceStartTime = Date.now();
        trace("TRACE", "Trace cleared and restarted");
    }
    updateTraceUI();
    announce("Trace log cleared.");
}

/** Update the trace UI status text */
function updateTraceUI() {
    if (!traceToggleBtn) return;

    if (traceEnabled) {
        traceToggleBtn.textContent = "Stop Tracing";
        traceToggleBtn.className = "btn-danger btn-sm";
        traceStatus.textContent = "Tracing active — " + traceLog.length + " entries";
        traceStatus.style.color = "var(--error)";
    } else {
        traceToggleBtn.textContent = "Start Tracing";
        traceToggleBtn.className = "btn-secondary btn-sm";
        if (traceLog.length > 0) {
            traceStatus.textContent = traceLog.length + " entries captured (stopped)";
            traceStatus.style.color = "var(--text-secondary)";
        } else {
            traceStatus.textContent = "Idle";
            traceStatus.style.color = "var(--text-secondary)";
        }
    }

    traceDownloadBtn.style.display = traceLog.length > 0 ? "" : "none";
    traceClearBtn.style.display = traceLog.length > 0 ? "" : "none";
}
