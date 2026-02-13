"use strict";

/* ═══════════════════════════════════════════
 * Save / Restore Machine State
 * ═══════════════════════════════════════════ */

async function saveState() {
    if (!emulator) return;
    stateSaveBtn.disabled = true;
    fmStatus.textContent = "Saving machine state...";

    try {
        const state = await emulator.save_state();
        const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
        const gameName = (gameSelect.value || "game").replace(/\.img$/i, "");
        triggerDownload(new Uint8Array(state), gameName + "-state-" + ts + ".v86state", "application/octet-stream");
        fmStatus.textContent = "State saved! File size: " + formatSize(state.byteLength);
        speak("Machine state saved.");
    } catch(err) {
        fmStatus.textContent = "Save failed: " + err;
    }
    stateSaveBtn.disabled = false;
}

function restoreState(file) {
    if (!emulator) return;
    stateRestoreBtn.disabled = true;
    fmStatus.textContent = "Restoring state from " + file.name + "...";

    const reader = new FileReader();
    reader.onload = async function() {
        try {
            await emulator.restore_state(reader.result);
            fmStatus.textContent = "State restored from " + file.name + ".";
            speak("Machine state restored.");
        } catch(err) {
            fmStatus.textContent = "Restore failed: " + err;
        }
        stateRestoreBtn.disabled = false;
        /* Re-sync screen buffer from emulator */
        pendingChanges = [];
    };
    reader.readAsArrayBuffer(file);
}
