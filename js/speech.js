"use strict";

/* ═══════════════════════════════════════════
 * Web Speech API
 * ═══════════════════════════════════════════ */

function loadVoices() {
    voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    voiceSelect.innerHTML = "";
    const english = voices.filter(v => v.lang.startsWith("en"));
    const others = voices.filter(v => !v.lang.startsWith("en"));

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
    if (saved && voices.find(v => v.voiceURI === saved)) {
        voiceSelect.value = saved;
    } else {
        for (const name of ["Samantha","Alex","Daniel","Karen","Fiona"]) {
            const m = voices.find(v => v.name.includes(name));
            if (m) { voiceSelect.value = m.voiceURI; break; }
        }
    }
}

speechSynthesis.addEventListener("voiceschanged", loadVoices);
/* loadVoices() is called from init.js after loadSettings() so savedVoice is available */

function getVoice() { return voices.find(v => v.voiceURI === voiceSelect.value) || null; }

function speak(text, interrupt) {
    if (interrupt !== false) speechSynthesis.cancel();
    if (!text || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = getVoice();
    if (v) u.voice = v;
    u.rate = parseFloat(rateSlider.value);
    u.pitch = parseFloat(pitchSlider.value);
    speechSynthesis.speak(u);
}

function stopSpeech() { speechSynthesis.cancel(); }
