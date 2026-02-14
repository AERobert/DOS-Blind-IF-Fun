"use strict";

/* ═══════ Init ═══════ */
loadSettings();
loadVoices();   /* must be after loadSettings() so savedVoice is available */
initBuffer();
initScreenDOM();
updateHistNav();
