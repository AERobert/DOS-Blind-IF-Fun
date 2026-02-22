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

import { state, gameSelect, diskTypeSelect, traceFSTrackToggle, traceVerboseToggle,
         traceToggleBtn, traceDownloadBtn, traceClearBtn, traceStatus } from './state.js';
import { announce } from './ui-helpers.js';
import { triggerDownload } from './ui-helpers.js';
import { getDiskBytes, parseFATGeometry, parseFATDir, readFATEntry, isEOF } from './fat.js';

/* ─── Filesystem snapshot state ─── */
let fsSnapshot = null;          /* { files: [{name,size,cluster},...], timestamp } */
let fsSnapshotTimer = null;     /* periodic auto-diff interval */
let fsDiffCount = 0;            /* number of diffs performed */
let lastFATGeometryStr = "";    /* dedup repeated FAT geometry logs */

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
let fileIOMarkerState = 0;      /* state machine position */
let fileIOMarkerBuf = "";       /* accumulates detected marker chars */
let fileIOMarkerTimer = null;   /* batch timer for reporting */

/** Add a timestamped entry to the trace log */
export function trace(category, message) {
    if (!state.traceEnabled) return;
    var elapsed = ((Date.now() - state.traceStartTime) / 1000).toFixed(3);
    state.traceLog.push("[" + elapsed + "s] [" + category + "] " + message);
}

/** Add a verbose-only entry (only logged when verbose trace-all is on) */
export function traceVerbose(category, message) {
    if (!state.traceEnabled || !state.verboseTrace) return;
    var elapsed = ((Date.now() - state.traceStartTime) / 1000).toFixed(3);
    state.traceLog.push("[" + elapsed + "s] [V:" + category + "] " + message);
}

