"use strict";

/**
 * Accessible DOS Text Adventure Player — Node.js Server
 *
 * Replaces the simple Python HTTP server with Express, adding:
 *  - Static file serving (same as before)
 *  - Workspace API: server-side file management for the DOS C: drive
 *
 * Usage:
 *   node server.js              # start on default port 8000
 *   PORT=3000 node server.js    # custom port
 */

const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

const fat = require("./lib/fat-builder");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 8000;

/* ── Workspace directory ── */
const WORKSPACE_DIR = path.join(__dirname, "workspace");
const WORKSPACE_FILES = path.join(WORKSPACE_DIR, "files");

/* Ensure workspace directories exist */
fs.mkdirSync(WORKSPACE_FILES, { recursive: true });

/* ── Multer configuration for file uploads ── */
const upload = multer({
    dest: path.join(WORKSPACE_DIR, ".uploads"),
    limits: { fileSize: 64 * 1024 * 1024 }, /* 64 MB per file */
});

/* ── Middleware ── */
app.use(express.json());

/* ── Static files (serve the same files Python was serving) ── */
app.use(express.static(__dirname, {
    index: "index.html",
    /* Set appropriate MIME types for v86 files */
    setHeaders(res, filePath) {
        if (filePath.endsWith(".wasm")) {
            res.setHeader("Content-Type", "application/wasm");
        }
    },
}));

/* ═══════════════════════════════════════════════════════
 * Workspace API
 * ═══════════════════════════════════════════════════════ */

/**
 * GET /api/workspace/files
 * List all files in the workspace.
 */
