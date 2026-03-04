/*
 * BBC Micro Emulator Adapter
 *
 * Wraps jsbeeb (or compatible) to provide the v86-compatible interface
 * used by screen.js, commands.js, speech.js.
 *
 * TEXT SCREEN MODES
 * ─────────────────
 * The BBC Micro has several display modes.  For text adventures, the
 * most relevant are:
 *
 *   Mode 0:  80x32, 2-colour bitmap   — characters in font ROM
 *   Mode 3:  80x25, 2-colour bitmap   — teletext-style but bitmap rendered
 *   Mode 7:  40x25, teletext (SAA5050) — character data at $7C00-$7FFF
 *
 * Mode 7 is the only true character-mapped mode.  In Mode 7, each byte
 * at $7C00+ is a teletext character code (basically ASCII for printable
 * characters, with control codes for colours/graphics).
 *
 * For bitmap modes (0, 1, 2, 3, 4, 5, 6), characters are drawn as
 * pixels via the VDU driver.  To extract text from these modes we
 * hook the OSWRCH output vector or maintain a shadow buffer.
 *
 * APPROACH
 * ────────
 * 1. For Mode 7: read screen memory directly at $7C00
 * 2. For bitmap modes: intercept writes via OSWRCH ($FFEE) or read
 *    the OS workspace variables that track cursor position and
 *    maintain a shadow text buffer
 * 3. The MOS stores useful state in zero page and page 3:
 *      $0318-$0319: WRCHV (write character vector)
 *      $D0:         VDU status
 *      $0352:       current text column
 *      $0353:       current text row
 *      etc.
 *
 * EMULATOR LIBRARY
 * ────────────────
 * Primary target: jsbeeb (https://github.com/mattgodbolt/jsbeeb)
 * Matt Godbolt's excellent BBC Micro emulator.
 *
 * DISK FORMATS:  .ssd  .dsd  .uef  .csw  .sth
 */

import { EmulatorShim } from './emulator-shim.js';

/* ── BBC Micro screen geometry ── */
const ROWS = 25;     /* Mode 7 (and Mode 3) */
const COLS = 40;     /* Mode 7 — Mode 0/3 use 80 cols but we cap at 80 */
const MODE7_BASE = 0x7C00;  /* Mode 7 screen RAM start */

/* ── Teletext control codes to skip ── */
function isTeletextControl(byte) {
    /* Teletext control codes are 0x00-0x1F (except space 0x20+) */
    return byte < 0x20;
}

/**
 * Convert a Mode 7 teletext byte to ASCII.
 * Teletext uses a character set very close to ASCII.
 * Control codes (colors, double height, etc.) map to space.
 */
function teletextToAscii(byte) {
    if (byte >= 0x20 && byte <= 0x7E) return byte;  /* Standard ASCII */
    if (byte === 0x7F) return 0x20;  /* DEL → space */
    return 0x20;  /* Control codes → space */
}

/* ── Keyboard: BBC Micro key codes ── */
const KEY_MAP = {
    "Enter":      13,
    "Backspace":  127,  /* DELETE on BBC Micro */
    "Escape":     27,
    "ArrowLeft":  136,  /* COPY + 128? Actually it's key code dependent */
    "ArrowRight": 137,
    "ArrowUp":    139,
    "ArrowDown":  138,
    " ":          32,
    "Tab":        9,
};

/* BBC Micro MOS workspace addresses */
const MOS = {
    MODE:         0x0355,  /* Current screen mode */
    TEXT_COL:     0x0318,  /* Horizontal text cursor (WRCHV) */
    TEXT_ROW:     0x0319,  /* Vertical text cursor */
    WRCHV:        0x020E,  /* Write character vector (low byte) */
    WRCHV_HI:     0x020F,  /* Write character vector (high byte) */
    HIMEM:        0x0006,  /* HIMEM low byte */
};

/* ═════════════════════════════════════════════════ */

