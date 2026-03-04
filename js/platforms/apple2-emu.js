/*
 * Apple II Emulator Adapter
 *
 * Wraps an Apple II emulator (apple2js or compatible) to provide the
 * v86-compatible interface used by screen.js, commands.js, speech.js.
 *
 * TEXT SCREEN MEMORY
 * ─────────────────
 * The Apple II text display is 40 columns x 24 rows.
 * Text Page 1 is at $0400–$07FF with an interleaved row layout:
 *
 *   Row address = $0400 + floor(row / 8) * $28 + (row % 8) * $80
 *
 * Each row is 40 consecutive bytes.  There are 8-byte "holes" between
 * groups that the hardware doesn't display.
 *
 * CHARACTER ENCODING
 * ──────────────────
 * Apple II screen bytes:
 *   $00–$3F  Inverse video   →  ASCII = (byte & 0x3F) + 0x20  (ish)
 *   $40–$7F  Flashing video  →  ASCII = (byte & 0x3F) + 0x20
 *   $80–$FF  Normal video    →  ASCII = byte & 0x7F
 *
 * For text adventures the normal range ($80–$FF) is almost exclusively
 * used.  We apply  byte & 0x7F  and clamp to printable ASCII.
 *
 * EMULATOR LIBRARIES
 * ──────────────────
 * This adapter is written to work with:
 *   1. apple2js  (https://github.com/whscullin/apple2js)
 *   2. Any emulator that exposes:
 *        - A way to read memory (cpu.read(addr) or mem[addr])
 *        - A way to queue keyboard input
 *        - A canvas element for video output
 *
 * If no emulator library is loaded, the adapter runs in DEMO MODE:
 * it simulates a simple Apple II text screen you can type into,
 * proving the text-extraction pipeline works.
 *
 * DISK FORMATS:  .dsk  .do  .po  .woz  .nib
 */

import { EmulatorShim } from './emulator-shim.js';

/* ── Apple II screen geometry ── */
const ROWS = 24;
const COLS = 40;
const TEXT_PAGE_1 = 0x0400;

/** Compute the base memory address for a screen row (0-23). */
function rowAddr(row) {
    return TEXT_PAGE_1 + Math.floor(row / 8) * 0x28 + (row % 8) * 0x80;
}

/**
 * Convert an Apple II screen byte to a printable ASCII code.
 * Normal text:  byte & 0x7F gives the ASCII value.
 * Inverse/flash: same mapping but different video attribute.
 */
function screenByteToAscii(byte) {
    let ch;
    if (byte >= 0x80) {
        /* Normal video — most common for text adventures */
        ch = byte & 0x7F;
    } else if (byte >= 0x40) {
        /* Flashing video */
        ch = byte & 0x3F;
        if (ch < 0x20) ch += 0x40;
    } else {
        /* Inverse video */
        ch = byte & 0x3F;
        if (ch < 0x20) ch += 0x40;
    }
    /* Clamp to printable ASCII range */
    if (ch < 0x20 || ch > 0x7E) ch = 0x20;
    return ch;
}

/* ── Apple II key name → character code mapping ── */
const KEY_MAP = {
    "Enter":      0x0D,
    "Backspace":  0x08,  /* Apple II DELETE is $7F on IIe, $08 on II+ */
    "Escape":     0x1B,
    "ArrowLeft":  0x08,
    "ArrowRight": 0x15,
    "ArrowUp":    0x0B,
    "ArrowDown":  0x0A,
    "Tab":        0x09,
    " ":          0x20,
};

/* ═════════════════════════════════════════════════ */

export class Apple2Emulator extends EmulatorShim {
    constructor() {
        super();
        this._emu = null;       /* reference to the actual apple2js instance */
        this._io = null;        /* apple2js I/O object (keyboard, slots) */
        this._disk2 = null;     /* DiskII card instance */
        this._mem = null;       /* direct memory array (Uint8Array or accessor) */
        this._canvas = null;
        this._demoMode = false;
        this._demoScreen = [];  /* 24 x 40 character codes (demo fallback) */
        this._demoCursorR = 0;
        this._demoCursorC = 0;
    }

