"use strict";

/* ═══════════════════════════════════════════
 * Server Workspace — Client-side management
 * ═══════════════════════════════════════════
 *
 * When "Use server workspace" is checked, the game disk is a FAT16 HDD
 * image built on-the-fly by the Node.js server from files stored in
 * the workspace/ directory.  The user manages files through a dedicated
 * panel and can upload, delete, import from game images, and sync
 * changes back to the server after playing.
 */

/* ── State ── */
let workspaceAvailable = false;    /* true if the server supports workspace API */
let workspaceDiskBlob = null;      /* ArrayBuffer of the workspace disk.img for v86 */

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

    /* Show or hide the workspace option depending on server support */
    const wsOption = $("workspace-option");
    if (wsOption) {
        wsOption.style.display = workspaceAvailable ? "" : "none";
    }

    /* If workspace was previously enabled, refresh file list */
    if (workspaceAvailable && workspaceToggle && workspaceToggle.checked) {
        updateWorkspaceUI();
        refreshWorkspaceFiles();
    }
}

/* ── Toggle workspace mode ── */
function updateWorkspaceUI() {
    const enabled = workspaceToggle && workspaceToggle.checked;
    const wsSection = $("section-workspace");

    /* Show/hide the entire workspace details panel */
    if (wsSection) {
        wsSection.style.display = enabled ? "" : "none";
        if (enabled) wsSection.open = true;
    }

    /* When workspace is active, force disk type to HDD and disable game select */
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
    }
}

/* ── Refresh workspace file list ── */
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

/* ── Upload files to workspace ── */
async function uploadWorkspaceFiles(fileList) {
    const status = $("ws-status");
    if (!fileList || fileList.length === 0) return;

    if (status) status.textContent = "Uploading " + fileList.length + " file(s)...";

    const formData = new FormData();
    for (const f of fileList) {
        formData.append("files", f);
    }

    try {
        const resp = await fetch("/api/workspace/upload", {
            method: "POST",
            body: formData,
        });
        if (!resp.ok) throw new Error("Upload failed: " + resp.status);
        const data = await resp.json();
        if (status) status.textContent = "Uploaded " + data.uploaded.length + " file(s).";
    } catch (err) {
        if (status) status.textContent = "Upload error: " + err.message;
    }

    refreshWorkspaceFiles();
}

/* ── Import a game .img into workspace ── */
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

/* ── Import a custom uploaded .img into workspace ── */
async function importCustomImgToWorkspace(file) {
    const status = $("ws-status");
    if (status) status.textContent = "Importing files from " + file.name + "...";

    const formData = new FormData();
    formData.append("image", file);

    try {
        const resp = await fetch("/api/workspace/import", {
            method: "POST",
            body: formData,
        });
        if (!resp.ok) throw new Error("Import failed: " + resp.status);
        const data = await resp.json();
        if (status) status.textContent = "Imported " + data.imported + " file(s) from " + file.name + ".";
    } catch (err) {
        if (status) status.textContent = "Import error: " + err.message;
    }

    refreshWorkspaceFiles();
}

/* ── Clear workspace ── */
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

/* ── Fetch workspace disk image for v86 boot ── */
async function fetchWorkspaceDisk() {
    const resp = await fetch("/api/workspace/disk.img");
    if (!resp.ok) throw new Error("Failed to build workspace disk: " + resp.status);
    workspaceDiskBlob = await resp.arrayBuffer();
    return workspaceDiskBlob;
}

/* ── Sync current v86 disk image back to server workspace ── */
async function syncDiskToWorkspace() {
    if (!emulator) return;

    const status = $("ws-status");
    if (status) status.textContent = "Syncing disk back to workspace...";

    try {
        /* Get current disk image from v86 */
        const diskBytes = getDiskBytes();
        if (!diskBytes) throw new Error("Could not read disk from emulator");

        const formData = new FormData();
        const blob = new Blob([diskBytes], { type: "application/octet-stream" });
        formData.append("image", blob, "disk.img");

        const resp = await fetch("/api/workspace/sync", {
            method: "POST",
            body: formData,
        });
        if (!resp.ok) throw new Error("Sync failed: " + resp.status);
        const data = await resp.json();
        if (status) status.textContent = "Synced " + data.synced + " file(s) back to workspace.";
    } catch (err) {
        if (status) status.textContent = "Sync error: " + err.message;
    }

    refreshWorkspaceFiles();
}

/* ── Wire up workspace UI events ── */
function initWorkspaceEvents() {
    /* Toggle checkbox */
    if (workspaceToggle) {
        workspaceToggle.addEventListener("change", () => {
            updateWorkspaceUI();
            if (workspaceToggle.checked) refreshWorkspaceFiles();
            saveSettings();
        });
    }

    /* Upload button */
    const wsUploadBtn = $("ws-upload-btn");
    const wsUploadInput = $("ws-upload-input");
    if (wsUploadBtn && wsUploadInput) {
        wsUploadBtn.addEventListener("click", () => wsUploadInput.click());
        wsUploadInput.addEventListener("change", function() {
            if (this.files.length) uploadWorkspaceFiles(this.files);
            this.value = "";
        });
    }

    /* Import from game .img button */
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

    /* Import custom .img button */
    const wsImportCustomBtn = $("ws-import-custom-btn");
    const wsImportCustomInput = $("ws-import-custom-input");
    if (wsImportCustomBtn && wsImportCustomInput) {
        wsImportCustomBtn.addEventListener("click", () => wsImportCustomInput.click());
        wsImportCustomInput.addEventListener("change", function() {
            if (this.files.length) importCustomImgToWorkspace(this.files[0]);
            this.value = "";
        });
    }

    /* Refresh */
    const wsRefreshBtn = $("ws-refresh-btn");
    if (wsRefreshBtn) wsRefreshBtn.addEventListener("click", refreshWorkspaceFiles);

    /* Clear */
    const wsClearBtn = $("ws-clear-btn");
    if (wsClearBtn) wsClearBtn.addEventListener("click", clearWorkspace);

    /* Sync back from emulator */
    const wsSyncBtn = $("ws-sync-btn");
    if (wsSyncBtn) wsSyncBtn.addEventListener("click", syncDiskToWorkspace);
}

/* ── Initialize on page load ── */
detectWorkspace();
initWorkspaceEvents();