export class BBCEmulator extends EmulatorShim {
    constructor() {
        super();
        this._emu = null;       /* reference to jsbeeb instance */
        this._cpu = null;       /* 6502 CPU reference */
        this._canvas = null;
        this._demoMode = false;
        this._demoScreen = [];  /* 25 x 40/80 character buffer */
        this._demoCursorR = 0;
        this._demoCursorC = 0;
        this._demoCols = COLS;

        /* Shadow text buffer for bitmap modes */
        this._shadowScreen = [];
        this._shadowRows = ROWS;
        this._shadowCols = COLS;
        this._currentMode = 7;  /* default to Mode 7 */

        /* OSWRCH hook state */
        this._oswrchHooked = false;
        this._shadowCursorR = 0;
        this._shadowCursorC = 0;
    }

    get rows() { return this._currentMode === 7 ? 25 : (this._currentMode <= 2 ? 32 : 25); }
    get cols() { return (this._currentMode === 0 || this._currentMode === 3) ? 80 : 40; }

    /* ── Boot ── */

    async _boot(config) {
        /*
         * Try to find a BBC Micro emulator library.
         *
         * Primary: jsbeeb library (window.JsbeebLib)
         *   JsbeebLib.create(options) → emulator with:
         *     emu.processor                — Cpu6502 instance
         *     emu.readMem(addr)            — read any memory address
         *     emu.keyDown(code, shift)     — press a key
         *     emu.keyUp(code)              — release a key
         *     emu.loadDisc(drive, name, data) — load disc image
         *
         * ROM files served from lib/jsbeeb/roms/ (OS, BASIC, DFS).
         */
        const JsbeebLib = window.JsbeebLib;
        const GenericLib = window.jsbeeb || window.Jsbeeb || window.BBCMicro;

        if (JsbeebLib && typeof JsbeebLib.create === "function") {
            await this._bootJsbeeb(JsbeebLib, config);
        } else if (GenericLib) {
            await this._bootGeneric(GenericLib, config);
        } else {
            console.warn("BBC Micro emulator library (jsbeeb) not found — running in demo mode.");
            this._bootDemo(config);
        }
    }

    /**
     * Boot using the jsbeeb library (Matt Godbolt's BBC Micro emulator).
     * ROM files (OS, BASIC, DFS) must be served from lib/jsbeeb/roms/.
     */
    async _bootJsbeeb(Lib, config) {
        console.log("Booting jsbeeb BBC Micro emulator...");

        /* Get or create a canvas */
        const container = document.getElementById("v86-screen-container");
        this._canvas = container ? container.querySelector("canvas") : null;
        if (!this._canvas && container) {
            this._canvas = document.createElement("canvas");
            this._canvas.width = 896;
            this._canvas.height = 560;
            container.appendChild(this._canvas);
        }

        try {
            const bbcEmu = await Lib.create({
                model: config.model || "B-DFS1.2",
                canvas: this._canvas,
            });

            this._emu = bbcEmu;
            this._cpu = bbcEmu.processor;

            /* Set up memory reading via the processor */
            if (this._cpu && typeof this._cpu.readmem === "function") {
                /* readmem is the jsbeeb method for reading memory */
            }

            /* Set up shadow buffer for bitmap modes */
            this._setupShadowBuffer();

            /* Start the emulator */
            if (bbcEmu.start) bbcEmu.start();

            /* Set up OSWRCH interception for bitmap modes */
            this._setupOswrchHook();

            /* Load disc if provided */
            if (config.diskUrl && !config.diskBuffer) {
                try {
                    const resp = await fetch(config.diskUrl);
                    if (resp.ok) {
                        config.diskBuffer = await resp.arrayBuffer();
                    }
                } catch(e) {
                    console.warn("Could not fetch disc image:", config.diskUrl, e);
                }
            }

            if (config.diskBuffer && bbcEmu.loadDisc) {
                const name = config.filename || "game.ssd";
                bbcEmu.loadDisc(0, name, new Uint8Array(config.diskBuffer));
            }

            console.log("jsbeeb BBC Micro ready — Mode 7 text at $7C00");
        } catch(err) {
            console.warn("jsbeeb init failed, falling back to demo:", err);
            this._bootDemo(config);
        }
    }

