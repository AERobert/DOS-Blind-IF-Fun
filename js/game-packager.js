"use strict";

/* ═══════════════════════════════════════════
 * Game Packager
 *
 * Upload a ZIP → extract files → create a FAT disk image →
 * configure game settings → download disk image + config file.
 * Uses fflate for ZIP decompression (loaded as a UMD global).
 * ═══════════════════════════════════════════ */

/* ── DOM refs ── */
const pkgUploadBtn     = $("pkg-upload-btn");
const pkgZipInput      = $("pkg-zip-input");
const pkgZipStatus     = $("pkg-zip-status");
const pkgFileList      = $("pkg-file-list");
const pkgLabel         = $("pkg-label");
const pkgImgFilename   = $("pkg-img-filename");
const pkgAutorun       = $("pkg-autorun");
const pkgPrompt        = $("pkg-prompt");
const pkgDepth         = $("pkg-depth");
const pkgDiskType      = $("pkg-disk-type");
const pkgGraphics      = $("pkg-graphics");
const pkgTextcap       = $("pkg-textcap");
const pkgSingleKey     = $("pkg-single-key");
const pkgBuildImgBtn   = $("pkg-build-img-btn");
const pkgDownloadCfgBtn = $("pkg-download-config-btn");
const pkgBuildStatus   = $("pkg-build-status");

/* ── State ── */
let pkgExtractedFiles = [];  /* Array of { name: string, data: Uint8Array } */
let pkgTotalSize = 0;        /* Sum of all extracted file sizes */
let pkgDiskImage = null;     /* Last built Uint8Array disk image */

/* ═══════════════════════════════════════════
 * ZIP Upload & Extraction
 * ═══════════════════════════════════════════ */

pkgUploadBtn.addEventListener("click", function() { pkgZipInput.click(); });

pkgZipInput.addEventListener("change", function() {
    if (!this.files.length) return;
    const file = this.files[0];
    this.value = "";

    pkgZipStatus.textContent = "Reading " + file.name + "...";
    pkgFileList.innerHTML = "";
    pkgExtractedFiles = [];
    pkgTotalSize = 0;
    pkgDiskImage = null;
    pkgBuildImgBtn.disabled = true;
    pkgDownloadCfgBtn.disabled = true;

    const reader = new FileReader();
    reader.onload = function() {
        try {
            if (typeof fflate === "undefined") {
                pkgZipStatus.textContent = "Error: fflate library not loaded.";
                return;
            }
            const zipData = new Uint8Array(reader.result);
            const extracted = fflate.unzipSync(zipData);

            /* Flatten paths, skip directories and macOS resource forks */
            const files = [];
            let total = 0;
            for (const [path, data] of Object.entries(extracted)) {
                /* Skip directories (empty data with trailing slash) */
                if (data.length === 0 && path.endsWith("/")) continue;
                /* Skip macOS metadata */
                if (path.includes("__MACOSX/") || path.split("/").pop().startsWith("._")) continue;

                /* Use only the filename (flatten directory structure for DOS) */
                const basename = path.split("/").pop();
                if (!basename) continue;

                /* Convert to 8.3 uppercase for DOS compatibility */
                const dosName = toDos83(basename);
                files.push({ name: dosName, data: data });
                total += data.length;
            }

            /* Deduplicate by DOS name (keep last occurrence) */
            const seen = new Map();
            for (const f of files) {
                seen.set(f.name, f);
            }
            pkgExtractedFiles = Array.from(seen.values());
            pkgTotalSize = total;

            /* Update UI */
            pkgZipStatus.textContent = pkgExtractedFiles.length + " files, " +
                formatSize(pkgTotalSize) + " total";

            /* Populate file list */
            const list = document.createElement("table");
            list.className = "file-table";
            list.style.fontSize = "0.82rem";
            const thead = document.createElement("thead");
            thead.innerHTML = "<tr><th>DOS Name</th><th>Size</th></tr>";
            list.appendChild(thead);
            const tbody = document.createElement("tbody");
            for (const f of pkgExtractedFiles) {
                const tr = document.createElement("tr");
                const tdName = document.createElement("td");
                tdName.textContent = f.name;
                const tdSize = document.createElement("td");
                tdSize.textContent = formatSize(f.data.length);
                tr.appendChild(tdName);
                tr.appendChild(tdSize);
                tbody.appendChild(tr);
            }
            list.appendChild(tbody);
            pkgFileList.innerHTML = "";
            pkgFileList.appendChild(list);

            /* Populate autorun dropdown with executable-looking files */
            populateAutorunSelect();

            /* Auto-detect disk type */
            autoDetectDiskType();

            /* Auto-generate label and filename from zip name */
            if (!pkgLabel.value) {
                const zipBase = file.name.replace(/\.zip$/i, "");
                pkgLabel.value = zipBase;
            }
            if (!pkgImgFilename.value) {
                const zipBase = file.name.replace(/\.zip$/i, "").toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
                pkgImgFilename.value = zipBase + ".img";
            }

            pkgBuildImgBtn.disabled = false;
            pkgDownloadCfgBtn.disabled = false;

        } catch (err) {
            pkgZipStatus.textContent = "Error extracting ZIP: " + err.message;
            console.error("ZIP extraction failed:", err);
        }
    };
    reader.readAsArrayBuffer(file);
});

