"use strict";

/* ═══════════════════════════════════════════
 * Emulator Debug Tracing
 * ═══════════════════════════════════════════
 *
 * When enabled, logs detailed internal events to an in-memory array.
 * The user can download the trace as a text file for debugging.
 *
 * Features:
 * - Serial I/O marker detection (STX/ETX framing patterns)
 * - Filesystem snapshot + diff to detect file changes
 * - Text pattern detection (Transcript off, Saving, etc.)
 * - Configurable verbosity via checkboxes
 */

/* ─── Filesystem snapshot state ─── */
var fsSnapshot = null;          /* { files: [{name,size,cluster},...], timestamp } */
var fsSnapshotTimer = null;     /* periodic auto-diff interval */
var fsDiffCount = 0;            /* number of diffs performed */
var lastFATGeometryStr = "";    /* dedup repeated FAT geometry logs */

/* ─── Serial file-I/O marker detection ─── */
/*
 * Some games (e.g. Legend Entertainment) emit a framing pattern on the serial
 * port when file operations occur:
 *   <STX> O <ETX> = file Open/create
 *   <STX> C <ETX> = file Close
 *   <STX> W <ETX> = file Write (less common)
 *
 * These arrive via TextCap's INT 10h hook — the game writes status characters
 * to the screen and TextCap mirrors them to COM1 with STX/ETX framing.
 */
var fileIOMarkerState = 0;      /* state machine position */
var fileIOMarkerBuf = "";       /* accumulates detected marker chars */
var fileIOMarkerTimer = null;   /* batch timer for reporting */

/** Add a timestamped entry to the trace log */
function trace(category, message) {
    if (!traceEnabled) return;
    var elapsed = ((Date.now() - traceStartTime) / 1000).toFixed(3);
    traceLog.push("[" + elapsed + "s] [" + category + "] " + message);
}

/** Start tracing */
var traceUITimer = null;
function startTrace() {
    traceEnabled = true;
    traceLog = [];
    traceStartTime = Date.now();
    lastFATGeometryStr = "";
    trace("TRACE", "Tracing started");
    trace("STATE", "isReady=" + isReady +
          " transcriptCapActive=" + transcriptCapActive +
          " textCapActive=" + textCapActive +
          " autoFlushPending=" + autoFlushPending +
          " keyMode=" + keyMode);
    if (emulator) {
        trace("STATE", "Emulator running, game=" + (gameSelect.value || "(custom)") +
              " diskType=" + diskTypeSelect.value);
    } else {
        trace("STATE", "Emulator not started");
    }
    /* Log current filesystem state on trace start */
    if (emulator && isReady) {
        traceCurrentFilesystem();
    }
    updateTraceUI();
    /* Periodically refresh the entry count while tracing */
    clearInterval(traceUITimer);
    traceUITimer = setInterval(updateTraceUI, 2000);
    /* Start auto-diff if the checkbox is on */
    if (traceFSTrackToggle && traceFSTrackToggle.checked) {
        startFSAutoTracking();
    }
}

