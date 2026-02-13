"use strict";

/* ═══════════════════════════════════════════
 * File Manager UI
 * ═══════════════════════════════════════════ */

/** Refresh the file manager table */
function refreshFileManager() {
    /* Update drive label in section header */
    const isHDD = diskTypeSelect.value === "hdd";
    const driveLabel = $("fm-drive-label");
    if (driveLabel) driveLabel.textContent = isHDD ? "C:" : "B:";
    const driveName = isHDD ? "C:" : "B:";

    fmStatus.textContent = "Reading " + driveName + " drive...";
    fmTable.style.display = "none";
    fmTbody.innerHTML = "";

    const img = getDiskBytes();
    if (!img) {
        fmStatus.textContent = "Could not read " + driveName + " disk. Try saving the game first, then refresh.";
        return;
    }

    const geo = parseFATGeometry(img);
    if (!geo) {
        fmStatus.textContent = "Could not parse filesystem on " + driveName + " drive.";
        return;
    }

    const files = parseFATDir(img, geo);
    if (files.length === 0) {
        fmStatus.textContent = "No files found on " + driveName + " drive.";
        return;
    }

    fmStatus.textContent = files.length + " file(s) on " + driveName + " drive. (FAT" + geo.fatType + ")";
    fmTable.style.display = "";

    for (const f of files) {
        const tr = document.createElement("tr");

        const tdName = document.createElement("td");
        tdName.textContent = f.fullName + (f.isDir ? " [DIR]" : "");
        tr.appendChild(tdName);

        const tdSize = document.createElement("td");
        tdSize.textContent = f.isDir ? "-" : formatSize(f.size);
        tr.appendChild(tdSize);

        const tdAct = document.createElement("td");
        if (!f.isDir && f.size > 0) {
            const dlBtn = document.createElement("button");
            dlBtn.className = "btn-secondary btn-sm";
            dlBtn.textContent = "Download";
            dlBtn.addEventListener("click", () => downloadFile(f));
            tdAct.appendChild(dlBtn);
        }
        tr.appendChild(tdAct);

        fmTbody.appendChild(tr);
    }
}

/** Download a single file from the game disk */
function downloadFile(file) {
    const img = getDiskBytes();
    if (!img) { fmStatus.textContent = "Read error."; return; }
    const geo = parseFATGeometry(img);
    if (!geo) { fmStatus.textContent = "Filesystem parse error."; return; }
    const data = readFATFile(img, geo, file);
    triggerDownload(data, file.fullName, "application/octet-stream");
    fmStatus.textContent = "Downloaded " + file.fullName;
}

/** Upload file(s) to the game disk (floppy or HDD) */
function uploadFiles(fileList) {
    const img = getDiskBytesCopy();
    if (!img) { fmStatus.textContent = "Cannot access disk."; return; }
    const geo = parseFATGeometry(img);
    if (!geo) { fmStatus.textContent = "Cannot parse filesystem."; return; }

    let pending = fileList.length;
    let success = 0;

    for (const f of fileList) {
        const reader = new FileReader();
        reader.onload = function() {
            const data = new Uint8Array(reader.result);
            if (writeFATFile(img, geo, f.name, data)) success++;
            pending--;
            if (pending === 0) finishUpload(img, success, fileList.length);
        };
        reader.readAsArrayBuffer(f);
    }
}

async function finishUpload(img, success, total) {
    /* Write the modified image back to the emulator */
    const ok = await replaceDiskImage(img);
    if (ok) {
        fmStatus.textContent = "Uploaded " + success + "/" + total + " file(s). Type DIR in DOS to see them.";
        refreshFileManager();
    } else {
        fmStatus.textContent = "FAT write succeeded but could not push image back to emulator. Try saving/restoring machine state instead.";
    }
}

/** Download the entire game disk as a .img file */
function downloadFloppyImage() {
    const img = getDiskBytes();
    if (!img) { fmStatus.textContent = "Cannot read disk."; return; }
    /* Make a copy so we don't hand out the internal buffer */
    const dlName = gameSelect.value || "game-disk.img";
    triggerDownload(new Uint8Array(img), dlName, "application/octet-stream");
    const sizeLabel = (img.length / (1024*1024)).toFixed(1) + " MB";
    fmStatus.textContent = "Downloaded disk image (" + sizeLabel + ").";
}
