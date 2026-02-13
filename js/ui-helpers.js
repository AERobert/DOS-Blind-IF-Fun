"use strict";

/* ═══════════════════════════════════════════
 * UI Helpers
 * ═══════════════════════════════════════════ */

function setStatus(s, m) { statusEl.textContent = m; statusEl.className = s; }

/** Push a message to the aria-live announcer for screen readers */
function announce(msg) {
    announcer.textContent = "";
    setTimeout(function() { announcer.textContent = msg; }, 100);
}

function enableInput() {
    isReady = true;
    commandInput.disabled = false;
    commandInput.placeholder = "Type command here...";
    sendBtn.disabled = false;
    enterOnlyBtn.disabled = false;
    speakScreenBtn.disabled = false;
    speakNewBtn.disabled = false;
    speakLastBtn.disabled = false;
    fmRefreshBtn.disabled = false;
    fmUploadBtn.disabled = false;
    fmDlFloppyBtn.disabled = false;
    stateSaveBtn.disabled = false;
    stateRestoreBtn.disabled = false;
    recordBtn.disabled = false;
    commandInput.focus();
}

/** Trigger a browser download */
function triggerDownload(data, filename, mime) {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    return (bytes / 1024).toFixed(1) + " KB";
}
