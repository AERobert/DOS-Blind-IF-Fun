import { state, stateSaveBtn, stateRestoreBtn, fmStatus, gameSelect } from './state.js';
import { triggerDownload, formatSize } from './ui-helpers.js';
import { speak } from './speech.js';

/* ═══════════════════════════════════════════
 * Save / Restore Machine State
 * ═══════════════════════════════════════════ */

export async function saveState() {
    if (!state.emulator) return;
    stateSaveBtn.disabled = true;
    fmStatus.textContent = "Saving machine state...";

    try {
        const snapshot = await state.emulator.save_state();
        const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
        const gameName = (gameSelect.value || "game").replace(/\.img$/i, "");
        triggerDownload(new Uint8Array(snapshot), gameName + "-state-" + ts + ".v86state", "application/octet-stream");
        fmStatus.textContent = "State saved! File size: " + formatSize(snapshot.byteLength);
        speak("Machine state saved.");
    } catch(err) {
        fmStatus.textContent = "Save failed: " + err;
    }
    stateSaveBtn.disabled = false;
}

export function restoreState(file) {
    if (!state.emulator) return;
    stateRestoreBtn.disabled = true;
    fmStatus.textContent = "Restoring state from " + file.name + "...";

    const reader = new FileReader();
    reader.onload = async function() {
        try {
            await state.emulator.restore_state(reader.result);
            fmStatus.textContent = "State restored from " + file.name + ".";
            speak("Machine state restored.");
        } catch(err) {
            fmStatus.textContent = "Restore failed: " + err;
        }
        stateRestoreBtn.disabled = false;
        /* Re-sync screen buffer from emulator */
        state.pendingChanges = [];
    };
    reader.readAsArrayBuffer(file);
}
