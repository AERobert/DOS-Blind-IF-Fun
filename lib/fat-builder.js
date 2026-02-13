"use strict";

/**
 * FAT16 Disk Image Builder
 *
 * Creates FAT16-formatted hard disk images from files in a directory,
 * and extracts files from existing disk images.
 *
 * Produces MBR-partitioned images compatible with v86's HDD emulation.
 */

const fs = require("fs");
const path = require("path");

/* ── Layout constants ── */
const BYTES_PER_SECTOR = 512;
const PARTITION_START_LBA = 63;          /* standard CHS-aligned offset */
const RESERVED_SECTORS = 1;             /* just the boot sector */
const NUM_FATS = 2;
const ROOT_DIR_ENTRIES = 512;
const ROOT_DIR_SECTORS = (ROOT_DIR_ENTRIES * 32) / BYTES_PER_SECTOR; /* 32 */
const MEDIA_DESCRIPTOR = 0xF8;          /* hard disk */

/**
 * Calculate sectors-per-cluster and sectors-per-FAT for a given
 * partition size so that we land in FAT16 territory (4085..65524 clusters).
 */
function calcGeometry(partitionSectors) {
    /* Try cluster sizes from 1 to 64 sectors */
    for (const spc of [1, 2, 4, 8, 16, 32, 64]) {
        /* Estimate FAT size iteratively */
        let spf = 1;
        for (let iter = 0; iter < 10; iter++) {
            const dataSectors = partitionSectors - RESERVED_SECTORS
                                - (NUM_FATS * spf) - ROOT_DIR_SECTORS;
            if (dataSectors <= 0) break;
            const clusters = Math.floor(dataSectors / spc);
            const needed = Math.ceil((clusters + 2) * 2 / BYTES_PER_SECTOR);
            if (needed === spf) break;
            spf = needed;
        }

        const dataSectors = partitionSectors - RESERVED_SECTORS
                            - (NUM_FATS * spf) - ROOT_DIR_SECTORS;
        const clusters = Math.floor(dataSectors / spc);

        /* FAT16 range: 4085 .. 65524 */
        if (clusters >= 4085 && clusters <= 65524) {
            return { sectorsPerCluster: spc, sectorsPerFAT: spf, totalClusters: clusters };
        }
    }
    /* Default fallback: 4 sectors per cluster */
    const spc = 4;
    let spf = 64;
    return { sectorsPerCluster: spc, sectorsPerFAT: spf, totalClusters: 0 };
}

/**
 * Create a blank, formatted FAT16 hard disk image.
 * @param {number} sizeMB - Total image size in megabytes (default 32)
 * @returns {Buffer} The raw disk image
 */
