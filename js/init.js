/* ═══════════════════════════════════════════
 * Application Entry Point
 *
 * Single module that imports all other modules, triggering their
 * side-effect initialization (event listeners, etc.), then runs
 * the startup sequence.
 * ═══════════════════════════════════════════ */

/* Core modules (order doesn't matter for ES modules — the dependency
   graph determines actual execution order) */
import { loadSettings } from './settings.js';
import { initBuffer, initScreenDOM } from './screen.js';
import { updateHistNav } from './history.js';

/* Side-effect modules — importing them registers their event listeners */
import './games.js';
import './file-storage.js';
import './event-handlers.js';
import './game-packager.js';
import './devices.js';
import './aliases.js';

/* ── Startup ── */
loadSettings();
initBuffer();
initScreenDOM();
updateHistNav();
