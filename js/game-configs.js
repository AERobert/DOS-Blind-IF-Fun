"use strict";

/*
 * Game Configuration Hub
 *
 * Initializes the KNOWN_GAMES registry. Individual game config files
 * in js/games/ each add their entry to this object.
 *
 * To add a new game, create a file in js/games/ like:
 *
 *   KNOWN_GAMES["my-game.img"] = {
 *       label: "My Game",
 *       autorun: "GAME.EXE",
 *       prompt: ">",
 *       depth: "below",
 *       disk: "floppy"
 *   };
 *
 * Then add a <script> tag for it in index.html after this file.
 *
 * Config properties:
 *   label     - Display name in the game selector dropdown
 *   autorun   - DOS command to execute after boot (e.g. "GAME.EXE")
 *   prompt    - The character(s) the game uses as its input prompt
 *   depth     - "last" = text between last two prompts; "below" = text after last prompt
 *   disk      - "floppy" (B: drive, FAT12) or "hdd" (C: drive, FAT16)
 *   graphics  - (optional) true if game uses EGA/VGA graphics mode
 *   textcap   - (optional) true to load TEXTCAP.COM TSR for graphics-mode text capture
 *   singleKey - (optional) true for menu-driven games (each keypress sent immediately)
 */
const KNOWN_GAMES = {};
