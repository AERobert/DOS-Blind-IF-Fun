"use strict";

/* ═══════════════════════════════════════════
 * Server Workspace — Live bidirectional sync
 * ═══════════════════════════════════════════
 *
 * When "Use server workspace" is checked:
 *
 *  1. Boot builds a FAT16 HDD from workspace/files/ on the server.
 *  2. Emulator → Server: every few seconds (and after each command),
 *     the browser fingerprints the FAT table + root directory.  If
 *     anything changed it pushes the full disk image to the server,
 *     which extracts individual files to workspace/files/.
 *  3. Server → Emulator: the browser polls for external changes
 *     (user editing files on disk).  When detected it pulls a fresh
 *     disk image and hot-swaps it into v86.
 *
 * The result: workspace/files/ on the server always mirrors the
 * emulator's C: drive, and vice versa.
 */

/* ── State ── */
let workspaceAvailable = false;
let workspaceDiskBlob  = null;   /* ArrayBuffer loaded at boot */

/* Live-sync state */
let wsSyncTimer        = null;   /* setInterval handle */
let wsPollTimer        = null;   /* server-change polling handle */
let wsLastFingerprint  = null;   /* hash of FAT + root-dir sectors */
let wsSyncing          = false;  /* guard against concurrent syncs */
let wsCommandSyncTimer = null;   /* debounced post-command sync */

/* ── Detect server workspace support on page load ── */
async function detectWorkspace() {
    try {
        const resp = await fetch("/api/workspace/status");
        if (resp.ok) {
            const data = await resp.json();
            workspaceAvailable = !!data.available;
        }
    } catch (e) {
        workspaceAvailable = false;
    }

    const wsOption = $("workspace-option");
    if (wsOption) wsOption.style.display = workspaceAvailable ? "" : "none";

    if (workspaceAvailable && workspaceToggle && workspaceToggle.checked) {
        updateWorkspaceUI();
        refreshWorkspaceFiles();
    }
}

/* ═══════════════════════════════════════════
 * UI Toggle
 * ═══════════════════════════════════════════ */

function updateWorkspaceUI() {
    const enabled = workspaceToggle && workspaceToggle.checked;
    const wsSection = $("section-workspace");

    if (wsSection) {
        wsSection.style.display = enabled ? "" : "none";
        if (enabled) wsSection.open = true;
    }

    if (enabled) {
        diskTypeSelect.value = "hdd";
        diskTypeSelect.disabled = true;
        gameSelect.disabled = true;
        loadCustomImgBtn.disabled = true;
    } else {
        diskTypeSelect.disabled = false;
        gameSelect.disabled = false;
        loadCustomImgBtn.disabled = false;
        workspaceDiskBlob = null;
        stopLiveSync();
    }
}

/* ═══════════════════════════════════════════
 * Workspace file list (management panel)
 * ═══════════════════════════════════════════ */

async function refreshWorkspaceFiles() {
    const tbody = $("ws-tbody");
    const status = $("ws-status");
    const table = $("ws-table");
    if (!tbody || !status || !table) return;

    status.textContent = "Loading workspace files...";
    table.style.display = "none";
    tbody.innerHTML = "";

    try {
        const resp = await fetch("/api/workspace/files");
        if (!resp.ok) throw new Error("Server returned " + resp.status);
        const data = await resp.json();

        if (data.files.length === 0) {
            status.textContent = "Workspace is empty. Upload files or import from a game image.";
            return;
        }

        status.textContent = data.files.length + " file(s) in workspace.";
        table.style.display = "";

        for (const f of data.files) {
            const tr = document.createElement("tr");

            const tdName = document.createElement("td");
            tdName.textContent = f.name;
            tr.appendChild(tdName);

            const tdSize = document.createElement("td");
            tdSize.textContent = formatSize(f.size);
            tr.appendChild(tdSize);

            const tdAct = document.createElement("td");

            const dlBtn = document.createElement("button");
            dlBtn.className = "btn-secondary btn-sm";
            dlBtn.textContent = "Download";
            dlBtn.addEventListener("click", () => {
                window.location.href = "/api/workspace/files/" +
                    encodeURIComponent(f.name) + "/download";
            });
            tdAct.appendChild(dlBtn);

            const delBtn = document.createElement("button");
            delBtn.className = "btn-danger btn-sm";
            delBtn.textContent = "Delete";
            delBtn.style.marginLeft = "0.3rem";
            delBtn.addEventListener("click", async () => {
                if (!confirm("Delete " + f.name + " from workspace?")) return;
                try {
                    await fetch("/api/workspace/files/" + encodeURIComponent(f.name), {
                        method: "DELETE",
                    });
                } catch (e) {}
                refreshWorkspaceFiles();
            });
            tdAct.appendChild(delBtn);

            tr.appendChild(tdAct);
            tbody.appendChild(tr);
        }
    } catch (err) {
        status.textContent = "Error loading workspace: " + err.message;
    }
}

