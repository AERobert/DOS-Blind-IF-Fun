"use strict";

/* ═══════════════════════════════════════════
 * Generic FAT File Manager (FAT12 + FAT16, floppy + HDD)
 * ═══════════════════════════════════════════ */

/**
 * Read disk bytes from v86 for the active game disk.
 * Returns Uint8Array or null. Works for both floppy (fdb) and HDD (hda).
 */
function getDiskBytes() {
    if (!emulator) return null;
    try {
        const isHDD = diskTypeSelect.value === "hdd";
        if (isHDD) {
            /* IDE primary master = hda */
            const dev = emulator.v86.cpu.devices.ide.primary.master;
            if (!dev || !dev.buffer) return null;
            /* SyncBuffer.get_buffer() is synchronous despite callback API */
            let raw = null;
            dev.buffer.get_buffer(function(buf) { raw = buf; });
            if (!raw) return null;
            return new Uint8Array(raw);
        } else {
            /* Floppy B: drive */
            const buf = emulator.get_disk_fdb();
            if (!buf) return null;
            if (buf instanceof Uint8Array) return buf;
            if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
            if (buf.buffer) return new Uint8Array(buf.buffer);
            return null;
        }
    } catch(e) {
        console.error("getDiskBytes() failed:", e);
        return null;
    }
}

/** Get a mutable copy of the disk image for writing. */
function getDiskBytesCopy() {
    const orig = getDiskBytes();
    return orig ? new Uint8Array(orig) : null;
}

/**
 * Replace the game disk image with new data (for file uploads).
 * Supports both floppy (B:) and HDD (C:) images.
 */
async function replaceDiskImage(data) {
    if (!emulator) return false;

    const isHDD = diskTypeSelect.value === "hdd";

    try {
        if (isHDD) {
            /* IDE primary master = hda (C: drive) */
            const dev = emulator.v86.cpu.devices.ide.primary.master;
            if (!dev || !dev.buffer) return false;

            const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            const oldBuf = dev.buffer;

            /* Try direct view replacement first (most efficient) */
            if (oldBuf && oldBuf.view) {
                oldBuf.view = new DataView(ab);
                oldBuf.byteLength = ab.byteLength;
                return true;
            }

            /* Fall back to set() method if available */
            if (oldBuf && typeof oldBuf.set === "function") {
                oldBuf.set(0, data, function() {});
                return true;
            }

            return false;
        } else {
            /* Floppy B: drive */
            const drive = emulator.v86.cpu.devices.fdc.drives[1];
            if (drive) {
                const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                const oldBuf = drive.buffer;
                if (oldBuf && oldBuf.view) {
                    oldBuf.view = new DataView(ab);
                    oldBuf.byteLength = ab.byteLength;
                    return true;
                }
                if (oldBuf && typeof oldBuf.set === "function") {
                    oldBuf.set(0, data, function() {});
                    return true;
                }
            }
            return false;
        }
    } catch(e) {
        console.error("replaceDiskImage failed:", e);
        return false;
    }
}

/**
 * Parse the FAT filesystem geometry from a disk image.
 * Handles both raw floppies (BPB at byte 0) and MBR-partitioned HDDs.
 */