    async _bootGeneric(Lib, config) {
        const container = document.getElementById("v86-screen-container");
        this._canvas = container ? container.querySelector("canvas") : null;

        const emuConfig = {
            canvas: this._canvas,
            model: config.model || "B",
            disk: config.diskUrl || config.diskBuffer,
        };

        if (typeof Lib === "function") {
            this._emu = new Lib(emuConfig);
        } else if (Lib.create) {
            this._emu = await Lib.create(emuConfig);
        } else if (Lib.boot) {
            this._emu = await Lib.boot(emuConfig);
        }

        if (this._emu) {
            this._cpu = this._emu.cpu || this._emu._6502 || this._emu.processor || null;
            this._machineSession = this._emu.machineSession || this._emu.session || null;
            this._setupShadowBuffer();
            if (this._emu.start) this._emu.start();
            if (this._emu.run) this._emu.run();
            this._setupOswrchHook();
        }
    }

    _setupShadowBuffer() {
        this._shadowScreen = [];
        for (let r = 0; r < 32; r++) {  /* Max 32 rows (modes 0-2) */
            this._shadowScreen[r] = new Uint8Array(80).fill(0x20);
        }
    }

    /**
     * Hook OSWRCH ($FFEE) to capture character output in bitmap modes.
     *
     * jsbeeb exposes processor.debugInstruction — a hook that fires before
     * every instruction.  We use it to intercept calls to OSWRCH at $FFEE.
     * When the CPU hits $FFEE, the character being output is in the A register.
     *
     * This gives us text output regardless of screen mode (even bitmap modes
     * where characters are rendered as pixels and can't be read from memory).
     */
    _setupOswrchHook() {
        if (!this._cpu) return;
        const self = this;

        /*
         * jsbeeb debug hook: processor.debugInstruction.add(fn)
         * fn(addr) is called before every instruction at address `addr`.
         */
        if (this._cpu.debugInstruction && typeof this._cpu.debugInstruction.add === "function") {
            this._cpu.debugInstruction.add(function(addr) {
                if (addr === 0xFFEE) {
                    /* OSWRCH entry — character in A register */
                    const ch = self._cpu.a;
                    self._handleOswrchChar(ch);
                }
            });
            this._oswrchHooked = true;
            console.log("BBC Micro: OSWRCH hook installed via debugInstruction");
        } else {
            /*
             * Fallback: periodically read MOS workspace to track cursor position
             * and attempt to read screen content.  For Mode 7, read directly.
             */
            this._oswrchHooked = false;
        }
    }

    /**
     * Process a character intercepted from OSWRCH.
     * Updates the shadow text buffer used for bitmap-mode text extraction.
     */
    _handleOswrchChar(ch) {
        if (ch === 13) {
            /* Carriage return — move to start of next line */
            this._shadowCursorC = 0;
            this._shadowCursorR++;
            if (this._shadowCursorR >= this._shadowRows) {
                /* Scroll the shadow buffer up */
                for (let r = 0; r < this._shadowRows - 1; r++) {
                    this._shadowScreen[r] = this._shadowScreen[r + 1];
                }
                this._shadowScreen[this._shadowRows - 1] = new Uint8Array(this._shadowCols).fill(0x20);
                this._shadowCursorR = this._shadowRows - 1;
            }
        } else if (ch === 10) {
            /* Line feed — usually paired with CR, handled above */
        } else if (ch === 127) {
            /* Delete — move cursor back and erase */
            if (this._shadowCursorC > 0) {
                this._shadowCursorC--;
                this._shadowScreen[this._shadowCursorR][this._shadowCursorC] = 0x20;
            }
        } else if (ch >= 32 && ch <= 126) {
            /* Printable character */
            const r = this._shadowCursorR, c = this._shadowCursorC;
            if (r < this._shadowRows && c < this._shadowCols) {
                this._shadowScreen[r][c] = ch;
                this._shadowCursorC++;
                if (this._shadowCursorC >= this._shadowCols) {
                    this._shadowCursorC = 0;
                    this._shadowCursorR++;
                    if (this._shadowCursorR >= this._shadowRows) {
                        for (let rr = 0; rr < this._shadowRows - 1; rr++) {
                            this._shadowScreen[rr] = this._shadowScreen[rr + 1];
                        }
                        this._shadowScreen[this._shadowRows - 1] = new Uint8Array(this._shadowCols).fill(0x20);
                        this._shadowCursorR = this._shadowRows - 1;
                    }
                }
            }
        }
        /* VDU control codes 0-31 (except CR/LF/DEL) are ignored for now.
         * A fuller implementation would handle VDU 12 (CLS), VDU 30 (HOME),
         * VDU 31,x,y (TAB), etc. */
    }