/** Start tracing */
let traceUITimer = null;
export function startTrace() {
    state.traceEnabled = true;
    state.traceLog = [];
    state.traceStartTime = Date.now();
    lastFATGeometryStr = "";
    /* Sync verbose flag from checkbox */
    state.verboseTrace = traceVerboseToggle ? traceVerboseToggle.checked : false;
    trace("TRACE", "Tracing started" + (state.verboseTrace ? " (VERBOSE mode — all I/O, RAM, instructions)" : ""));
    trace("STATE", "isReady=" + state.isReady +
          " transcriptCapActive=" + state.transcriptCapActive +
          " textCapActive=" + state.textCapActive +
          " autoFlushPending=" + state.autoFlushPending +
          " keyMode=" + state.keyMode);
    if (state.emulator) {
        trace("STATE", "Emulator running, game=" + (gameSelect.value || "(custom)") +
              " diskType=" + diskTypeSelect.value);
        if (state.verboseTrace) {
            traceVerboseCPUState();
        }
    } else {
        trace("STATE", "Emulator not started");
    }
    /* Log current filesystem state on trace start */
    if (state.emulator && state.isReady) {
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
    /* Start verbose subsystems if enabled */
    if (state.verboseTrace) {
        startVerboseRAMTracking();
        startVerboseCPUTracking();
    }
}

/** Stop tracing */
export function stopTrace() {
    trace("TRACE", "Tracing stopped (" + state.traceLog.length + " entries)");
    state.traceEnabled = false;
    state.verboseTrace = false;
    clearInterval(traceUITimer);
    traceUITimer = null;
    stopFSAutoTracking();
    stopVerboseRAMTracking();
    stopVerboseCPUTracking();
    updateTraceUI();
}

/** Toggle tracing on/off */
export function toggleTrace() {
    if (state.traceEnabled) {
        stopTrace();
    } else {
        startTrace();
    }
}

/** Download the trace log as a text file */
export function downloadTrace() {
    if (state.traceLog.length === 0) {
        announce("No trace data to download.");
        return;
    }

    var header = [
        "═══════════════════════════════════════════",
        " DOS Adventure Player — Debug Trace",
        " Generated: " + new Date().toISOString(),
        " Entries: " + state.traceLog.length,
        " Game: " + (gameSelect.value || "(custom)"),
        " Disk Type: " + diskTypeSelect.value,
        " Verbose Mode: " + (traceVerboseToggle ? traceVerboseToggle.checked : "n/a"),
        " FS Tracking: " + (traceFSTrackToggle ? traceFSTrackToggle.checked : "n/a"),
        " FS Snapshots taken: " + fsDiffCount,
        " User Agent: " + navigator.userAgent,
        "═══════════════════════════════════════════",
        ""
    ].join("\n");

    var text = header + state.traceLog.join("\n") + "\n";
    triggerDownload(
        new Uint8Array(new TextEncoder().encode(text)),
        "emulator-trace-" + Date.now() + ".txt",
        "text/plain"
    );
    announce("Trace downloaded. " + state.traceLog.length + " entries.");
}

/** Clear the trace log */
export function clearTrace() {
    state.traceLog = [];
    lastFATGeometryStr = "";
    if (state.traceEnabled) {
        state.traceStartTime = Date.now();
        trace("TRACE", "Trace cleared and restarted");
    }
    updateTraceUI();
    announce("Trace log cleared.");
}

/** Update the trace UI status text */
export function updateTraceUI() {
    if (!traceToggleBtn) return;

    if (state.traceEnabled) {
        traceToggleBtn.textContent = "Stop Tracing";
        traceToggleBtn.className = "btn-danger btn-sm";
        traceStatus.textContent = "Tracing active — " + state.traceLog.length + " entries" +
            (state.verboseTrace ? " | VERBOSE" : "") +
            (fsSnapshot ? " | FS tracked (" + fsDiffCount + " diffs)" : "");
        traceStatus.style.color = "var(--error)";
    } else {
        traceToggleBtn.textContent = "Start Tracing";
        traceToggleBtn.className = "btn-secondary btn-sm";
        if (state.traceLog.length > 0) {
            traceStatus.textContent = state.traceLog.length + " entries captured (stopped)";
            traceStatus.style.color = "var(--text-secondary)";
        } else {
            traceStatus.textContent = "Idle";
            traceStatus.style.color = "var(--text-secondary)";
        }
    }

    traceDownloadBtn.style.display = state.traceLog.length > 0 ? "" : "none";
    traceClearBtn.style.display = state.traceLog.length > 0 ? "" : "none";
}

/* ═══════════════════════════════════════════
 * FAT trace deduplication
 * ═══════════════════════════════════════════
 *
 * readTranscriptFromDisk is called every poll cycle (0.5s-5s).
 * FAT geometry never changes, so we only log it once or when it differs.
 */

/** Log FAT geometry only if it changed since last log */
export function traceFATGeometry(geo) {
    if (!state.traceEnabled || !geo) return;
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

export function checkFileIOMarker(byte) {
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

let textPatternBuf = "";        /* accumulates recent printable chars */
let textPatternTimer = null;

let TEXT_PATTERNS = [
    { pattern: "transcript off",  label: "TRANSCRIPT_CLOSE", ci: true },
    { pattern: "script off",      label: "TRANSCRIPT_CLOSE", ci: true },
    { pattern: "saving",          label: "GAME_SAVE",        ci: true },
    { pattern: "restoring",       label: "GAME_RESTORE",     ci: true },
    { pattern: "loading",         label: "GAME_LOAD",        ci: true },
];

/** Feed printable text into the pattern detector */
export function traceTextPattern(text) {
    if (!state.traceEnabled) return;
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
export function takeFilesystemSnapshot() {
    if (!state.emulator || !state.isReady) return null;

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
export function traceCurrentFilesystem() {
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
export function takeSnapshotNow() {
    fsSnapshot = takeFilesystemSnapshot();
    fsDiffCount = 0;
    if (fsSnapshot) {
        trace("FS_SNAP", "Baseline snapshot taken: " + fsSnapshot.files.length + " files");
        if (state.traceEnabled) {
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
export function traceFSDiff(reason) {
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
export function startFSAutoTracking() {
    if (fsSnapshotTimer) return;
    if (!fsSnapshot) {
        takeSnapshotNow();
    }
    /* Auto-diff every 5 seconds */
    fsSnapshotTimer = setInterval(function() {
        if (state.traceEnabled) {
            traceFSDiff("periodic auto-check");
        }
    }, 5000);
    trace("FS_TRACK", "Auto-tracking started (diff every 5s)");
}

/** Stop periodic filesystem auto-tracking */
export function stopFSAutoTracking() {
    if (fsSnapshotTimer) {
        clearInterval(fsSnapshotTimer);
        fsSnapshotTimer = null;
    }
}

/** Toggle filesystem tracking */
export function toggleFSTracking() {
    if (!traceFSTrackToggle) return;
    if (traceFSTrackToggle.checked) {
        if (state.traceEnabled) {
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

/** Toggle verbose trace-all mode */
export function toggleVerboseTrace() {
    if (!traceVerboseToggle) return;
    state.verboseTrace = traceVerboseToggle.checked;
    if (state.traceEnabled) {
        if (state.verboseTrace) {
            trace("TRACE", "VERBOSE mode ENABLED — logging all I/O, RAM changes, CPU instructions");
            startVerboseRAMTracking();
            startVerboseCPUTracking();
            traceVerboseCPUState();
        } else {
            trace("TRACE", "VERBOSE mode DISABLED — returning to normal tracing");
            stopVerboseRAMTracking();
            stopVerboseCPUTracking();
        }
        updateTraceUI();
    }
    announce(state.verboseTrace
        ? "Verbose trace-all enabled. All I/O, RAM, and CPU activity will be logged."
        : "Verbose trace-all disabled.");
}

/* ═══════════════════════════════════════════
 * Verbose: Per-byte I/O port tracing
 * ═══════════════════════════════════════════
 *
 * In verbose mode, every serial byte and screen-put-char event is
 * logged individually with hex values — not batched.
 */

/** Log a single I/O port byte (called from emulator.js in verbose mode) */
export function traceVerboseIOByte(port, direction, byte) {
    if (!state.traceEnabled || !state.verboseTrace) return;
    var hex = "0x" + byte.toString(16).padStart(2, "0");
    var ch = (byte >= 0x20 && byte < 0x7F) ? " '" + String.fromCharCode(byte) + "'" : "";
    traceVerbose("IO", port + " " + direction + " " + hex + ch);
}

/** Log a screen character write (called from emulator.js in verbose mode) */
export function traceVerboseScreenChar(row, col, charCode) {
    if (!state.traceEnabled || !state.verboseTrace) return;
    var ch = (charCode >= 0x20 && charCode < 0x7F) ? " '" + String.fromCharCode(charCode) + "'" : "";
    traceVerbose("SCREEN", "put-char row=" + row + " col=" + col +
                 " code=0x" + charCode.toString(16).padStart(2, "0") + ch);
}

/* ═══════════════════════════════════════════
 * Verbose: FAT / Disk I/O tracing
 * ═══════════════════════════════════════════
 *
 * Logs every FAT-level read and write operation with byte offsets.
 */

/** Log a disk read operation with details */
export function traceVerboseDiskRead(operation, details) {
    if (!state.traceEnabled || !state.verboseTrace) return;
    traceVerbose("DISK_RD", operation + " — " + details);
}

/** Log a disk write operation with details */
export function traceVerboseDiskWrite(operation, details) {
    if (!state.traceEnabled || !state.verboseTrace) return;
    traceVerbose("DISK_WR", operation + " — " + details);
}

/* ═══════════════════════════════════════════
 * Verbose: RAM region tracking
 * ═══════════════════════════════════════════
 *
 * Takes periodic snapshots of key RAM regions and diffs them.
 * v86 doesn't expose per-access hooks, so we poll at intervals.
 *
 * Monitored regions (conventional DOS memory):
 *   0x00000-0x003FF  Interrupt Vector Table (IVT) — 1 KB
 *   0x00400-0x004FF  BIOS Data Area (BDA) — 256 bytes
 *   0x00500-0x005FF  DOS kernel variables — 256 bytes
 *   We also sample the top of conventional memory for stack changes.
 */

let ramTrackTimer = null;
let ramRegions = [
    { name: "IVT",   start: 0x00000, size: 0x400 },    /* Interrupt Vector Table */
    { name: "BDA",   start: 0x00400, size: 0x100 },    /* BIOS Data Area */
    { name: "DOS",   start: 0x00500, size: 0x100 },    /* DOS kernel vars */
];
let ramPrevSnapshots = {};  /* keyed by region name */

function readRAMRegion(start, size) {
    if (!state.emulator || !state.emulator.v86 || !state.emulator.v86.cpu) return null;
    try {
        var mem = state.emulator.v86.cpu.mem8;
        if (!mem || start + size > mem.length) return null;
        return new Uint8Array(mem.buffer, mem.byteOffset + start, size);
    } catch(e) {
        return null;
    }
}

function startVerboseRAMTracking() {
    if (ramTrackTimer) return;
    /* Take initial snapshots */
    for (var i = 0; i < ramRegions.length; i++) {
        var r = ramRegions[i];
        var data = readRAMRegion(r.start, r.size);
        if (data) {
            ramPrevSnapshots[r.name] = new Uint8Array(data);
            traceVerbose("RAM", "Baseline snapshot: " + r.name +
                         " [0x" + r.start.toString(16) + "-0x" + (r.start + r.size - 1).toString(16) + "]");
        }
    }
    /* Poll for changes every 500ms */
    ramTrackTimer = setInterval(ramDiffPoll, 500);
    traceVerbose("RAM", "RAM change tracking started (polling every 500ms)");
}

function stopVerboseRAMTracking() {
    if (ramTrackTimer) {
        clearInterval(ramTrackTimer);
        ramTrackTimer = null;
    }
    ramPrevSnapshots = {};
}

function ramDiffPoll() {
    if (!state.traceEnabled || !state.verboseTrace) return;
    for (var i = 0; i < ramRegions.length; i++) {
        var r = ramRegions[i];
        var current = readRAMRegion(r.start, r.size);
        if (!current) continue;
        var prev = ramPrevSnapshots[r.name];
        if (!prev) {
            ramPrevSnapshots[r.name] = new Uint8Array(current);
            continue;
        }
        /* Diff byte by byte, batch contiguous changes */
        var changes = [];
        var j = 0;
        while (j < r.size) {
            if (current[j] !== prev[j]) {
                var changeStart = j;
                var oldBytes = [];
                var newBytes = [];
                while (j < r.size && current[j] !== prev[j] && (j - changeStart) < 32) {
                    oldBytes.push(prev[j].toString(16).padStart(2, "0"));
                    newBytes.push(current[j].toString(16).padStart(2, "0"));
                    j++;
                }
                changes.push("@0x" + (r.start + changeStart).toString(16) +
                             " [" + oldBytes.join(" ") + "] -> [" + newBytes.join(" ") + "]");
            } else {
                j++;
            }
        }
        if (changes.length > 0) {
            traceVerbose("RAM", r.name + ": " + changes.length + " change(s):");
            for (var c = 0; c < changes.length; c++) {
                traceVerbose("RAM", "  " + changes[c]);
            }
        }
        ramPrevSnapshots[r.name] = new Uint8Array(current);
    }
}

/* ═══════════════════════════════════════════
 * Verbose: CPU instruction state tracking
 * ═══════════════════════════════════════════
 *
 * v86 doesn't expose per-instruction hooks, but we can read the
 * CPU register state periodically and log it, giving insight into
 * what the CPU is doing (instruction pointer, segment, flags, etc.).
 */

let cpuTrackTimer = null;
let lastEIP = -1;
let lastCS = -1;

/** Log the current CPU register state */
function traceVerboseCPUState() {
    if (!state.emulator || !state.emulator.v86 || !state.emulator.v86.cpu) return;
    try {
        var cpu = state.emulator.v86.cpu;
        var regs = {
            eip: cpu.instruction_pointer[0] >>> 0,
            cs:  cpu.sreg[1],       /* CS segment register */
            ds:  cpu.sreg[3],       /* DS */
            es:  cpu.sreg[0],       /* ES */
            ss:  cpu.sreg[2],       /* SS */
            eax: cpu.reg32[0] >>> 0,
            ecx: cpu.reg32[1] >>> 0,
            edx: cpu.reg32[2] >>> 0,
            ebx: cpu.reg32[3] >>> 0,
            esp: cpu.reg32[4] >>> 0,
            ebp: cpu.reg32[5] >>> 0,
            esi: cpu.reg32[6] >>> 0,
            edi: cpu.reg32[7] >>> 0,
            flags: cpu.flags[0] >>> 0,
        };
        traceVerbose("CPU", "EIP=0x" + regs.eip.toString(16).padStart(8, "0") +
                     " CS=0x" + regs.cs.toString(16).padStart(4, "0") +
                     " DS=0x" + regs.ds.toString(16).padStart(4, "0") +
                     " SS=0x" + regs.ss.toString(16).padStart(4, "0") +
                     " ESP=0x" + regs.esp.toString(16).padStart(8, "0"));
        traceVerbose("CPU", "EAX=0x" + regs.eax.toString(16).padStart(8, "0") +
                     " EBX=0x" + regs.ebx.toString(16).padStart(8, "0") +
                     " ECX=0x" + regs.ecx.toString(16).padStart(8, "0") +
                     " EDX=0x" + regs.edx.toString(16).padStart(8, "0"));
        traceVerbose("CPU", "ESI=0x" + regs.esi.toString(16).padStart(8, "0") +
                     " EDI=0x" + regs.edi.toString(16).padStart(8, "0") +
                     " EBP=0x" + regs.ebp.toString(16).padStart(8, "0") +
                     " FLAGS=0x" + regs.flags.toString(16).padStart(8, "0") +
                     decodeFlags(regs.flags));
        /* Decode the instruction bytes at EIP */
        decodeInstructionAtEIP(cpu, regs.eip);
    } catch(e) {
        traceVerbose("CPU", "Could not read CPU state: " + e.message);
    }
}

/** Decode x86 flags register into readable flag names */
function decodeFlags(flags) {
    var names = [];
    if (flags & 0x0001) names.push("CF");
    if (flags & 0x0004) names.push("PF");
    if (flags & 0x0010) names.push("AF");
    if (flags & 0x0040) names.push("ZF");
    if (flags & 0x0080) names.push("SF");
    if (flags & 0x0100) names.push("TF");
    if (flags & 0x0200) names.push("IF");
    if (flags & 0x0400) names.push("DF");
    if (flags & 0x0800) names.push("OF");
    return names.length > 0 ? " [" + names.join(" ") + "]" : "";
}

/** Read and log instruction bytes at the current EIP */
function decodeInstructionAtEIP(cpu, eip) {
    try {
        var mem = cpu.mem8;
        if (!mem) return;
        /* Read up to 16 bytes at EIP for instruction display */
        var bytes = [];
        var len = Math.min(16, mem.length - eip);
        if (len <= 0) return;
        for (var i = 0; i < len; i++) {
            bytes.push(mem[eip + i].toString(16).padStart(2, "0"));
        }
        var decoded = decodeX86Prefix(mem, eip, len);
        traceVerbose("CPU", "  @0x" + eip.toString(16) + ": " + bytes.join(" ") +
                     (decoded ? "  ; " + decoded : ""));
    } catch(e) { /* ignore decode errors */ }
}

/**
 * Basic x86 instruction decoder — decodes common DOS opcodes.
 * Not a full disassembler, but covers the most frequent instructions
 * to give meaningful trace output for understanding program flow.
 */
function decodeX86Prefix(mem, eip, maxLen) {
    if (maxLen < 1) return "";
    var op = mem[eip];
    switch (op) {
        case 0x90: return "NOP";
        case 0xCC: return "INT 3 (breakpoint)";
        case 0xCD:
            if (maxLen >= 2) {
                var intNum = mem[eip + 1];
                var intName = {
                    0x10: "INT 10h (BIOS Video)",
                    0x13: "INT 13h (BIOS Disk)",
                    0x16: "INT 16h (BIOS Keyboard)",
                    0x1A: "INT 1Ah (BIOS Timer)",
                    0x20: "INT 20h (DOS Terminate)",
                    0x21: "INT 21h (DOS Services)",
                    0x2F: "INT 2Fh (DOS Multiplex)",
                    0x33: "INT 33h (Mouse)",
                }[intNum];
                return intName || "INT 0x" + intNum.toString(16);
            }
            return "INT ??";
        case 0xCF: return "IRET";
        case 0xC3: return "RET (near)";
        case 0xCB: return "RETF (far)";
        case 0xE8: return "CALL near";
        case 0x9A: return "CALL far";
        case 0xE9: return "JMP near";
        case 0xEB: return "JMP short";
        case 0xEA: return "JMP far";
        case 0xFA: return "CLI (disable interrupts)";
        case 0xFB: return "STI (enable interrupts)";
        case 0xFC: return "CLD (clear direction flag)";
        case 0xFD: return "STD (set direction flag)";
        case 0xF4: return "HLT";
        case 0xE4: return maxLen >= 2 ? "IN AL, 0x" + mem[eip + 1].toString(16) : "IN AL, imm8";
        case 0xE5: return maxLen >= 2 ? "IN AX, 0x" + mem[eip + 1].toString(16) : "IN AX, imm8";
        case 0xE6: return maxLen >= 2 ? "OUT 0x" + mem[eip + 1].toString(16) + ", AL" : "OUT imm8, AL";
        case 0xE7: return maxLen >= 2 ? "OUT 0x" + mem[eip + 1].toString(16) + ", AX" : "OUT imm8, AX";
        case 0xEC: return "IN AL, DX (port I/O)";
        case 0xED: return "IN AX, DX (port I/O)";
        case 0xEE: return "OUT DX, AL (port I/O)";
        case 0xEF: return "OUT DX, AX (port I/O)";
        case 0xA4: return "MOVSB (memory copy byte)";
        case 0xA5: return "MOVSW (memory copy word)";
        case 0xAA: return "STOSB (store byte to [ES:DI])";
        case 0xAB: return "STOSW (store word to [ES:DI])";
        case 0xAC: return "LODSB (load byte from [DS:SI])";
        case 0xAD: return "LODSW (load word from [DS:SI])";
        case 0xF3: return "REP prefix";
        case 0xF2: return "REPNZ prefix";
        default:
            if (op >= 0x50 && op <= 0x57) return "PUSH " + ["EAX","ECX","EDX","EBX","ESP","EBP","ESI","EDI"][op - 0x50];
            if (op >= 0x58 && op <= 0x5F) return "POP " + ["EAX","ECX","EDX","EBX","ESP","EBP","ESI","EDI"][op - 0x58];
            if (op >= 0xB0 && op <= 0xB7) return "MOV " + ["AL","CL","DL","BL","AH","CH","DH","BH"][op - 0xB0] + ", imm8";
            if (op >= 0xB8 && op <= 0xBF) return "MOV " + ["EAX","ECX","EDX","EBX","ESP","EBP","ESI","EDI"][op - 0xB8] + ", imm32";
            if (op >= 0x70 && op <= 0x7F) {
                var jccNames = ["JO","JNO","JB","JNB","JZ","JNZ","JBE","JA","JS","JNS","JP","JNP","JL","JGE","JLE","JG"];
                return jccNames[op - 0x70] + " short";
            }
            return "";
    }
}

/** Start periodic CPU state logging */
function startVerboseCPUTracking() {
    if (cpuTrackTimer) return;
    lastEIP = -1;
    lastCS = -1;
    /* Log CPU state every 250ms */
    cpuTrackTimer = setInterval(function() {
        if (!state.traceEnabled || !state.verboseTrace) return;
        if (!state.emulator || !state.emulator.v86 || !state.emulator.v86.cpu) return;
        try {
            var cpu = state.emulator.v86.cpu;
            var eip = cpu.instruction_pointer[0] >>> 0;
            var cs = cpu.sreg[1];
            /* Only log when EIP has changed significantly (different instruction region) */
            if (eip !== lastEIP || cs !== lastCS) {
                lastEIP = eip;
                lastCS = cs;
                traceVerboseCPUState();
            }
        } catch(e) {}
    }, 250);
    traceVerbose("CPU", "CPU instruction tracking started (sampling every 250ms)");
}

function stopVerboseCPUTracking() {
    if (cpuTrackTimer) {
        clearInterval(cpuTrackTimer);
        cpuTrackTimer = null;
    }
    lastEIP = -1;
    lastCS = -1;
}
