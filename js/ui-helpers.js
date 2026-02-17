/* ═══════════════════════════════════════════
 * UI Helpers
 * ═══════════════════════════════════════════ */

import { state, statusEl, announcer, commandInput,
         sendBtn, enterOnlyBtn, speakScreenBtn, speakNewBtn, speakLastBtn,
         fmRefreshBtn, fmUploadBtn, fmDlFloppyBtn,
         stateSaveBtn, stateRestoreBtn, recordBtn } from './state.js';

export function setStatus(s, m) { statusEl.textContent = m; statusEl.className = s; }

/** Push a message to the aria-live announcer for screen readers */
export function announce(msg) {
    announcer.textContent = "";
    setTimeout(function() { announcer.textContent = msg; }, 100);
}

export function enableInput() {
    state.isReady = true;
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
export function triggerDownload(data, filename, mime) {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

export function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