/* ═══════════════════════════════════════════
 * Upload / Import / Clear (pre-boot management)
 * ═══════════════════════════════════════════ */

async function uploadWorkspaceFiles(fileList) {
    const status = $("ws-status");
    if (!fileList || fileList.length === 0) return;
    if (status) status.textContent = "Uploading " + fileList.length + " file(s)...";

    const formData = new FormData();
    for (const f of fileList) formData.append("files", f);

    try {
        const resp = await fetch("/api/workspace/upload", { method: "POST", body: formData });
        if (!resp.ok) throw new Error("Upload failed: " + resp.status);
        const data = await resp.json();
        if (status) status.textContent = "Uploaded " + data.uploaded.length + " file(s).";
    } catch (err) {
        if (status) status.textContent = "Upload error: " + err.message;
    }
    refreshWorkspaceFiles();
}

async function importGameToWorkspace(filename) {
    const status = $("ws-status");
    if (status) status.textContent = "Importing files from " + filename + "...";
    try {
        const resp = await fetch("/api/workspace/import-server-img", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename }),
        });
        if (!resp.ok) throw new Error("Import failed: " + resp.status);
        const data = await resp.json();
        if (status) status.textContent = "Imported " + data.imported + " file(s) from " + data.from + ".";
    } catch (err) {
        if (status) status.textContent = "Import error: " + err.message;
    }
    refreshWorkspaceFiles();
}

async function importCustomImgToWorkspace(file) {
    const status = $("ws-status");
    if (status) status.textContent = "Importing files from " + file.name + "...";
    const formData = new FormData();
    formData.append("image", file);
    try {
        const resp = await fetch("/api/workspace/import", { method: "POST", body: formData });
        if (!resp.ok) throw new Error("Import failed: " + resp.status);
        const data = await resp.json();
        if (status) status.textContent = "Imported " + data.imported + " file(s) from " + file.name + ".";
    } catch (err) {
        if (status) status.textContent = "Import error: " + err.message;
    }
    refreshWorkspaceFiles();
}

async function clearWorkspace() {
    if (!confirm("Delete ALL files from the workspace?")) return;
    const status = $("ws-status");
    try {
        await fetch("/api/workspace/clear", { method: "DELETE" });
        if (status) status.textContent = "Workspace cleared.";
    } catch (err) {
        if (status) status.textContent = "Error: " + err.message;
    }
    refreshWorkspaceFiles();
}

/* ═══════════════════════════════════════════
 * Boot: fetch workspace disk image
 * ═══════════════════════════════════════════ */

async function fetchWorkspaceDisk() {
    const resp = await fetch("/api/workspace/disk.img");
    if (!resp.ok) throw new Error("Failed to build workspace disk: " + resp.status);
    workspaceDiskBlob = await resp.arrayBuffer();
    return workspaceDiskBlob;
}

/* ═══════════════════════════════════════════
 * LIVE SYNC: Emulator → Server
 * ═══════════════════════════════════════════
 *
 * Every few seconds (and shortly after each command) we fingerprint
 * the FAT table and root directory of the v86 disk.  If the
 * fingerprint changed we push the full disk image to the server.
 *
 * On localhost 32 MB transfers in ~100 ms so this is fine.
 */