function createBlankImage(sizeMB = 32) {
    const totalBytes = sizeMB * 1024 * 1024;
    const totalSectors = Math.floor(totalBytes / BYTES_PER_SECTOR);
    const partitionSectors = totalSectors - PARTITION_START_LBA;

    const geo = calcGeometry(partitionSectors);
    const img = Buffer.alloc(totalBytes, 0);

    /* ── MBR ── */
    /* Partition entry 1 at offset 446 */
    const pe = 446;
    img[pe + 0] = 0x80;                               /* active / bootable */
    /* CHS start: head=1, sector=1, cylinder=0 */
    img[pe + 1] = 1; img[pe + 2] = 1; img[pe + 3] = 0;
    img[pe + 4] = 0x06;                               /* FAT16 (>32MB) type */
    /* CHS end: approximate – not critical for v86 */
    img[pe + 5] = 0xFE; img[pe + 6] = 0xFF; img[pe + 7] = 0xFF;
    /* LBA start (little-endian 32-bit) */
    img.writeUInt32LE(PARTITION_START_LBA, pe + 8);
    /* LBA size */
    img.writeUInt32LE(partitionSectors, pe + 12);
    /* MBR signature */
    img[510] = 0x55; img[511] = 0xAA;

    /* ── Boot sector / BPB (at partition start) ── */
    const bpb = PARTITION_START_LBA * BYTES_PER_SECTOR;
    /* Jump instruction */
    img[bpb + 0] = 0xEB; img[bpb + 1] = 0x3C; img[bpb + 2] = 0x90;
    /* OEM name */
    Buffer.from("MSDOS5.0").copy(img, bpb + 3);
    /* Bytes per sector */
    img.writeUInt16LE(BYTES_PER_SECTOR, bpb + 11);
    /* Sectors per cluster */
    img[bpb + 13] = geo.sectorsPerCluster;
    /* Reserved sectors */
    img.writeUInt16LE(RESERVED_SECTORS, bpb + 14);
    /* Number of FATs */
    img[bpb + 16] = NUM_FATS;
    /* Root directory entries */
    img.writeUInt16LE(ROOT_DIR_ENTRIES, bpb + 17);
    /* Total sectors (16-bit) – 0 means use 32-bit field */
    img.writeUInt16LE(0, bpb + 19);
    /* Media descriptor */
    img[bpb + 21] = MEDIA_DESCRIPTOR;
    /* Sectors per FAT */
    img.writeUInt16LE(geo.sectorsPerFAT, bpb + 22);
    /* Sectors per track */
    img.writeUInt16LE(63, bpb + 24);
    /* Number of heads */
    img.writeUInt16LE(16, bpb + 26);
    /* Hidden sectors (= partition start LBA) */
    img.writeUInt32LE(PARTITION_START_LBA, bpb + 28);
    /* Total sectors (32-bit) */
    img.writeUInt32LE(partitionSectors, bpb + 32);
    /* Drive number */
    img[bpb + 36] = 0x80;
    /* Extended boot signature */
    img[bpb + 38] = 0x29;
    /* Volume serial number */
    img.writeUInt32LE(Date.now() & 0xFFFFFFFF, bpb + 39);
    /* Volume label */
    Buffer.from("WORKSPACE  ").copy(img, bpb + 43);
    /* Filesystem type */
    Buffer.from("FAT16   ").copy(img, bpb + 54);
    /* Boot sector signature */
    img[bpb + 510] = 0x55; img[bpb + 511] = 0xAA;

    /* ── Initialize FATs ── */
    const fatStart = bpb + RESERVED_SECTORS * BYTES_PER_SECTOR;
    const fat2Start = fatStart + geo.sectorsPerFAT * BYTES_PER_SECTOR;

    /* First two FAT entries are reserved */
    for (const base of [fatStart, fat2Start]) {
        img[base + 0] = MEDIA_DESCRIPTOR;
        img[base + 1] = 0xFF;
        img[base + 2] = 0xFF;
        img[base + 3] = 0xFF;
    }

    return img;
}

/**
 * Parse FAT16 geometry from a disk image buffer.
 * Handles both MBR-partitioned and raw images.
 * (Server-side equivalent of the browser-side parseFATGeometry)
 */
function parseGeometry(img) {
    let partOffset = 0;

    if (img.length > 512 && img[510] === 0x55 && img[511] === 0xAA) {
        for (let i = 0; i < 4; i++) {
            const entryOff = 446 + i * 16;
            const partType = img[entryOff + 4];
            if ([0x01, 0x04, 0x06, 0x0B, 0x0C, 0x0E].includes(partType)) {
                const lba = img.readUInt32LE(entryOff + 8);
                if (lba > 0) { partOffset = lba * 512; break; }
            }
        }
    }

    const bpb = partOffset;
    const bytesPerSector   = img.readUInt16LE(bpb + 11);
    const sectorsPerCluster = img[bpb + 13];
    const reservedSectors  = img.readUInt16LE(bpb + 14);
    const numFATs          = img[bpb + 16];
    const rootDirEntries   = img.readUInt16LE(bpb + 17);
    let   totalSectors     = img.readUInt16LE(bpb + 19);
    const sectorsPerFAT    = img.readUInt16LE(bpb + 22);

    if (totalSectors === 0) totalSectors = img.readUInt32LE(bpb + 32);

    if (bytesPerSector < 128 || bytesPerSector > 4096) return null;
    if (sectorsPerCluster === 0 || numFATs === 0 || sectorsPerFAT === 0) return null;

    const fatStart = partOffset + reservedSectors * bytesPerSector;
    const fat2Start = fatStart + sectorsPerFAT * bytesPerSector;
    const rootDirStart = partOffset + (reservedSectors + numFATs * sectorsPerFAT) * bytesPerSector;
    const rootDirSectors = Math.ceil((rootDirEntries * 32) / bytesPerSector);
    const dataStart = rootDirStart + rootDirSectors * bytesPerSector;

    const dataSectors = totalSectors - reservedSectors - (numFATs * sectorsPerFAT) - rootDirSectors;
    const totalClusters = Math.floor(dataSectors / sectorsPerCluster);
    const fatType = (totalClusters < 4085) ? 12 : 16;
    const bytesPerCluster = bytesPerSector * sectorsPerCluster;

    return {
        partOffset, bytesPerSector, sectorsPerCluster, bytesPerCluster,
        reservedSectors, numFATs, rootDirEntries, totalSectors,
        sectorsPerFAT, fatStart, fat2Start, rootDirStart, dataStart,
        totalClusters, fatType
    };
}