function parseFATGeometry(img) {
    let partOffset = 0; /* byte offset to the partition/filesystem start */

    if (img.length > 512 && img[510] === 0x55 && img[511] === 0xAA) {
        /* Check all four partition table entries */
        for (let i = 0; i < 4; i++) {
            const entryOff = 446 + i * 16;
            const partType = img[entryOff + 4];
            if (partType === 0x04 || partType === 0x06 || partType === 0x0E ||
                partType === 0x01 || partType === 0x0B || partType === 0x0C) {
                /* Valid FAT partition type found */
                const lbaStart = img[entryOff + 8] | (img[entryOff + 9] << 8) |
                                 (img[entryOff + 10] << 16) | (img[entryOff + 11] << 24);
                if (lbaStart > 0) {
                    partOffset = lbaStart * 512;
                    break;
                }
            }
        }
    }

    /* Read BPB (BIOS Parameter Block) from the boot sector */
    const bpb = partOffset;
    const bytesPerSector   = img[bpb + 11] | (img[bpb + 12] << 8);
    const sectorsPerCluster = img[bpb + 13];
    const reservedSectors  = img[bpb + 14] | (img[bpb + 15] << 8);
    const numFATs          = img[bpb + 16];
    const rootDirEntries   = img[bpb + 17] | (img[bpb + 18] << 8);
    let   totalSectors     = img[bpb + 19] | (img[bpb + 20] << 8);
    const sectorsPerFAT    = img[bpb + 22] | (img[bpb + 23] << 8);

    /* If small total sectors is 0, use the 32-bit field */
    if (totalSectors === 0) {
        totalSectors = img[bpb + 32] | (img[bpb + 33] << 8) |
                       (img[bpb + 34] << 16) | (img[bpb + 35] << 24);
    }

    /* Sanity check the BPB values */
    if (bytesPerSector < 128 || bytesPerSector > 4096) return null;
    if (sectorsPerCluster === 0 || numFATs === 0) return null;
    if (sectorsPerFAT === 0) return null;

    /* Calculate layout offsets (all relative to partition start) */
    const fatStart = partOffset + reservedSectors * bytesPerSector;
    const fat2Start = fatStart + sectorsPerFAT * bytesPerSector;
    const rootDirStart = partOffset + (reservedSectors + numFATs * sectorsPerFAT) * bytesPerSector;
    const rootDirSectors = Math.ceil((rootDirEntries * 32) / bytesPerSector);
    const dataStart = rootDirStart + rootDirSectors * bytesPerSector;

    /* Determine FAT type from data cluster count */
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

/**
 * Parse directory entries from the root directory of a FAT12/16 image.
 */
function parseFATDir(img, geo) {
    if (!geo) return [];
    const files = [];

    for (let i = 0; i < geo.rootDirEntries; i++) {
        const off = geo.rootDirStart + i * 32;
        const firstByte = img[off];

        if (firstByte === 0x00) break;    /* end of directory */
        if (firstByte === 0xE5) continue; /* deleted entry */

        const attr = img[off + 11];
        if (attr === 0x0F) continue; /* LFN */
        if (attr & 0x08) continue;   /* volume label */

        let name = "";
        for (let c = 0; c < 8; c++) name += String.fromCharCode(img[off + c]);
        name = name.trimEnd();

        let ext = "";
        for (let c = 0; c < 3; c++) ext += String.fromCharCode(img[off + 8 + c]);
        ext = ext.trimEnd();

        const fullName = ext ? name + "." + ext : name;
        const firstCluster = img[off + 26] | (img[off + 27] << 8);
        const size = img[off + 28] | (img[off + 29] << 8) |
                     (img[off + 30] << 16) | (img[off + 31] << 24);
        const isDir = !!(attr & 0x10);

        files.push({ name, ext, fullName, size, firstCluster, attr, isDir, offset: off });
    }
    return files;
}

/**
 * Read a FAT entry for a given cluster number.
 * Supports both FAT12 (12-bit packed entries) and FAT16 (16-bit entries).
 */
function readFATEntry(img, geo, cluster) {
    if (geo.fatType === 12) {
        const byteOff = Math.floor(cluster * 3 / 2);
        const word = img[geo.fatStart + byteOff] | (img[geo.fatStart + byteOff + 1] << 8);
        return (cluster & 1) ? (word >> 4) : (word & 0xFFF);
    } else {
        /* FAT16: 2 bytes per entry */
        const byteOff = cluster * 2;
        return img[geo.fatStart + byteOff] | (img[geo.fatStart + byteOff + 1] << 8);
    }
}

/** Check if a FAT entry marks end-of-chain. */
function isEOF(geo, val) {
    return (geo.fatType === 12) ? (val >= 0xFF8) : (val >= 0xFFF8);
}

/**
 * Read file data by following its cluster chain.
 * Returns Uint8Array of file contents.
 */
function readFATFile(img, geo, file) {
    const data = new Uint8Array(file.size);
    let cluster = file.firstCluster;
    let written = 0;

    while (cluster >= 2 && !isEOF(geo, cluster) && written < file.size) {
        const clusterOffset = geo.dataStart + (cluster - 2) * geo.bytesPerCluster;
        const toRead = Math.min(geo.bytesPerCluster, file.size - written);
        data.set(img.slice(clusterOffset, clusterOffset + toRead), written);
        written += toRead;
        cluster = readFATEntry(img, geo, cluster);
    }
    return data;
}

/**
 * Write a FAT entry (both FAT copies).
 */
function writeFATEntry(img, geo, cluster, val) {
    for (const base of [geo.fatStart, geo.fat2Start]) {
        if (geo.fatType === 12) {
            const bo = Math.floor(cluster * 3 / 2);
            let w = img[base + bo] | (img[base + bo + 1] << 8);
            if (cluster & 1) {
                w = (w & 0x000F) | ((val & 0xFFF) << 4);
            } else {
                w = (w & 0xF000) | (val & 0xFFF);
            }
            img[base + bo] = w & 0xFF;
            img[base + bo + 1] = (w >> 8) & 0xFF;
        } else {
            const bo = cluster * 2;
            img[base + bo] = val & 0xFF;
            img[base + bo + 1] = (val >> 8) & 0xFF;
        }
    }
}

/**
 * Write a file to the FAT image.
 * Finds free clusters, writes data, creates/overwrites a directory entry.
 * Returns true on success.
 */
function writeFATFile(img, geo, fileName, fileData) {
    const eofMark = (geo.fatType === 12) ? 0xFFF : 0xFFFF;

    /* Parse 8.3 name */
    const parts = fileName.toUpperCase().split(".");
    const fn = (parts[0] || "").substring(0, 8).padEnd(8, " ");
    const fe = (parts[1] || "").substring(0, 3).padEnd(3, " ");

    /* Find free clusters */
    const clustersNeeded = Math.ceil(fileData.length / geo.bytesPerCluster) || 1;
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
        img.set(new Uint8Array(chunk), off);
        writeFATEntry(img, geo, c, (i < freeClusters.length - 1) ? freeClusters[i + 1] : eofMark);
    }

    /* Find or create directory entry */
    let dirOff = -1;

    /* Check if file already exists (overwrite) */
    for (let i = 0; i < geo.rootDirEntries; i++) {
        const o = geo.rootDirStart + i * 32;
        if (img[o] === 0x00 || img[o] === 0xE5) continue;
        let existName = "";
        for (let c = 0; c < 11; c++) existName += String.fromCharCode(img[o + c]);
        if (existName === fn + fe) {
            /* Free old clusters first */
            let oldC = img[o + 26] | (img[o + 27] << 8);
            while (oldC >= 2 && !isEOF(geo, oldC)) {
                const next = readFATEntry(img, geo, oldC);
                writeFATEntry(img, geo, oldC, 0x000);
                oldC = next;
            }
            dirOff = o;
            break;
        }
    }

    /* Find a free entry if not overwriting */
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
    img[dirOff + 11] = 0x20;
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