/** Compute a fast hash of the FAT + root directory sectors. */
function diskFingerprint() {
    const disk = getDiskBytes();
    if (!disk) return null;
    const geo = parseFATGeometry(disk);
    if (!geo) return null;

    let h = 0x811c9dc5; /* FNV-1a offset basis */
    const fatEnd = geo.fatStart + geo.sectorsPerFAT * geo.bytesPerSector;
    for (let i = geo.fatStart; i < fatEnd; i++) {
        h ^= disk[i]; h = Math.imul(h, 0x01000193);
    }
    const rdEnd = geo.rootDirStart + geo.rootDirEntries * 32;
    for (let i = geo.rootDirStart; i < rdEnd; i++) {
        h ^= disk[i]; h = Math.imul(h, 0x01000193);
    }
    return h;
}

/** Push the current v86 disk to the server for extraction. */
async function pushDiskToServer() {
    if (wsSyncing) return;
    wsSyncing = true;

    const syncInd = $("ws-sync-indicator");
    if (syncInd) syncInd.textContent = "syncing...";

    try {
        const diskBytes = getDiskBytes();
        if (!diskBytes) return;

        const formData = new FormData();
        formData.append("image", new Blob([diskBytes], { type: "application/octet-stream" }), "disk.img");

        const resp = await fetch("/api/workspace/live-sync", { method: "POST", body: formData });
        if (!resp.ok) throw new Error(resp.status);
        const data = await resp.json();

        wsLastFingerprint = diskFingerprint();

        if (syncInd) {
            if (data.changed && data.changed.length > 0) {
                syncInd.textContent = "synced " + data.changed.length + " file(s) just now";
            } else {
                syncInd.textContent = "in sync";
            }
        }

        /* Refresh file list if panel is open */
        const wsSection = $("section-workspace");
        if (wsSection && wsSection.open) refreshWorkspaceFiles();

    } catch (err) {
        if (syncInd) syncInd.textContent = "sync error: " + err.message;
    } finally {
        wsSyncing = false;
    }
}

/** Periodic sync tick: fingerprint and push if changed. */
function syncTick() {
    if (!emulator || !isReady) return;
    if (wsSyncing) return;

    const fp = diskFingerprint();
    if (fp !== null && fp !== wsLastFingerprint) {
        pushDiskToServer();
    }
}

/**
 * Schedule a sync shortly after a command is sent to DOS.
 * This gives DOS time to write files before we read the disk.
 */
function schedulePostCommandSync() {
    if (!workspaceToggle || !workspaceToggle.checked || !workspaceAvailable) return;
    if (wsCommandSyncTimer) clearTimeout(wsCommandSyncTimer);
    wsCommandSyncTimer = setTimeout(() => {
        wsCommandSyncTimer = null;
        pushDiskToServer();
    }, 2000);
}

/* ═══════════════════════════════════════════
 * LIVE SYNC: Server → Emulator
 * ═══════════════════════════════════════════
 *
 * Poll the server for external file changes.  When detected, pull
 * a fresh disk image and hot-swap it into v86.
 */

async function pollServerChanges() {
    if (!emulator || !isReady) return;
    if (wsSyncing) return;

    try {
        const resp = await fetch("/api/workspace/changes");
        if (!resp.ok) return;
        const data = await resp.json();

        if (!data.hasChanges) return;

        const syncInd = $("ws-sync-indicator");
        const names = data.changes.map(c => c.name).join(", ");

        /* Auto-pull: get the rebuilt disk image and swap it in */
        if (syncInd) syncInd.textContent = "pulling server changes...";

        const pullResp = await fetch("/api/workspace/pull", { method: "POST" });
        if (!pullResp.ok) return;

        const newImg = new Uint8Array(await pullResp.arrayBuffer());
        const ok = await replaceDiskImage(newImg);

        if (ok) {
            wsLastFingerprint = diskFingerprint();
            if (syncInd) syncInd.textContent = "pulled: " + names;
            const wsSection = $("section-workspace");
            if (wsSection && wsSection.open) refreshWorkspaceFiles();
        } else {
            if (syncInd) syncInd.textContent = "pull failed (disk busy?)";
        }
    } catch (err) {
        /* Silently ignore polling errors */
    }
}