/** Read a FAT entry for a given cluster number. */
function readFATEntry(img, geo, cluster) {
    if (geo.fatType === 12) {
        const bo = Math.floor(cluster * 3 / 2);
        const w = img[geo.fatStart + bo] | (img[geo.fatStart + bo + 1] << 8);
        return (cluster & 1) ? (w >> 4) : (w & 0xFFF);
    }
    const bo = cluster * 2;
    return img[geo.fatStart + bo] | (img[geo.fatStart + bo + 1] << 8);
}

/** Write a FAT entry to both FAT copies. */
function writeFATEntry(img, geo, cluster, val) {
    for (const base of [geo.fatStart, geo.fat2Start]) {
        if (geo.fatType === 12) {
            const bo = Math.floor(cluster * 3 / 2);
            let w = img[base + bo] | (img[base + bo + 1] << 8);
            if (cluster & 1) w = (w & 0x000F) | ((val & 0xFFF) << 4);
            else             w = (w & 0xF000) | (val & 0xFFF);
            img[base + bo] = w & 0xFF;
            img[base + bo + 1] = (w >> 8) & 0xFF;
        } else {
            const bo = cluster * 2;
            img[base + bo] = val & 0xFF;
            img[base + bo + 1] = (val >> 8) & 0xFF;
        }
    }
}

function isEOF(geo, val) {
    return (geo.fatType === 12) ? (val >= 0xFF8) : (val >= 0xFFF8);
}

/**
 * Write a file into a FAT image.
 * @param {Buffer} img - disk image buffer (modified in place)
 * @param {object} geo - parsed geometry
 * @param {string} fileName - DOS 8.3 filename (e.g. "GAME.EXE")
 * @param {Buffer} fileData - file contents
 * @returns {boolean} true on success
 */
function writeFileToImage(img, geo, fileName, fileData) {
    const eofMark = (geo.fatType === 12) ? 0xFFF : 0xFFFF;

    /* Parse 8.3 name */
    const parts = fileName.toUpperCase().split(".");
    const fn = (parts[0] || "").substring(0, 8).padEnd(8, " ");
    const fe = (parts[1] || "").substring(0, 3).padEnd(3, " ");

    /* Find free clusters */
    const clustersNeeded = Math.max(1, Math.ceil(fileData.length / geo.bytesPerCluster));
    const freeClusters = [];
    for (let c = 2; c <= geo.totalClusters + 1 && freeClusters.length < clustersNeeded; c++) {
        if (readFATEntry(img, geo, c) === 0x000) freeClusters.push(c);
    }
    if (freeClusters.length < clustersNeeded) return false;

    /* Write data to clusters and build chain */
    for (let i = 0; i < freeClusters.length; i++) {
        const c = freeClusters[i];
        const off = geo.dataStart + (c - 2) * geo.bytesPerCluster;
        const srcOff = i * geo.bytesPerCluster;
        const chunk = fileData.slice(srcOff, srcOff + geo.bytesPerCluster);
        chunk.copy(img, off);
        writeFATEntry(img, geo, c, (i < freeClusters.length - 1) ? freeClusters[i + 1] : eofMark);
    }

    /* Find or create directory entry */
    let dirOff = -1;

    /* Check for existing entry (overwrite) */
    for (let i = 0; i < geo.rootDirEntries; i++) {
        const o = geo.rootDirStart + i * 32;
        if (img[o] === 0x00 || img[o] === 0xE5) continue;
        let existName = "";
        for (let c = 0; c < 11; c++) existName += String.fromCharCode(img[o + c]);
        if (existName === fn + fe) {
            /* Free old clusters */
            let oldC = img[o + 26] | (img[o + 27] << 8);
            while (oldC >= 2 && !isEOF(geo, oldC)) {
                const next = readFATEntry(img, geo, oldC);
                writeFATEntry(img, geo, oldC, 0x000);
                oldC = next;
            }
            if (oldC >= 2 && isEOF(geo, oldC)) writeFATEntry(img, geo, oldC, 0x000);
            dirOff = o;
            break;
        }
    }

    if (dirOff === -1) {
        for (let i = 0; i < geo.rootDirEntries; i++) {
            const o = geo.rootDirStart + i * 32;
            if (img[o] === 0x00 || img[o] === 0xE5) { dirOff = o; break; }
        }
    }
    if (dirOff === -1) return false;

    /* Write directory entry */
    for (let c = 0; c < 8; c++) img[dirOff + c] = fn.charCodeAt(c);
    for (let c = 0; c < 3; c++) img[dirOff + 8 + c] = fe.charCodeAt(c);
    img[dirOff + 11] = 0x20; /* archive attribute */
    for (let c = 12; c < 26; c++) img[dirOff + c] = 0;
    img[dirOff + 26] = freeClusters[0] & 0xFF;
    img[dirOff + 27] = (freeClusters[0] >> 8) & 0xFF;
    const sz = fileData.length;
    img[dirOff + 28] = sz & 0xFF;
    img[dirOff + 29] = (sz >> 8) & 0xFF;
    img[dirOff + 30] = (sz >> 16) & 0xFF;
    img[dirOff + 31] = (sz >> 24) & 0xFF;

    return true;
}