/** Stop tracing */
function stopTrace() {
    trace("TRACE", "Tracing stopped (" + traceLog.length + " entries)");
    traceEnabled = false;
    clearInterval(traceUITimer);
    traceUITimer = null;
    stopFSAutoTracking();
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

    var header = [
        "═══════════════════════════════════════════",
        " DOS Adventure Player — Debug Trace",
        " Generated: " + new Date().toISOString(),
        " Entries: " + traceLog.length,
        " Game: " + (gameSelect.value || "(custom)"),
        " Disk Type: " + diskTypeSelect.value,
        " FS Tracking: " + (traceFSTrackToggle ? traceFSTrackToggle.checked : "n/a"),
        " FS Snapshots taken: " + fsDiffCount,
        " User Agent: " + navigator.userAgent,
        "═══════════════════════════════════════════",
        ""
    ].join("\n");

    var text = header + traceLog.join("\n") + "\n";
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
    lastFATGeometryStr = "";
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
        traceStatus.textContent = "Tracing active — " + traceLog.length + " entries" +
            (fsSnapshot ? " | FS tracked (" + fsDiffCount + " diffs)" : "");
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

/* ═══════════════════════════════════════════
 * FAT trace deduplication
 * ═══════════════════════════════════════════
 *
 * readTranscriptFromDisk is called every poll cycle (0.5s-5s).
 * FAT geometry never changes, so we only log it once or when it differs.
 */

/** Log FAT geometry only if it changed since last log */
function traceFATGeometry(geo) {
    if (!traceEnabled || !geo) return;
    var key = "FAT" + geo.fatType + " spc=" + geo.sectorsPerCluster +
              " bpc=" + geo.bytesPerCluster + " data=0x" + geo.dataStart.toString(16);
    if (key !== lastFATGeometryStr) {
        lastFATGeometryStr = key;
        trace("FAT", key + " (geometry logged once, suppressing repeats)");
    }
}

/* ═══════════════════════════════════════════
 * Serial file-I/O marker detection
 * ═══════════════════════════════════════════
 *
 * State machine to detect STX-char-ETX patterns in the serial stream.
 * STX = 0x02, ETX = 0x03. The char between them is the operation code.
 *
 * States:
 *   0 = idle (waiting for STX)
 *   1 = got STX (waiting for operation char)
 *   2 = got operation char (waiting for ETX)
 */

function checkFileIOMarker(byte) {
    switch (fileIOMarkerState) {
        case 0: /* idle */
            if (byte === 0x02) {
                fileIOMarkerState = 1;
            }
            break;
        case 1: /* got STX, next byte is the operation */
            if (byte >= 0x20 && byte < 0x7F) {
                fileIOMarkerBuf += String.fromCharCode(byte);
                fileIOMarkerState = 2;
            } else if (byte === 0x02) {
                /* Another STX — stay in state 1 */
            } else {
                fileIOMarkerState = 0;
                fileIOMarkerBuf = "";
            }
            break;
        case 2: /* got operation, waiting for ETX */
            if (byte === 0x03) {
                /* Complete marker! */
                fileIOMarkerState = 0;
                flushFileIOMarkers();
            } else if (byte === 0x02) {
                /* New STX — previous was incomplete, reset */
                fileIOMarkerState = 1;
            } else {
                /* Unexpected byte — not a marker */
                fileIOMarkerState = 0;
                fileIOMarkerBuf = "";
            }
            break;
    }
}

/** Flush accumulated file I/O markers and log them */
function flushFileIOMarkers() {
    if (!fileIOMarkerBuf) return;

    /* Decode the marker characters into human-readable operations */
    var ops = [];
    for (var i = 0; i < fileIOMarkerBuf.length; i++) {
        var ch = fileIOMarkerBuf[i];
        switch (ch) {
            case 'O': ops.push("OPEN/CREATE"); break;
            case 'C': ops.push("CLOSE"); break;
            case 'W': ops.push("WRITE"); break;
            case 'R': ops.push("READ"); break;
            default:  ops.push("OP(" + ch + ")"); break;
        }
    }

    trace("FILE_IO", "Serial marker detected: <STX>" + fileIOMarkerBuf +
          "<ETX> => " + ops.join(" + "));

    /* If filesystem tracking is on, take a diff now */
    if (traceFSTrackToggle && traceFSTrackToggle.checked && fsSnapshot) {
        /* Small delay to let DOS finish writing */
        setTimeout(function() {
            traceFSDiff("triggered by FILE_IO marker");
        }, 500);
    }

    fileIOMarkerBuf = "";
}

/* ═══════════════════════════════════════════
 * Text pattern detection in serial/screen output
 * ═══════════════════════════════════════════
 *
 * Watches for notable text strings that indicate game events:
 * - "Transcript off." / "Script off." — transcript file closed
 * - "Saving..." — game save operation starting
 * - "Restoring..." — game restore operation starting
 * - "Ok." / "[Ok]" — command acknowledged
 */

var textPatternBuf = "";        /* accumulates recent printable chars */
var textPatternTimer = null;

var TEXT_PATTERNS = [
    { pattern: "transcript off",  label: "TRANSCRIPT_CLOSE", ci: true },
    { pattern: "script off",      label: "TRANSCRIPT_CLOSE", ci: true },
    { pattern: "saving",          label: "GAME_SAVE",        ci: true },
    { pattern: "restoring",       label: "GAME_RESTORE",     ci: true },
    { pattern: "loading",         label: "GAME_LOAD",        ci: true },
];

/** Feed printable text into the pattern detector */
function traceTextPattern(text) {
    if (!traceEnabled) return;
    textPatternBuf += text;
    /* Keep buffer from growing unbounded — only need last ~200 chars */
    if (textPatternBuf.length > 200) {
        textPatternBuf = textPatternBuf.slice(-100);
    }
    if (!textPatternTimer) {
        textPatternTimer = setTimeout(function() {
            checkTextPatterns();
            textPatternTimer = null;
        }, 150);
    }
}

/** Check the text buffer for known patterns */
function checkTextPatterns() {
    var lower = textPatternBuf.toLowerCase();
    for (var i = 0; i < TEXT_PATTERNS.length; i++) {
        var p = TEXT_PATTERNS[i];
        var idx = lower.indexOf(p.pattern);
        if (idx >= 0) {
            /* Extract context around the match */
            var start = Math.max(0, idx - 10);
            var end = Math.min(textPatternBuf.length, idx + p.pattern.length + 20);
            var context = textPatternBuf.slice(start, end).replace(/[\r\n]+/g, " ").trim();
            trace("DETECT", p.label + " pattern found: \"" + context + "\"");

            /* If FS tracking is on, snapshot after save/restore events */
            if ((p.label === "GAME_SAVE" || p.label === "GAME_RESTORE" || p.label === "GAME_LOAD") &&
                traceFSTrackToggle && traceFSTrackToggle.checked && fsSnapshot) {
                setTimeout(function() {
                    traceFSDiff("triggered by " + p.label + " pattern");
                }, 1500);
            }

            /* Clear the buffer after a match to prevent re-firing */
            textPatternBuf = "";
            return;
        }
    }
}

/* ═══════════════════════════════════════════
 * Filesystem snapshot & diff
 * ═══════════════════════════════════════════
 *
 * Takes a snapshot of all files on the game disk (names, sizes, first cluster,
 * cluster chain length). When a diff is requested, compares against the last
 * snapshot to find new, deleted, modified, or size-changed files.
 */

/** Take a filesystem snapshot and return it */
function takeFilesystemSnapshot() {
    if (!emulator || !isReady) return null;

    var img = getDiskBytes();
    if (!img) return null;

    var geo = parseFATGeometry(img);
    if (!geo) return null;

    var dirFiles = parseFATDir(img, geo);
    var files = [];

    for (var i = 0; i < dirFiles.length; i++) {
        var f = dirFiles[i];

        /* Count cluster chain length (shows actual allocated space) */
        var chainLen = 0;
        if (f.firstCluster >= 2) {
            var c = f.firstCluster;
            var safety = 10000;
            while (c >= 2 && !isEOF(geo, c) && --safety > 0) {
                chainLen++;
                c = readFATEntry(img, geo, c);
            }
        }

        /* Read a content hash (first 64 bytes) for change detection */
        var contentPreview = "";
        if (f.firstCluster >= 2) {
            var offset = geo.dataStart + (f.firstCluster - 2) * geo.bytesPerCluster;
            var previewLen = Math.min(64, geo.bytesPerCluster, img.length - offset);
            if (previewLen > 0) {
                var slice = img.slice(offset, offset + previewLen);
                for (var b = 0; b < slice.length; b++) {
                    contentPreview += String.fromCharCode(slice[b]);
                }
            }
        }

        files.push({
            name: f.fullName,
            size: f.size,
            cluster: f.firstCluster,
            chainLen: chainLen,
            allocBytes: chainLen * geo.bytesPerCluster,
            isDir: f.isDir,
            contentPreview: contentPreview
        });
    }

    return {
        files: files,
        timestamp: Date.now(),
        fatType: geo.fatType,
        totalClusters: geo.totalClusters,
        bytesPerCluster: geo.bytesPerCluster
    };
}

/** Log the current filesystem to the trace */
function traceCurrentFilesystem() {
    var snap = takeFilesystemSnapshot();
    if (!snap) {
        trace("FS", "Could not read filesystem");
        return;
    }
    trace("FS", "FAT" + snap.fatType + " — " + snap.files.length + " files, " +
          snap.totalClusters + " total clusters, " + snap.bytesPerCluster + " bytes/cluster");
    for (var i = 0; i < snap.files.length; i++) {
        var f = snap.files[i];
        trace("FS", "  " + f.name.padEnd(13) +
              " dirSize=" + String(f.size).padStart(8) +
              " chain=" + f.chainLen + " clusters" +
              " (" + f.allocBytes + " bytes alloc)" +
              (f.isDir ? " [DIR]" : "") +
              (f.size === 0 && f.chainLen > 0 ? " [OPEN? dirSize=0 but has chain]" : ""));
    }
}

/** Take a new snapshot and use it as the baseline */
function takeSnapshotNow() {
    fsSnapshot = takeFilesystemSnapshot();
    fsDiffCount = 0;
    if (fsSnapshot) {
        trace("FS_SNAP", "Baseline snapshot taken: " + fsSnapshot.files.length + " files");
        if (traceEnabled) {
            for (var i = 0; i < fsSnapshot.files.length; i++) {
                var f = fsSnapshot.files[i];
                trace("FS_SNAP", "  " + f.name.padEnd(13) +
                      " size=" + f.size + " chain=" + f.chainLen +
                      (f.isDir ? " [DIR]" : ""));
            }
        }
        announce("Filesystem snapshot taken. " + fsSnapshot.files.length + " files.");
    } else {
        announce("Could not snapshot filesystem. Is the emulator running?");
    }
    updateTraceUI();
}

/** Compare current filesystem against the last snapshot, log differences */
function traceFSDiff(reason) {
    if (!fsSnapshot) {
        trace("FS_DIFF", "No baseline snapshot — take a snapshot first");
        return;
    }

    var current = takeFilesystemSnapshot();
    if (!current) {
        trace("FS_DIFF", "Could not read current filesystem");
        return;
    }

    fsDiffCount++;
    var changes = [];

    /* Build lookup maps */
    var oldMap = {};
    for (var i = 0; i < fsSnapshot.files.length; i++) {
        oldMap[fsSnapshot.files[i].name] = fsSnapshot.files[i];
    }
    var newMap = {};
    for (var j = 0; j < current.files.length; j++) {
        newMap[current.files[j].name] = current.files[j];
    }

    /* Check for new or modified files */
    for (var name in newMap) {
        var nf = newMap[name];
        var of_ = oldMap[name];

        if (!of_) {
            changes.push("NEW: " + name + " size=" + nf.size +
                         " chain=" + nf.chainLen + " (" + nf.allocBytes + " bytes alloc)");
            continue;
        }

        var diffs = [];
        if (nf.size !== of_.size) {
            diffs.push("size " + of_.size + " -> " + nf.size);
        }
        if (nf.chainLen !== of_.chainLen) {
            diffs.push("chain " + of_.chainLen + " -> " + nf.chainLen +
                        " clusters (" + of_.allocBytes + " -> " + nf.allocBytes + " bytes)");
        }
        if (nf.cluster !== of_.cluster) {
            diffs.push("startCluster " + of_.cluster + " -> " + nf.cluster);
        }
        if (nf.contentPreview !== of_.contentPreview) {
            diffs.push("content changed (first 64 bytes differ)");
        }
        if (diffs.length > 0) {
            changes.push("MODIFIED: " + name + " — " + diffs.join(", "));
        }
    }

    /* Check for deleted files */
    for (var oname in oldMap) {
        if (!newMap[oname]) {
            changes.push("DELETED: " + oname +
                         " (was size=" + oldMap[oname].size +
                         " chain=" + oldMap[oname].chainLen + ")");
        }
    }

    /* Log results */
    if (changes.length > 0) {
        trace("FS_DIFF", "Diff #" + fsDiffCount + " (" + (reason || "manual") + ") — " +
              changes.length + " change(s):");
        for (var c = 0; c < changes.length; c++) {
            trace("FS_DIFF", "  " + changes[c]);
        }
    } else {
        trace("FS_DIFF", "Diff #" + fsDiffCount + " (" + (reason || "manual") + ") — no changes");
    }

    /* Update baseline to current for next diff */
    fsSnapshot = current;
    updateTraceUI();
}

/** Start periodic filesystem auto-tracking */
function startFSAutoTracking() {
    if (fsSnapshotTimer) return;
    if (!fsSnapshot) {
        takeSnapshotNow();
    }
    /* Auto-diff every 5 seconds */
    fsSnapshotTimer = setInterval(function() {
        if (traceEnabled) {
            traceFSDiff("periodic auto-check");
        }
    }, 5000);
    trace("FS_TRACK", "Auto-tracking started (diff every 5s)");
}

/** Stop periodic filesystem auto-tracking */
function stopFSAutoTracking() {
    if (fsSnapshotTimer) {
        clearInterval(fsSnapshotTimer);
        fsSnapshotTimer = null;
    }
}

/** Toggle filesystem tracking */
function toggleFSTracking() {
    if (!traceFSTrackToggle) return;
    if (traceFSTrackToggle.checked) {
        if (traceEnabled) {
            startFSAutoTracking();
        }
        announce("Filesystem change tracking enabled. Changes will be logged.");
    } else {
        stopFSAutoTracking();
        fsSnapshot = null;
        fsDiffCount = 0;
        announce("Filesystem change tracking disabled.");
    }
}