    /* ── Demo mode ── */

    _bootDemo(_config) {
        this._demoMode = true;
        this._demoCols = COLS;  /* Mode 7 */
        for (let r = 0; r < ROWS; r++) {
            this._demoScreen[r] = new Uint8Array(this._demoCols).fill(0x20);
        }

        const banner = [
            "BBC Computer 32K",
            "",
            "Acorn DFS",
            "",
            "BASIC",
            "",
            ">",
        ];

        const info = [
            "",
            "* Emulator library not loaded *",
            "",
            "This is a demo of the BBC Micro",
            "text screen extraction pipeline.",
            "",
            "To load a real emulator, add",
            "jsbeeb to this project.",
            "See: github.com/mattgodbolt/jsbeeb",
            "",
            "Type below to test text input.",
            "",
            ">",
        ];

        const allLines = banner.concat(info);
        for (let i = 0; i < allLines.length && i < ROWS; i++) {
            for (let c = 0; c < allLines[i].length && c < this._demoCols; c++) {
                this._demoScreen[i][c] = allLines[i].charCodeAt(c);
            }
        }
        this._demoCursorR = Math.min(allLines.length - 1, ROWS - 1);
        this._demoCursorC = 1;  /* After the > prompt */
    }

    /* ── Screen reading ── */

    _readScreenChar(r, c) {
        if (this._demoMode) {
            const byte = this._demoScreen[r] ? this._demoScreen[r][c] : 0x20;
            return (byte >= 0x20 && byte <= 0x7E) ? byte : 0x20;
        }

        /* Detect current mode from MOS workspace */
        if (this._cpu) {
            const mode = this._readMem(MOS.MODE) & 0x07;
            if (mode !== this._currentMode) {
                this._currentMode = mode;
            }
        }

        if (this._currentMode === 7) {
            return this._readMode7Char(r, c);
        }

        /* For bitmap modes, use shadow buffer if available */
        if (this._shadowScreen[r] && c < this._shadowScreen[r].length) {
            return this._shadowScreen[r][c] || 0x20;
        }
        return 0x20;
    }

    /**
     * Read a character from Mode 7 teletext screen memory.
     * Mode 7 screen RAM is at $7C00, 40 bytes per row, 25 rows.
     */
    _readMode7Char(r, c) {
        if (c >= 40) return 0x20;  /* Mode 7 is always 40 columns */
        const addr = MODE7_BASE + r * 40 + c;
        const byte = this._readMem(addr);
        return teletextToAscii(byte);
    }

    /** Read a byte from emulator memory. */
    _readMem(addr) {
        if (!this._cpu) return 0x20;
        if (typeof this._cpu.readmem === "function") {
            return this._cpu.readmem(addr);
        }
        if (typeof this._cpu.read === "function") {
            return this._cpu.read(addr);
        }
        if (this._cpu.memory) {
            const mem = this._cpu.memory;
            if (mem instanceof Uint8Array || Array.isArray(mem)) {
                return mem[addr] || 0x20;
            }
        }
        if (this._emu && this._emu.ram) {
            return this._emu.ram[addr] || 0x20;
        }
        return 0x20;
    }

