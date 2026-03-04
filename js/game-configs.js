/*
 * Game Configuration Hub
 *
 * To add a new game:
 *   1. Create a file in js/games/ that exports a default config object
 *   2. Import it here and add it to the gameList array
 *
 * Config properties:
 *   filename  - Disk image filename (e.g. "my-game.img")
 *   label     - Display name in the game selector dropdown
 *   autorun   - DOS command to execute after boot
 *   prompt    - The character(s) the game uses as its input prompt
 *   depth     - "last" | "below" — response extraction mode
 *   disk      - "floppy" | "hdd"
 *   platform  - (optional) "dos" | "apple2" | "c64" | "bbc" (default: "dos")
 *   graphics  - (optional) true if game uses graphics mode
 *   textcap   - (optional) true to load TEXTCAP.COM TSR
 *   singleKey - (optional) true for menu-driven single-keypress games
 *   diskFormat - (optional) disk image format: "img","dsk","d64","ssd", etc.
 *   notes     - (optional) human-readable description of the game
 *   source    - (optional) where to obtain the disk image
 *   aliases   - (optional) array of command alias objects:
 *                Regex: { type:"regex", pattern, replace, global (default true), caseInsensitive (default false) }
 *                Macro: { type:"macro", pattern (trigger), replace (commands separated by ;) }
 */

/* ── DOS games ── */
import tzero from './games/tzero.js';
import mindwheel from './games/mindwheel.js';
import timequest from './games/timequest.js';
import eamondx from './games/eamondx.js';
import humbug from './games/humbug.js';
import DungeonOfDunjin from './games/DungeonOfDunjin.js';
import World from './games/world.js';
import CastleRalf from './games/castleralf.js';

/* ── Apple II games ── */
import apple2Zork1 from './games/apple2-zork1.js';
import apple2Hitchhiker from './games/apple2-hitchhiker.js';
import apple2Planetfall from './games/apple2-planetfall.js';

/* ── Commodore 64 games ── */
import c64Zork1 from './games/c64-zork1.js';
import c64Hitchhiker from './games/c64-hitchhiker.js';
import c64LurkingHorror from './games/c64-lurking-horror.js';

/* ── BBC Micro games ── */
import bbcColossal from './games/bbc-colossal.js';
import bbcAcheton from './games/bbc-acheton.js';
import bbcPhilosopher from './games/bbc-philosopher.js';
import bbcGiantKiller from './games/bbc-giant-killer.js';
import bbcQuondam from './games/bbc-quondam.js';

const gameList = [
    /* DOS */
    tzero, mindwheel, timequest, eamondx, humbug, DungeonOfDunjin, World, CastleRalf,
    /* Apple II */
    apple2Zork1, apple2Hitchhiker, apple2Planetfall,
    /* Commodore 64 */
    c64Zork1, c64Hitchhiker, c64LurkingHorror,
    /* BBC Micro */
    bbcColossal, bbcAcheton, bbcPhilosopher, bbcGiantKiller, bbcQuondam,
];

export const KNOWN_GAMES = {};
for (const game of gameList) {
    KNOWN_GAMES[game.filename] = game;
}

/**
 * Get games filtered by platform.
 * @param {string} platform - "dos", "apple2", "c64", "bbc"
 * @returns {object[]} Array of game config objects for the platform.
 */
export function getGamesByPlatform(platform) {
    return gameList.filter(g => (g.platform || "dos") === platform);
}