app.get("/api/workspace/files", (req, res) => {
    try {
        if (!fs.existsSync(WORKSPACE_FILES)) {
            return res.json({ files: [] });
        }
        const entries = fs.readdirSync(WORKSPACE_FILES);
        const files = [];
        for (const name of entries) {
            const fullPath = path.join(WORKSPACE_FILES, name);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isFile()) {
                    files.push({
                        name,
                        size: stat.size,
                        modified: stat.mtime.toISOString(),
                    });
                }
            } catch (e) { /* skip unreadable files */ }
        }
        res.json({ files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/workspace/upload
 * Upload one or more files to the workspace.
 */
app.post("/api/workspace/upload", upload.array("files", 50), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files provided" });
        }

        fs.mkdirSync(WORKSPACE_FILES, { recursive: true });
        const results = [];

        for (const file of req.files) {
            /* Sanitize filename: keep only safe DOS-compatible characters */
            let safeName = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, "_");
            if (!safeName) safeName = "UNNAMED";

            const dest = path.join(WORKSPACE_FILES, safeName);
            fs.renameSync(file.path, dest);
            results.push({ name: safeName, size: file.size });
        }

        res.json({ uploaded: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/workspace/files/:name
 * Delete a file from the workspace.
 */
app.delete("/api/workspace/files/:name", (req, res) => {
    try {
        const safeName = path.basename(req.params.name);
        const filePath = path.join(WORKSPACE_FILES, safeName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "File not found" });
        }

        fs.unlinkSync(filePath);
        res.json({ deleted: safeName });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/workspace/files/:name/download
 * Download a single file from the workspace.
 */
app.get("/api/workspace/files/:name/download", (req, res) => {
    const safeName = path.basename(req.params.name);
    const filePath = path.join(WORKSPACE_FILES, safeName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    res.download(filePath, safeName);
});

/**
 * GET /api/workspace/disk.img
 * Build a FAT16 hard disk image from all workspace files and serve it.
 * Query params:
 *   ?size=32  - image size in MB (default 32, max 512)
 */
app.get("/api/workspace/disk.img", (req, res) => {
    try {
        let sizeMB = parseInt(req.query.size, 10) || 32;
        sizeMB = Math.max(4, Math.min(512, sizeMB));

        const img = fat.buildImageFromDirectory(WORKSPACE_FILES, sizeMB);

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", "inline; filename=workspace.img");
        res.setHeader("Content-Length", img.length);
        res.send(img);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/workspace/import
 * Import files from an uploaded .img disk image into the workspace.
 * Extracts all files from the FAT filesystem and places them in workspace/files/.
 */
app.post("/api/workspace/import", upload.single("image"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file provided" });
        }

        const imgData = fs.readFileSync(req.file.path);
        fs.unlinkSync(req.file.path); /* clean up temp upload */

        fs.mkdirSync(WORKSPACE_FILES, { recursive: true });
        const count = fat.extractImageToDirectory(imgData, WORKSPACE_FILES);

        res.json({ imported: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/workspace/import-server-img
 * Import files from one of the game .img files already on the server.
 * Body: { "filename": "tzero-data.img" }
 */
app.post("/api/workspace/import-server-img", (req, res) => {
    try {
        const filename = req.body && req.body.filename;
        if (!filename) {
            return res.status(400).json({ error: "No filename provided" });
        }

        /* Only allow .img files from the project root (no path traversal) */
        const safeName = path.basename(filename);
        if (!safeName.endsWith(".img")) {
            return res.status(400).json({ error: "Only .img files allowed" });
        }

        const imgPath = path.join(__dirname, safeName);
        if (!fs.existsSync(imgPath)) {
            return res.status(404).json({ error: "Image file not found: " + safeName });
        }

        const imgData = fs.readFileSync(imgPath);
        fs.mkdirSync(WORKSPACE_FILES, { recursive: true });
        const count = fat.extractImageToDirectory(imgData, WORKSPACE_FILES);

        res.json({ imported: count, from: safeName });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/workspace/sync
 * Receive a disk image from the browser and extract changed files back to workspace.
 * The browser sends the current v86 disk image after the user plays.
 */
app.post("/api/workspace/sync", upload.single("image"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file provided" });
        }

        const imgData = fs.readFileSync(req.file.path);
        fs.unlinkSync(req.file.path);

        fs.mkdirSync(WORKSPACE_FILES, { recursive: true });
        const count = fat.extractImageToDirectory(imgData, WORKSPACE_FILES);

        res.json({ synced: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/workspace/clear
 * Remove all files from the workspace.
 */
app.delete("/api/workspace/clear", (req, res) => {
    try {
        if (fs.existsSync(WORKSPACE_FILES)) {
            const entries = fs.readdirSync(WORKSPACE_FILES);
            for (const name of entries) {
                const filePath = path.join(WORKSPACE_FILES, name);
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
        }
        res.json({ cleared: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/workspace/status
 * Check if the server supports workspace features.
 * The browser uses this to detect whether to show the workspace UI.
 */
app.get("/api/workspace/status", (req, res) => {
    let totalSize = 0;
    let fileCount = 0;
    try {
        if (fs.existsSync(WORKSPACE_FILES)) {
            const entries = fs.readdirSync(WORKSPACE_FILES);
            for (const name of entries) {
                try {
                    const stat = fs.statSync(path.join(WORKSPACE_FILES, name));
                    if (stat.isFile()) { fileCount++; totalSize += stat.size; }
                } catch (e) {}
            }
        }
    } catch (e) {}

    res.json({
        available: true,
        fileCount,
        totalSize,
        workspacePath: WORKSPACE_FILES,
    });
});

/* ═══════════════════════════════════════════════════════
 * Live Sync API — bidirectional file sync between
 * the v86 emulator disk and workspace/files/
 * ═══════════════════════════════════════════════════════ */

/* Track the last-known state of workspace files for change detection */
let lastKnownFileState = {};   /* { filename: { size, mtimeMs } } */
let lastSyncTimestamp = 0;

function snapshotFileState() {
    const state = {};
    try {
        if (!fs.existsSync(WORKSPACE_FILES)) return state;
        for (const name of fs.readdirSync(WORKSPACE_FILES)) {
            try {
                const stat = fs.statSync(path.join(WORKSPACE_FILES, name));
                if (stat.isFile()) {
                    state[name] = { size: stat.size, mtimeMs: stat.mtimeMs };
                }
            } catch (e) {}
        }
    } catch (e) {}
    return state;
}

/* Take initial snapshot */
lastKnownFileState = snapshotFileState();
lastSyncTimestamp = Date.now();

/**
 * POST /api/workspace/live-sync
 * Receive the full disk image from the browser, extract ALL files
 * (including open ones with size=0), and save to workspace/files/.
 * Also saves the raw disk image for debugging.
 * Returns the list of files that changed.
 */
app.post("/api/workspace/live-sync", upload.single("image"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image data" });
        }

        const imgData = fs.readFileSync(req.file.path);
        fs.unlinkSync(req.file.path);

        /* Save the raw disk image for direct access */
        const diskImgPath = path.join(WORKSPACE_DIR, "disk.img");
        fs.writeFileSync(diskImgPath, imgData);

        /* Extract all files (handles open files via cluster-chain following) */
        fs.mkdirSync(WORKSPACE_FILES, { recursive: true });
        const extracted = fat.extractFilesFromImage(imgData);
        const changed = [];

        /* Write extracted files, tracking what actually changed */
        for (const f of extracted) {
            const filePath = path.join(WORKSPACE_FILES, f.name);
            let needWrite = true;
            try {
                if (fs.existsSync(filePath)) {
                    const existing = fs.readFileSync(filePath);
                    if (existing.length === f.data.length && existing.equals(f.data)) {
                        needWrite = false;
                    }
                }
            } catch (e) {}

            if (needWrite) {
                fs.writeFileSync(filePath, f.data);
                changed.push(f.name);
            }
        }

        /* Remove files that no longer exist in the image */
        const extractedNames = new Set(extracted.map(f => f.name));
        try {
            for (const name of fs.readdirSync(WORKSPACE_FILES)) {
                if (!extractedNames.has(name)) {
                    try { fs.unlinkSync(path.join(WORKSPACE_FILES, name)); } catch (e) {}
                    changed.push("-" + name);
                }
            }
        } catch (e) {}

        /* Update snapshot */
        lastKnownFileState = snapshotFileState();
        lastSyncTimestamp = Date.now();

        res.json({ total: extracted.length, changed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/workspace/changes
 * Check if any files in workspace/files/ have been modified externally
 * (e.g. by the user editing them directly on the filesystem).
 * Returns the list of changed/new/deleted files since last sync.
 */
app.get("/api/workspace/changes", (req, res) => {
    try {
        const current = snapshotFileState();
        const changes = [];

        /* Check for new or modified files */
        for (const [name, info] of Object.entries(current)) {
            const prev = lastKnownFileState[name];
            if (!prev) {
                changes.push({ name, type: "added" });
            } else if (prev.size !== info.size || prev.mtimeMs !== info.mtimeMs) {
                changes.push({ name, type: "modified" });
            }
        }

        /* Check for deleted files */
        for (const name of Object.keys(lastKnownFileState)) {
            if (!current[name]) {
                changes.push({ name, type: "deleted" });
            }
        }

        res.json({
            hasChanges: changes.length > 0,
            changes,
            lastSync: lastSyncTimestamp,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/workspace/pull
 * Acknowledge external changes and rebuild the disk image.
 * The browser calls this when it wants to pull server-side changes
 * into the emulator.
 * Returns the new disk image as binary.
 */
app.post("/api/workspace/pull", (req, res) => {
    try {
        /* Update our snapshot so we stop reporting these as changes */
        lastKnownFileState = snapshotFileState();
        lastSyncTimestamp = Date.now();

        /* Build a fresh image from the workspace files */
        let sizeMB = 32;
        const img = fat.buildImageFromDirectory(WORKSPACE_FILES, sizeMB);

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", img.length);
        res.send(img);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ── Start server ── */
app.listen(PORT, () => {
    console.log("=============================================");
    console.log("  Accessible DOS Text Adventure Player");
    console.log("=============================================");
    console.log("");
    console.log("Server running at http://localhost:" + PORT);
    console.log("Workspace directory: " + WORKSPACE_FILES);
    console.log("");
    console.log("Press Ctrl+C to stop.");
});