    /* ── Keyboard input ── */

    _sendChar(ch) {
        if (this._demoMode) {
            this._demoType(ch);
            return;
        }
        if (!this._emu) return;

        const code = ch.charCodeAt(0);

        /*
         * Input priority:
         * 1. jsbeeb library API — keyDown/keyUp on the emulator wrapper
         * 2. jsbeeb sysvia — direct VIA keyboard matrix
         * 3. Generic queue/type methods
         */
        if (this._emu.keyDown && typeof this._emu.keyDown === "function") {
            this._emu.keyDown(code, false);
            setTimeout(() => this._emu.keyUp(code), 50);
        } else if (this._cpu && this._cpu.sysvia &&
                   typeof this._cpu.sysvia.keyDown === "function") {
            this._cpu.sysvia.keyDown(code, false);
            setTimeout(() => this._cpu.sysvia.keyUp(code), 50);
        } else if (this._emu.handler && this._emu.handler.keyDown) {
            this._emu.handler.keyDown({
                which: code, preventDefault() {}, key: ch, shiftKey: false
            });
            setTimeout(() => {
                this._emu.handler.keyUp({
                    which: code, preventDefault() {}, key: ch, shiftKey: false
                });
            }, 50);
        } else if (this._emu.queueKey) {
            this._emu.queueKey(code);
        } else if (this._emu.type) {
            this._emu.type(ch);
        }
    }

    _sendKey(name) {
        if (this._demoMode) {
            if (name === "Enter") this._demoEnter();
            else if (name === "Backspace") this._demoBackspace();
            return;
        }
        if (!this._emu) return;

        const code = KEY_MAP[name];
        if (code !== undefined) {
            if (this._emu.keyDown && typeof this._emu.keyDown === "function") {
                this._emu.keyDown(code, name === "Backspace" || false);
                setTimeout(() => this._emu.keyUp(code), 50);
            } else if (this._cpu && this._cpu.sysvia &&
                       typeof this._cpu.sysvia.keyDown === "function") {
                this._cpu.sysvia.keyDown(code, false);
                setTimeout(() => this._cpu.sysvia.keyUp(code), 50);
            } else if (this._emu.handler && this._emu.handler.keyDown) {
                this._emu.handler.keyDown({
                    which: code, preventDefault() {}, key: name, shiftKey: false
                });
                setTimeout(() => {
                    this._emu.handler.keyUp({
                        which: code, preventDefault() {}, key: name, shiftKey: false
                    });
                }, 50);
            } else if (this._emu.queueKey) {
                this._emu.queueKey(code);
            }
        }
    }

    /**
     * Press a key via the BBC Micro's System VIA keyboard matrix.
     * The BBC Micro keyboard is a 10x8 matrix scanned by the 6522 System VIA.
     * jsbeeb's sysvia module handles the matrix internally.
     */
    _pressKeyVia(ch) {
        if (this._emu.sysvia && typeof this._emu.sysvia.keyDown === "function") {
            this._emu.sysvia.keyDown(ch.charCodeAt(0));
            setTimeout(() => this._emu.sysvia.keyUp(ch.charCodeAt(0)), 50);
        } else if (this._emu.queueKey) {
            this._emu.queueKey(ch.charCodeAt(0));
        }
    }

    /* ── Demo mode input ── */

    _demoType(ch) {
        const r = this._demoCursorR, c = this._demoCursorC;
        if (c < this._demoCols) {
            this._demoScreen[r][c] = ch.charCodeAt(0);
            this._demoCursorC++;
        }
    }

    _demoEnter() {
        this._demoCursorR++;
        if (this._demoCursorR >= ROWS) {
            for (let r = 0; r < ROWS - 1; r++) {
                this._demoScreen[r] = this._demoScreen[r + 1];
            }
            this._demoScreen[ROWS - 1] = new Uint8Array(this._demoCols).fill(0x20);
            this._demoCursorR = ROWS - 1;
        }
        /* Print a > prompt */
        this._demoScreen[this._demoCursorR][0] = 0x3E; /* > */
        this._demoCursorC = 1;
    }