/* ═══════════════════════════════════════════
 * Start / Stop live sync
 * ═══════════════════════════════════════════ */

function startLiveSync() {
    stopLiveSync();

    /* Take initial fingerprint */
    wsLastFingerprint = diskFingerprint();

    /* Emulator → Server: check every 3 seconds */
    wsSyncTimer = setInterval(syncTick, 3000);

    /* Server → Emulator: poll every 4 seconds (offset from sync) */
    wsPollTimer = setInterval(pollServerChanges, 4000);

    /* Do an initial push so the server has the boot state */
    setTimeout(() => pushDiskToServer(), 1500);

    const syncInd = $("ws-sync-indicator");
    if (syncInd) syncInd.textContent = "live sync active";

    const wsSyncBtn = $("ws-sync-btn");
    if (wsSyncBtn) wsSyncBtn.disabled = false;
}

function stopLiveSync() {
    if (wsSyncTimer) { clearInterval(wsSyncTimer); wsSyncTimer = null; }
    if (wsPollTimer) { clearInterval(wsPollTimer); wsPollTimer = null; }
    if (wsCommandSyncTimer) { clearTimeout(wsCommandSyncTimer); wsCommandSyncTimer = null; }

    const syncInd = $("ws-sync-indicator");
    if (syncInd) syncInd.textContent = "";
}

/* ═══════════════════════════════════════════
 * Manual sync (button)
 * ═══════════════════════════════════════════ */

async function syncDiskToWorkspace() {
    await pushDiskToServer();
    refreshWorkspaceFiles();
}

/* ═══════════════════════════════════════════
 * Wire up UI events
 * ═══════════════════════════════════════════ */

function initWorkspaceEvents() {
    if (workspaceToggle) {
        workspaceToggle.addEventListener("change", () => {
            updateWorkspaceUI();
            if (workspaceToggle.checked) refreshWorkspaceFiles();
            saveSettings();
        });
    }

    const wsUploadBtn = $("ws-upload-btn");
    const wsUploadInput = $("ws-upload-input");
    if (wsUploadBtn && wsUploadInput) {
        wsUploadBtn.addEventListener("click", () => wsUploadInput.click());
        wsUploadInput.addEventListener("change", function() {
            if (this.files.length) uploadWorkspaceFiles(this.files);
            this.value = "";
        });
    }

    const wsImportBtn = $("ws-import-btn");
    if (wsImportBtn) {
        wsImportBtn.addEventListener("click", () => {
            const filename = gameSelect.value;
            if (filename) {
                importGameToWorkspace(filename);
            } else {
                const s = $("ws-status");
                if (s) s.textContent = "Select a game image first (above), then click Import.";
            }
        });
    }

    const wsImportCustomBtn = $("ws-import-custom-btn");
    const wsImportCustomInput = $("ws-import-custom-input");
    if (wsImportCustomBtn && wsImportCustomInput) {
        wsImportCustomBtn.addEventListener("click", () => wsImportCustomInput.click());
        wsImportCustomInput.addEventListener("change", function() {
            if (this.files.length) importCustomImgToWorkspace(this.files[0]);
            this.value = "";
        });
    }

    const wsRefreshBtn = $("ws-refresh-btn");
    if (wsRefreshBtn) wsRefreshBtn.addEventListener("click", refreshWorkspaceFiles);

    const wsClearBtn = $("ws-clear-btn");
    if (wsClearBtn) wsClearBtn.addEventListener("click", clearWorkspace);

    const wsSyncBtn = $("ws-sync-btn");
    if (wsSyncBtn) wsSyncBtn.addEventListener("click", syncDiskToWorkspace);
}

/* ── Initialize on page load ── */
detectWorkspace();
initWorkspaceEvents();