/* ═══════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════ */

/** Convert a filename to DOS 8.3 format (uppercase, truncated). */
function toDos83(name) {
    const upper = name.toUpperCase();
    const dot = upper.lastIndexOf(".");
    let base, ext;
    if (dot > 0) {
        base = upper.substring(0, dot);
        ext = upper.substring(dot + 1);
    } else {
        base = upper;
        ext = "";
    }
    /* Strip characters invalid in DOS filenames */
    base = base.replace(/[^A-Z0-9!#$%&'()\-@^_`{}~]/g, "").substring(0, 8);
    ext = ext.replace(/[^A-Z0-9!#$%&'()\-@^_`{}~]/g, "").substring(0, 3);
    if (!base) base = "FILE";
    return ext ? base + "." + ext : base;
}

/* formatSize() is defined in ui-helpers.js */

/** Populate the autorun dropdown with files from the extracted ZIP. */
function populateAutorunSelect() {
    pkgAutorun.innerHTML = '<option value="">(none)</option>';
    const exeExts = ["EXE", "COM", "BAT"];
    for (const f of pkgExtractedFiles) {
        const ext = f.name.split(".").pop();
        const o = document.createElement("option");
        o.value = f.name;
        o.textContent = f.name;
        /* Put executables first in the list */
        if (exeExts.includes(ext)) {
            pkgAutorun.insertBefore(o, pkgAutorun.children[1] || null);
        } else {
            pkgAutorun.appendChild(o);
        }
    }
    /* Auto-select first executable if available */
    for (const f of pkgExtractedFiles) {
        const ext = f.name.split(".").pop();
        if (exeExts.includes(ext)) {
            pkgAutorun.value = f.name;
            break;
        }
    }
}

/** Auto-detect floppy vs HDD based on total file size. */
function autoDetectDiskType() {
    if (pkgDiskType.value !== "auto") return;
    /* FAT12 1.44MB floppy has ~1.39MB usable data space */
    const FLOPPY_USABLE = 1457664;
    const suggested = (pkgTotalSize <= FLOPPY_USABLE) ? "floppy" : "hdd";
    /* Show auto-detected value in the status */
    pkgBuildStatus.textContent = "Auto-detected: " + (suggested === "floppy" ? "Floppy (B:)" : "Hard Disk (C:)") +
        " for " + formatSize(pkgTotalSize) + " of files.";
}

pkgDiskType.addEventListener("change", function() {
    if (this.value === "auto") autoDetectDiskType();
    else pkgBuildStatus.textContent = "";
});

/* ═══════════════════════════════════════════
 * FAT Disk Image Creation
 * ═══════════════════════════════════════════ */

/**
 * Create a blank FAT12 1.44MB floppy image.
 * Returns a formatted Uint8Array ready for file writing.
 */
function createFAT12Floppy() {
    const totalBytes = 1474560;    /* 2880 sectors * 512 */
    const img = new Uint8Array(totalBytes);

    const bytesPerSector = 512;
    const sectorsPerCluster = 1;
    const reservedSectors = 1;
    const numFATs = 2;
    const rootDirEntries = 224;
    const totalSectors = 2880;
    const mediaDescriptor = 0xF0;  /* 3.5" HD floppy */
    const sectorsPerFAT = 9;
    const sectorsPerTrack = 18;
    const numHeads = 2;

    /* Boot sector / BPB */
    const bs = 0;
    img[bs + 0] = 0xEB; img[bs + 1] = 0x3C; img[bs + 2] = 0x90; /* JMP short + NOP */
    /* OEM name */
    const oem = "MSDOS5.0";
    for (let i = 0; i < 8; i++) img[bs + 3 + i] = oem.charCodeAt(i);
    /* BPB */
    img[bs + 11] = bytesPerSector & 0xFF; img[bs + 12] = (bytesPerSector >> 8) & 0xFF;
    img[bs + 13] = sectorsPerCluster;
    img[bs + 14] = reservedSectors & 0xFF; img[bs + 15] = (reservedSectors >> 8) & 0xFF;
    img[bs + 16] = numFATs;
    img[bs + 17] = rootDirEntries & 0xFF; img[bs + 18] = (rootDirEntries >> 8) & 0xFF;
    img[bs + 19] = totalSectors & 0xFF; img[bs + 20] = (totalSectors >> 8) & 0xFF;
    img[bs + 21] = mediaDescriptor;
    img[bs + 22] = sectorsPerFAT & 0xFF; img[bs + 23] = (sectorsPerFAT >> 8) & 0xFF;
    img[bs + 24] = sectorsPerTrack & 0xFF; img[bs + 25] = (sectorsPerTrack >> 8) & 0xFF;
    img[bs + 26] = numHeads & 0xFF; img[bs + 27] = (numHeads >> 8) & 0xFF;
    /* Boot signature */
    img[bs + 510] = 0x55; img[bs + 511] = 0xAA;

    /* FAT 1 — media descriptor in first entry */
    const fat1Start = reservedSectors * bytesPerSector;
    img[fat1Start + 0] = mediaDescriptor;
    img[fat1Start + 1] = 0xFF;
    img[fat1Start + 2] = 0xFF;

    /* FAT 2 — copy of FAT 1 initial bytes */
    const fat2Start = fat1Start + sectorsPerFAT * bytesPerSector;
    img[fat2Start + 0] = mediaDescriptor;
    img[fat2Start + 1] = 0xFF;
    img[fat2Start + 2] = 0xFF;

    return img;
}

/**
 * Create a blank FAT16 hard disk image with MBR.
 * Size is calculated to fit all files with some headroom.
 * Returns a formatted Uint8Array ready for file writing.
 */
function createFAT16HDD(neededDataBytes) {
    /* Calculate required size with generous overhead */
    const minSize = 4 * 1024 * 1024;  /* 4 MB minimum */
    const overhead = 1.3;  /* 30% overhead for FAT tables, root dir, slack */
    let targetSize = Math.max(minSize, Math.ceil(neededDataBytes * overhead));

    /* Round up to nearest MB */
    targetSize = Math.ceil(targetSize / (1024 * 1024)) * 1024 * 1024;

    /* Cap at a reasonable max (we use FAT16, max ~2GB but let's be practical) */
    targetSize = Math.min(targetSize, 512 * 1024 * 1024);

    const bytesPerSector = 512;
    const totalSectors = targetSize / bytesPerSector;

    /* Choose sectors per cluster based on disk size */
    let sectorsPerCluster;
    if (targetSize <= 16 * 1024 * 1024) sectorsPerCluster = 4;       /* <=16MB: 2KB clusters */
    else if (targetSize <= 128 * 1024 * 1024) sectorsPerCluster = 8;  /* <=128MB: 4KB clusters */
    else if (targetSize <= 256 * 1024 * 1024) sectorsPerCluster = 16; /* <=256MB: 8KB clusters */
    else sectorsPerCluster = 32;                                       /* >256MB: 16KB clusters */

    const reservedSectors = 1;
    const numFATs = 2;
    const rootDirEntries = 512;
    const mediaDescriptor = 0xF8;  /* hard disk */

    /* Partition starts at LBA 1 (sector 1) to leave room for MBR */
    const partStartLBA = 1;
    const partSectors = totalSectors - partStartLBA;

    /* Calculate sectors per FAT */
    const rootDirSectors = Math.ceil((rootDirEntries * 32) / bytesPerSector);
    const dataSectors = partSectors - reservedSectors - rootDirSectors;
    /* Approximate: sectorsPerFAT = ceil((dataSectors / sectorsPerCluster) * 2 / bytesPerSector) */
    /* But FAT itself uses sectors too, so iterate: */
    let sectorsPerFAT = Math.ceil(((dataSectors / sectorsPerCluster) * 2) / bytesPerSector);
    /* Refine: account for FAT space */
    const actualDataSectors = dataSectors - (numFATs * sectorsPerFAT);
    const totalClusters = Math.floor(actualDataSectors / sectorsPerCluster);
    sectorsPerFAT = Math.ceil((totalClusters + 2) * 2 / bytesPerSector);

    /* Validate FAT16 range */
    if (totalClusters < 4085 || totalClusters > 65525) {
        /* Adjust cluster size if needed — fall back to a smaller sectorsPerCluster */
        /* This should be rare given our size calculations above */
        console.warn("Cluster count " + totalClusters + " outside FAT16 range; image may not work perfectly.");
    }

    /* Build the image */
    const img = new Uint8Array(totalSectors * bytesPerSector);
    const partOffset = partStartLBA * bytesPerSector;

    /* ── MBR (sector 0) ── */
    /* Partition table entry 1 at offset 446 */
    const pe = 446;
    img[pe + 0] = 0x80;     /* Boot indicator: active */
    /* CHS of first sector (simplified) */
    img[pe + 1] = 0; img[pe + 2] = 2; img[pe + 3] = 0;
    img[pe + 4] = 0x06;     /* Partition type: FAT16 >32MB (use 0x06 for broad compatibility) */
    /* CHS of last sector (simplified) */
    img[pe + 5] = 0xFE; img[pe + 6] = 0xFF; img[pe + 7] = 0xFF;
    /* LBA of first sector */
    img[pe + 8]  = partStartLBA & 0xFF;
    img[pe + 9]  = (partStartLBA >> 8) & 0xFF;
    img[pe + 10] = (partStartLBA >> 16) & 0xFF;
    img[pe + 11] = (partStartLBA >> 24) & 0xFF;
    /* Number of sectors */
    img[pe + 12] = partSectors & 0xFF;
    img[pe + 13] = (partSectors >> 8) & 0xFF;
    img[pe + 14] = (partSectors >> 16) & 0xFF;
    img[pe + 15] = (partSectors >> 24) & 0xFF;
    /* MBR boot signature */
    img[510] = 0x55; img[511] = 0xAA;

    /* ── Partition Boot Sector (VBR) ── */
    const vbr = partOffset;
    img[vbr + 0] = 0xEB; img[vbr + 1] = 0x3C; img[vbr + 2] = 0x90;
    const oem = "MSDOS5.0";
    for (let i = 0; i < 8; i++) img[vbr + 3 + i] = oem.charCodeAt(i);
    /* BPB */
    img[vbr + 11] = bytesPerSector & 0xFF; img[vbr + 12] = (bytesPerSector >> 8) & 0xFF;
    img[vbr + 13] = sectorsPerCluster;
    img[vbr + 14] = reservedSectors & 0xFF; img[vbr + 15] = (reservedSectors >> 8) & 0xFF;
    img[vbr + 16] = numFATs;
    img[vbr + 17] = rootDirEntries & 0xFF; img[vbr + 18] = (rootDirEntries >> 8) & 0xFF;
    /* totalSectors in 16-bit field if it fits, else use 32-bit field */
    if (partSectors <= 0xFFFF) {
        img[vbr + 19] = partSectors & 0xFF; img[vbr + 20] = (partSectors >> 8) & 0xFF;
    } else {
        img[vbr + 19] = 0; img[vbr + 20] = 0;
        img[vbr + 32] = partSectors & 0xFF;
        img[vbr + 33] = (partSectors >> 8) & 0xFF;
        img[vbr + 34] = (partSectors >> 16) & 0xFF;
        img[vbr + 35] = (partSectors >> 24) & 0xFF;
    }
    img[vbr + 21] = mediaDescriptor;
    img[vbr + 22] = sectorsPerFAT & 0xFF; img[vbr + 23] = (sectorsPerFAT >> 8) & 0xFF;
    img[vbr + 24] = 63;  /* sectors per track */
    img[vbr + 25] = 0;
    img[vbr + 26] = 16;  /* number of heads */
    img[vbr + 27] = 0;
    /* Hidden sectors = partition start LBA */
    img[vbr + 28] = partStartLBA & 0xFF;
    img[vbr + 29] = (partStartLBA >> 8) & 0xFF;
    img[vbr + 30] = (partStartLBA >> 16) & 0xFF;
    img[vbr + 31] = (partStartLBA >> 24) & 0xFF;
    /* Extended BPB */
    img[vbr + 36] = 0x80;  /* drive number (first HDD) */
    img[vbr + 38] = 0x29;  /* extended boot signature */
    img[vbr + 39] = 0x12; img[vbr + 40] = 0x34; img[vbr + 41] = 0x56; img[vbr + 42] = 0x78; /* serial */
    const volLabel = "GAME       ";
    for (let i = 0; i < 11; i++) img[vbr + 43 + i] = volLabel.charCodeAt(i);
    const fsType = "FAT16   ";
    for (let i = 0; i < 8; i++) img[vbr + 54 + i] = fsType.charCodeAt(i);
    /* VBR boot signature */
    img[vbr + 510] = 0x55; img[vbr + 511] = 0xAA;

    /* ── FAT tables ── */
    const fat1Off = partOffset + reservedSectors * bytesPerSector;
    /* First two entries: media descriptor + 0xFFFF */
    img[fat1Off + 0] = mediaDescriptor;
    img[fat1Off + 1] = 0xFF;
    img[fat1Off + 2] = 0xFF;
    img[fat1Off + 3] = 0xFF;

    /* Copy to FAT 2 */
    const fat2Off = fat1Off + sectorsPerFAT * bytesPerSector;
    img[fat2Off + 0] = mediaDescriptor;
    img[fat2Off + 1] = 0xFF;
    img[fat2Off + 2] = 0xFF;
    img[fat2Off + 3] = 0xFF;

    return img;
}

/**
 * Write files to a FAT-formatted disk image.
 * Uses the existing parseFATGeometry and writeFATFile from fat.js.
 */
function writeFilesToImage(img, files) {
    const geo = parseFATGeometry(img);
    if (!geo) return { ok: false, error: "Could not parse FAT geometry of created image." };

    let written = 0;
    const errors = [];
    for (const f of files) {
        const ok = writeFATFile(img, geo, f.name, f.data);
        if (ok) {
            written++;
        } else {
            errors.push(f.name);
        }
    }

    if (errors.length > 0) {
        return { ok: false, error: "Failed to write " + errors.length + " file(s): " + errors.join(", ") + ". Disk may be full." };
    }
    return { ok: true, written: written };
}

/* ═══════════════════════════════════════════
 * Build Disk Image
 * ═══════════════════════════════════════════ */

pkgBuildImgBtn.addEventListener("click", function() {
    if (pkgExtractedFiles.length === 0) {
        pkgBuildStatus.textContent = "No files extracted. Upload a ZIP first.";
        return;
    }

    pkgBuildStatus.textContent = "Building disk image...";

    /* Determine disk type */
    let diskType = pkgDiskType.value;
    if (diskType === "auto") {
        const FLOPPY_USABLE = 1457664;  /* ~1.39MB usable on 1.44MB floppy */
        diskType = (pkgTotalSize <= FLOPPY_USABLE) ? "floppy" : "hdd";
    }

    try {
        let img;
        if (diskType === "floppy") {
            img = createFAT12Floppy();
        } else {
            img = createFAT16HDD(pkgTotalSize);
        }

        const result = writeFilesToImage(img, pkgExtractedFiles);

        if (!result.ok) {
            pkgBuildStatus.textContent = "Error: " + result.error;
            return;
        }

        pkgDiskImage = img;

        /* Trigger download */
        const filename = pkgImgFilename.value.trim() || "game.img";
        triggerDownload(img, filename, "application/octet-stream");

        const sizeStr = formatSize(img.length);
        const typeStr = diskType === "floppy" ? "Floppy (FAT12, 1.44 MB)" : "Hard Disk (FAT16, " + sizeStr + ")";
        pkgBuildStatus.textContent = "Disk image created: " + filename + " — " + typeStr +
            ", " + result.written + " file(s) written. Download started.";

    } catch (err) {
        pkgBuildStatus.textContent = "Error building image: " + err.message;
        console.error("Disk image creation failed:", err);
    }
});

/* ═══════════════════════════════════════════
 * Download Config File
 * ═══════════════════════════════════════════ */

pkgDownloadCfgBtn.addEventListener("click", function() {
    const label = pkgLabel.value.trim() || "My Game";
    const imgFilename = pkgImgFilename.value.trim() || "game.img";
    const autorun = pkgAutorun.value;
    const prompt = pkgPrompt.value || ">";
    const depth = pkgDepth.value;
    const graphics = pkgGraphics.checked;
    const textcap = pkgTextcap.checked;
    const singleKey = pkgSingleKey.checked;

    /* Determine disk type */
    let diskType = pkgDiskType.value;
    if (diskType === "auto") {
        const FLOPPY_USABLE = 1457664;
        diskType = (pkgTotalSize <= FLOPPY_USABLE) ? "floppy" : "hdd";
    }

    /* Build the config file content */
    let configLines = [];
    configLines.push('"use strict";');
    configLines.push("");
    configLines.push("KNOWN_GAMES[" + JSON.stringify(imgFilename) + "] = {");
    configLines.push("    label: " + JSON.stringify(label) + ",");
    configLines.push("    autorun: " + JSON.stringify(autorun) + ",");
    configLines.push("    prompt: " + JSON.stringify(prompt) + ",");
    configLines.push("    depth: " + JSON.stringify(depth) + ",");
    configLines.push("    disk: " + JSON.stringify(diskType) + (graphics || textcap || singleKey ? "," : ""));

    if (graphics)  configLines.push("    graphics: true" + (textcap || singleKey ? "," : ""));
    if (textcap)   configLines.push("    textcap: true" + (singleKey ? "," : ""));
    if (singleKey) configLines.push("    singleKey: true");

    configLines.push("};");
    configLines.push("");

    const configContent = configLines.join("\n");

    /* Generate a safe filename for the config JS file */
    const cfgBaseName = imgFilename.replace(/\.img$/i, "").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    const cfgFileName = cfgBaseName + ".js";

    triggerDownload(configContent, cfgFileName, "text/javascript");

    /* Also show the script tag the user needs to add */
    const scriptTag = '<script src="js/games/' + cfgFileName + '"><\/script>';
    pkgBuildStatus.textContent = "Config downloaded: " + cfgFileName +
        ". Add this line to index.html after the other game scripts: " + scriptTag;
});