    _demoBackspace() {
        if (this._demoCursorC > 1) {
            this._demoCursorC--;
            this._demoScreen[this._demoCursorR][this._demoCursorC] = 0x20;
        }
    }

    /* ── Cleanup ── */

    _destroy() {
        if (this._emu && this._emu.stop) this._emu.stop();
        if (this._emu && this._emu.destroy) this._emu.destroy();
        this._emu = null;
        this._cpu = null;
    }
}

/* ── Factory ── */

export function createBBCEmulator() {
    return new BBCEmulator();
}

/* ── Platform metadata ── */

export const BBC_INFO = {
    id: "bbc",
    name: "BBC Micro",
    screenRows: ROWS,
    screenCols: COLS,
    charEncoding: "ASCII / Teletext (Mode 7)",
    diskFormats: [".ssd", ".dsd", ".uef", ".csw", ".sth"],
    emulatorLibrary: "jsbeeb (https://github.com/mattgodbolt/jsbeeb)",
    textMemory: {
        mode7: "$7C00-$7FFF (1000 bytes, 40x25 teletext characters)",
        bitmap: "Character data rendered via VDU driver (OSWRCH at $FFEE)",
    },
    notes: [
        "Mode 7 (teletext) is the most text-friendly display mode.",
        "Mode 7 characters are stored as ASCII-compatible bytes at $7C00.",
        "Bitmap text modes (0, 3, 6) render characters as pixels.",
        "For bitmap modes, text must be captured via OSWRCH interception.",
        "jsbeeb by Matt Godbolt is the definitive browser-based BBC emulator.",
        "The BBC Micro had a thriving text adventure scene in the UK.",
        "Level 9 Computing produced many classic adventures for the BBC.",
    ],
    textAdventures: [
        {
            name: "Colossal Adventure",
            publisher: "Level 9 Computing",
            year: 1983,
            format: ".ssd",
            notes: "Extended version of Colossal Cave Adventure with 70+ extra rooms.",
            source: "Level 9 games are available from various preservation sites.",
        },
        {
            name: "Adventure Quest",
            publisher: "Level 9 Computing",
            year: 1983,
            format: ".ssd",
            notes: "Sequel to Colossal Adventure. Fantasy adventure.",
        },
        {
            name: "Dungeon Adventure",
            publisher: "Level 9 Computing",
            year: 1983,
            format: ".ssd",
            notes: "Third in the Middle Earth trilogy.",
        },
        {
            name: "Snowball",
            publisher: "Level 9 Computing",
            year: 1983,
            format: ".ssd",
            notes: "Sci-fi adventure set on a generation starship.",
        },
        {
            name: "Return to Eden",
            publisher: "Level 9 Computing",
            year: 1984,
            format: ".ssd",
            notes: "Sequel to Snowball.",
        },
        {
            name: "Acheton",
            publisher: "Acornsoft",
            year: 1983,
            format: ".ssd",
            notes: "Massive cave adventure with 400+ locations. BBC Micro classic.",
        },
        {
            name: "Philosopher's Quest",
            publisher: "Acornsoft",
            year: 1982,
            format: ".ssd",
            notes: "Originally 'Brand X'. Surreal text adventure.",
        },
        {
            name: "Castle of Riddles",
            publisher: "Acornsoft",
            year: 1983,
            format: ".ssd",
            notes: "Puzzle-focused adventure.",
        },
        {
            name: "Zork I",
            publisher: "Infocom",
            year: 1984,
            format: ".ssd",
            notes: "BBC Micro port of the Infocom classic.",
        },
        {
            name: "Elite (text interface)",
            publisher: "Acornsoft",
            year: 1984,
            format: ".ssd",
            notes: "Not a text adventure, but the BBC's most famous game. Has text I/O for trading.",
        },
    ],
};