/**
 * Extract all files from a FAT image.
 * Handles open files (size=0 in directory but data in clusters) by
 * following the FAT cluster chain to read all allocated data.
 * @param {Buffer} img - disk image buffer
 * @returns {Array<{name: string, data: Buffer}>} extracted files
 */
function extractFilesFromImage(img) {
    const geo = parseGeometry(img);
    if (!geo) return [];

    const files = [];

    for (let i = 0; i < geo.rootDirEntries; i++) {
        const off = geo.rootDirStart + i * 32;
        const firstByte = img[off];

        if (firstByte === 0x00) break;
        if (firstByte === 0xE5) continue;

        const attr = img[off + 11];
        if (attr === 0x0F) continue; /* LFN */
        if (attr & 0x08) continue;   /* volume label */
        if (attr & 0x10) continue;   /* directory */

        let name = "";
        for (let c = 0; c < 8; c++) name += String.fromCharCode(img[off + c]);
        name = name.trimEnd();

        let ext = "";
        for (let c = 0; c < 3; c++) ext += String.fromCharCode(img[off + 8 + c]);
        ext = ext.trimEnd();

        const fullName = ext ? name + "." + ext : name;
        const firstCluster = img[off + 26] | (img[off + 27] << 8);
        const dirSize = img.readUInt32LE(off + 28);

        if (firstCluster < 2) continue; /* no data */

        /*
         * Follow the FAT cluster chain to find the actual data length.
         * This handles open files (e.g. transcripts) where the directory
         * size field is still 0 because DOS hasn't closed the file yet.
         */
        const clusters = [];
        let cluster = firstCluster;
        const maxClusters = geo.totalClusters + 2;
        while (cluster >= 2 && !isEOF(geo, cluster) && clusters.length < maxClusters) {
            clusters.push(cluster);
            cluster = readFATEntry(img, geo, cluster);
        }

        const chainBytes = clusters.length * geo.bytesPerCluster;
        /* Use the directory size if it's nonzero and within the chain;
         * otherwise use the full chain length (open-file fallback). */
        const useSize = (dirSize > 0 && dirSize <= chainBytes) ? dirSize : chainBytes;

        const data = Buffer.alloc(useSize);
        let written = 0;
        for (const c of clusters) {
            const clusterOffset = geo.dataStart + (c - 2) * geo.bytesPerCluster;
            const toRead = Math.min(geo.bytesPerCluster, useSize - written);
            if (toRead <= 0) break;
            img.copy(data, written, clusterOffset, clusterOffset + toRead);
            written += toRead;
        }

        files.push({ name: fullName, data });
    }

    return files;
}

/**
 * Build a FAT16 HDD image from a directory of files.
 * @param {string} dirPath - directory containing files to include
 * @param {number} sizeMB - image size in megabytes (default 32)
 * @returns {Buffer} the disk image
 */
function buildImageFromDirectory(dirPath, sizeMB = 32) {
    const img = createBlankImage(sizeMB);
    const geo = parseGeometry(img);
    if (!geo) throw new Error("Failed to parse geometry of blank image");

    if (!fs.existsSync(dirPath)) return img;

    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        /* Skip files too large to be meaningful */
        if (stat.size > 16 * 1024 * 1024) continue;

        const fileData = fs.readFileSync(fullPath);
        const ok = writeFileToImage(img, geo, entry, fileData);
        if (!ok) {
            console.warn("Could not write file to image:", entry);
        }
    }

    return img;
}

/**
 * Extract files from a disk image into a directory.
 * @param {Buffer} imgData - the disk image
 * @param {string} dirPath - target directory
 * @returns {number} number of files extracted
 */
function extractImageToDirectory(imgData, dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });

    const files = extractFilesFromImage(imgData);
    for (const f of files) {
        fs.writeFileSync(path.join(dirPath, f.name), f.data);
    }
    return files.length;
}

module.exports = {
    createBlankImage,
    parseGeometry,
    writeFileToImage,
    extractFilesFromImage,
    buildImageFromDirectory,
    extractImageToDirectory,
};