    get rows() { return ROWS; }
    get cols() { return COLS; }

    /* ── Boot ── */

    async _boot(config) {
        /*
         * Try to find an Apple II emulator library.
         *
         * Primary: apple2js UMD library (window.Apple2Lib)
         *   Apple2Lib.Apple2(options) → apple2 instance with:
         *     apple2.ready              — Promise that resolves when ROMs loaded
         *     apple2.getIO()            — keyboard: io.keyDown(ascii), io.setKeyBuffer(str)
         *     apple2.getMMU()           — memory:   mmu.read(page, offset)
         *     apple2.getCPU()           — CPU access
         *     apple2.run()              — start execution
         *
         * All Apple II ROMs (system + character) are bundled in the library.
         */
        const Apple2Lib = window.Apple2Lib;
        const AppleLib = window.Apple2 || window.apple2js;

        if (Apple2Lib && Apple2Lib.Apple2) {
            await this._bootApple2js(Apple2Lib, config);
        } else if (AppleLib && typeof AppleLib === "function") {
            await this._bootGeneric(AppleLib, config);
        } else {
            console.warn("Apple II emulator library not found — running in demo mode.");
            this._bootDemo(config);
        }
    }

    /**
     * Boot using the apple2js library (Will Scullin's emulator).
     * ROMs are built into the bundle — no external files needed.
     */
    async _bootApple2js(Lib, config) {
        console.log("Booting apple2js Apple IIe emulator...");

        /* Get or create a canvas for the emulator */
        const container = document.getElementById("v86-screen-container");
        this._canvas = container ? container.querySelector("canvas") : null;
        if (!this._canvas && container) {
            this._canvas = document.createElement("canvas");
            this._canvas.width = 560;
            this._canvas.height = 384;
            container.appendChild(this._canvas);
        }

        /* Create the Apple IIe emulator */
        const options = {
            canvas: this._canvas,
            rom: "apple2enh",           /* Enhanced Apple IIe */
            characterRom: "apple2enh_char",
            e: true,
            enhanced: true,
            gl: false,                  /* Use 2D canvas (more compatible) */
            tick: () => {},             /* No UI update callback needed */
        };

        try {
            this._emu = new Lib.Apple2(options);
            await this._emu.ready;
        } catch(err) {
            console.warn("apple2js init failed, falling back to demo:", err);
            this._bootDemo(config);
            return;
        }

        /* Get API references */
        const io = this._emu.getIO();
        const mmu = this._emu.getMMU();

        /* Set up memory accessor via MMU */
        if (mmu && typeof mmu.read === "function") {
            this._mem = {
                read: addr => mmu.read(addr >> 8, addr & 0xFF)
            };
        }

        /* Set up keyboard buffer */
        if (io && typeof io.setKeyBuffer === "function") {
            this._keyBuffer = str => io.setKeyBuffer(str);
        }

        /* Store IO reference for keyboard input */
        this._io = io;

        /* Optionally set up DiskII card for disk loading */
        if (Lib.DiskII && io) {
            try {
                const driveLights = { driveLight: () => {}, dirty: () => {} };
                this._disk2 = new Lib.DiskII(io, driveLights);
                io.setSlot(6, this._disk2);
            } catch(e) {
                console.warn("DiskII setup failed:", e);
            }
        }

        /* Start the emulator */
        this._emu.run();
        console.log("apple2js Apple IIe ready — MMU for text at $0400, keyboard via IO");
    }

