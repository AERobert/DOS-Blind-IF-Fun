/* ═══════════════════════════════════════════
 * Web Speech API
 * ═══════════════════════════════════════════ */

import { state, voiceSelect, rateSlider, pitchSlider } from './state.js';

export function loadVoices() {
    state.voices = speechSynthesis.getVoices();
    if (!state.voices.length) return;
    voiceSelect.innerHTML = "";
    const english = state.voices.filter(v => v.lang.startsWith("en"));
    const others = state.voices.filter(v => !v.lang.startsWith("en"));

    function addGroup(label, list) {
        if (!list.length) return;
        const g = document.createElement("optgroup");
        g.label = label;
        for (const v of list) {
            const o = document.createElement("option");
            o.value = v.voiceURI;
            o.textContent = v.name + (v.default ? " (default)" : "");
            g.appendChild(o);
        }
        voiceSelect.appendChild(g);
    }
    addGroup("English", english);
    addGroup("Other Languages", others);

    /* Restore saved voice or pick a sensible default */
    const saved = voiceSelect.dataset.savedVoice;
    if (saved && state.voices.find(v => v.voiceURI === saved)) {
        voiceSelect.value = saved;
    } else {
        for (const name of ["Samantha","Alex","Daniel","Karen","Fiona"]) {
            const m = state.voices.find(v => v.name.includes(name));
            if (m) { voiceSelect.value = m.voiceURI; break; }
        }
    }
}

speechSynthesis.addEventListener("voiceschanged", loadVoices);
loadVoices();

export function getVoice() { return state.voices.find(v => v.voiceURI === voiceSelect.value) || null; }

export function speak(text, interrupt) {
    if (interrupt !== false) speechSynthesis.cancel();
    if (!text || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = getVoice();
    if (v) u.voice = v;
    u.rate = parseFloat(rateSlider.value);
    u.pitch = parseFloat(pitchSlider.value);
    speechSynthesis.speak(u);
}

export function stopSpeech() { speechSynthesis.cancel(); }
