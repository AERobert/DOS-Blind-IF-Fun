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
 *   graphics  - (optional) true if game uses graphics mode
 *   textcap   - (optional) true to load TEXTCAP.COM TSR
 *   singleKey - (optional) true for menu-driven single-keypress games
 */

import tzero from './games/tzero.js';
import mindwheel from './games/mindwheel.js';
import timequest from './games/timequest.js';
import eamondx from './games/eamondx.js';
import humbug from './games/humbug.js';
import DungeonOfDunjin from './games/DungeonOfDunjin.js';
import World from './games/World.js';
import CastleRalf from './games/CastleRalf.js';

const gameList = [tzero, mindwheel, timequest, eamondx, humbug, DungeonOfDunjin, World, CastleRalf];

export const KNOWN_GAMES = {};
for (const game of gameList) {
    KNOWN_GAMES[game.filename] = game;
}