    async _bootGeneric(Ctor, config) {
        const container = document.getElementById("v86-screen-container");
        this._canvas = container ? container.querySelector("canvas") : null;

        const emuConfig = {
            canvas: this._canvas,
            rom: config.rom || "apple2e.rom",
            disk: config.diskUrl || config.diskBuffer,
            enhanced: true,
        };

        if (typeof Ctor === "function") {
            this._emu = new Ctor(emuConfig);
        }

        if (this._emu) {
            if (this._emu.mmu && typeof this._emu.mmu.read === "function") {
                this._mem = {
                    read: addr => this._emu.mmu.read(addr >> 8, addr & 0xFF)
                };
            } else {
                this._mem = this._emu.ram || this._emu.memory || null;
                if (!this._mem && this._emu.cpu) {
                    this._mem = { read: addr => this._emu.cpu.read(addr) };
                }
            }

            if (this._emu.io && typeof this._emu.io.setKeyBuffer === "function") {
                this._keyBuffer = str => this._emu.io.setKeyBuffer(str);
            }

            if (this._emu.start) this._emu.start();
        }
    }

    /* ── Demo mode: simulated 40x24 text screen ── */

    _bootDemo(_config) {
        this._demoMode = true;
        for (let r = 0; r < ROWS; r++) {
            this._demoScreen[r] = new Uint8Array(COLS).fill(0xA0); /* normal space */
        }

        /* Show a welcome banner */
        const banner = [
            "APPLE ][ TEXT ADVENTURE PLAYER",
            "================================",
            "",
            "* Emulator library not loaded *",
            "",
            "This is a demo of the Apple II",
            "text screen extraction pipeline.",
            "",
            "To load a real emulator, add the",
            "apple2js library to this project.",
            "See: github.com/whscullin/apple2js",
            "",
            "Type below to test text input.",
            "",
            "]",  /* Apple II BASIC prompt */
        ];
        for (let i = 0; i < banner.length && i < ROWS; i++) {
            const line = banner[i];
            for (let c = 0; c < line.length && c < COLS; c++) {
                /* Store as normal video (high bit set) */
                this._demoScreen[i][c] = line.charCodeAt(c) | 0x80;
            }
        }
        this._demoCursorR = banner.length - 1;
        this._demoCursorC = 1; /* after the ] prompt */
    }

    /* ── Screen reading ── */

    _readScreenChar(r, c) {
        if (this._demoMode) {
            const byte = this._demoScreen[r] ? this._demoScreen[r][c] : 0xA0;
            return screenByteToAscii(byte);
        }
        const byte = this._readMem(rowAddr(r) + c);
        return screenByteToAscii(byte);
    }

    /** Read a byte from emulator memory. */
    _readMem(addr) {
        if (!this._mem) return 0xA0;
        if (this._mem instanceof Uint8Array || Array.isArray(this._mem)) {
            return this._mem[addr] || 0xA0;
        }
        if (typeof this._mem.read === "function") {
            return this._mem.read(addr);
        }
        if (typeof this._mem === "function") {
            return this._mem(addr);
        }
        return 0xA0;
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
         * Priority of input methods:
         * 1. apple2js io.setKeyBuffer() — buffers an entire string
         * 2. apple2js io.keyDown(ascii) — single key latch
         * 3. Generic keyboard handler
         */
        if (this._keyBuffer) {
            this._keyBuffer(ch);
        } else if (this._io && typeof this._io.keyDown === "function") {
            this._io.keyDown(code);
        } else if (this._emu.io && typeof this._emu.io.keyDown === "function") {
            this._emu.io.keyDown(code);
        } else if (this._emu.keyboard && this._emu.keyboard.keyDown) {
            this._emu.keyboard.keyDown({ key: ch, keyCode: code });
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
            if (this._keyBuffer && name === "Enter") {
                this._keyBuffer("\r");  /* Apple II uses CR for Return */
            } else if (this._io && typeof this._io.keyDown === "function") {
                this._io.keyDown(code);
            } else if (this._emu.io && typeof this._emu.io.keyDown === "function") {
                this._emu.io.keyDown(code);
            } else if (this._emu.keyboard && this._emu.keyboard.keyDown) {
                this._emu.keyboard.keyDown({ key: name, keyCode: code });
            }
        }
    }

    /* ── Demo mode input handling ── */

    _demoType(ch) {
        const r = this._demoCursorR, c = this._demoCursorC;
        if (c < COLS) {
            this._demoScreen[r][c] = ch.charCodeAt(0) | 0x80;
            this._demoCursorC++;
        }
    }

    _demoEnter() {
        /* Scroll and move to next line */
        this._demoCursorR++;
        if (this._demoCursorR >= ROWS) {
            /* Scroll up */
            for (let r = 0; r < ROWS - 1; r++) {
                this._demoScreen[r] = this._demoScreen[r + 1];
            }
            this._demoScreen[ROWS - 1] = new Uint8Array(COLS).fill(0xA0);
            this._demoCursorR = ROWS - 1;
        }
        /* Print a ] prompt */
        this._demoScreen[this._demoCursorR][0] = 0xDD; /* ] in normal video */
        this._demoCursorC = 1;
    }

    _demoBackspace() {
        if (this._demoCursorC > 1) {
            this._demoCursorC--;
            this._demoScreen[this._demoCursorR][this._demoCursorC] = 0xA0;
        }
    }

    /* ── Cleanup ── */

    _destroy() {
        if (this._emu && this._emu.stop) this._emu.stop();
        if (this._emu && this._emu.destroy) this._emu.destroy();
        this._emu = null;
        this._mem = null;
    }
}

/* ── Factory ── */

export function createApple2Emulator() {
    return new Apple2Emulator();
}

/* ── Platform metadata ── */

export const APPLE2_INFO = {
    id: "apple2",
    name: "Apple II",
    screenRows: ROWS,
    screenCols: COLS,
    charEncoding: "Apple II ASCII (high-bit normal/inverse/flash)",
    diskFormats: [".dsk", ".do", ".po", ".woz", ".nib"],
    emulatorLibrary: "apple2js (https://github.com/whscullin/apple2js)",
    textMemory: "$0400-$07FF (Text Page 1, interleaved rows)",
    notes: [
        "Apple II text mode is 40x24 characters.",
        "Screen memory uses an interleaved row layout unique to the Apple II.",
        "Character bytes: $00-$3F=inverse, $40-$7F=flash, $80-$FF=normal.",
        "The Apple IIe adds lowercase support (chars $E0-$FF).",
        "Most text adventures use 40-column mode exclusively.",
        "Infocom games (Zork, Hitchhiker's Guide) work on Apple II.",
    ],
    textAdventures: [
        {
            name: "Zork I: The Great Underground Empire",
            publisher: "Infocom",
            year: 1981,
            format: ".dsk",
            notes: "The classic that started it all. Available legally as freeware.",
            source: "https://ifarchive.org/ (search for Zork Apple II)",
        },
        {
            name: "Zork II: The Wizard of Frobozz",
            publisher: "Infocom",
            year: 1981,
            format: ".dsk",
            notes: "Sequel to Zork I.",
        },
        {
            name: "Zork III: The Dungeon Master",
            publisher: "Infocom",
            year: 1982,
            format: ".dsk",
            notes: "Final chapter of the original Zork trilogy.",
        },
        {
            name: "The Hitchhiker's Guide to the Galaxy",
            publisher: "Infocom",
            year: 1984,
            format: ".dsk",
            notes: "Douglas Adams collaborated on this classic.",
        },
        {
            name: "Planetfall",
            publisher: "Infocom",
            year: 1983,
            format: ".dsk",
            notes: "Sci-fi comedy adventure by Steve Meretzky.",
        },
        {
            name: "Enchanter",
            publisher: "Infocom",
            year: 1983,
            format: ".dsk",
            notes: "Fantasy adventure in the Zork universe.",
        },
        {
            name: "Colossal Cave Adventure",
            publisher: "Various ports",
            year: 1977,
            format: ".dsk",
            notes: "The original text adventure. Multiple Apple II versions exist.",
        },
        {
            name: "Scott Adams Adventures (12 games)",
            publisher: "Adventure International",
            year: 1980,
            format: ".dsk",
            notes: "Adventureland, Pirate Adventure, Mission Impossible, etc.",
        },
    ],
};
