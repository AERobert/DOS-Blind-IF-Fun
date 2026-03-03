/*
 * Commodore 64 Emulator Adapter
 *
 * Wraps a C64 emulator to provide the v86-compatible interface used by
 * screen.js, commands.js, speech.js.
 *
 * TEXT SCREEN MEMORY
 * ──────────────────
 * The C64 has a 40x25 text screen.  Default screen RAM is at $0400-$07E7
 * (1000 bytes).  Color RAM is at $D800-$DBE7 (we ignore color for text
 * extraction).  The VIC-II chip's register at $D018 bits 4-7 select the
 * screen memory base address, but $0400 is the default and what the
 * KERNAL sets up on boot.
 *
 * SCREEN CODES vs PETSCII
 * ───────────────────────
 * Screen RAM contains "screen codes" which differ from PETSCII:
 *
 *   Screen Code    Character
 *   ───────────    ─────────
 *   $00            @
 *   $01–$1A        A–Z
 *   $1B            [
 *   $1C            £
 *   $1D            ]
 *   $1E            ↑
 *   $1F            ←
 *   $20            (space)
 *   $21–$3F        ! " # $ % & ' ( ) * + , - . / 0-9 : ; < = > ?
 *   $40–$5F        graphic characters (lines, corners)
 *   $60–$7F        more graphics
 *   $80–$FF        reversed (inverse) versions of $00–$7F
 *
 * For text adventures we primarily see $00–$3F (letters, digits,
 * punctuation) and $20 (space).
 *
 * EMULATOR LIBRARIES
 * ──────────────────
 *   1. VICE.js    — VICE compiled to WebAssembly (comprehensive, ~20MB)
 *   2. c64js      — Lightweight JS C64 emulator
 *   3. jsc64      — Another option
 *   4. c64-wasm   — Rust-based C64 emu compiled to WASM
 *
 * DISK FORMATS:  .d64  .t64  .prg  .tap  .crt
 */

import { EmulatorShim } from './emulator-shim.js';

/* ── C64 screen geometry ── */
const ROWS = 25;
const COLS = 40;
const SCREEN_RAM = 0x0400;    /* Default screen memory base */
const COLOR_RAM  = 0xD800;    /* Color RAM base */

/**
 * Convert a C64 screen code to printable ASCII.
 * Handles both normal ($00–$7F) and inverse ($80–$FF) codes.
 */
function screenCodeToAscii(code) {
    /* Strip inverse bit */
    const c = code & 0x7F;

    if (c === 0x00) return 0x40;  /* @ */
    if (c >= 0x01 && c <= 0x1A) return c + 0x40;  /* A–Z → 0x41–0x5A */
    if (c === 0x1B) return 0x5B;  /* [ */
    if (c === 0x1C) return 0x23;  /* £ → # (closest ASCII) */
    if (c === 0x1D) return 0x5D;  /* ] */
    if (c === 0x1E) return 0x5E;  /* ↑ → ^ */
    if (c === 0x1F) return 0x5F;  /* ← → _ */
    if (c === 0x20) return 0x20;  /* space */
    if (c >= 0x21 && c <= 0x3F) return c;  /* !"#$%&'()*+,-./0-9:;<=>? */
    /* Graphic characters ($40–$7F) → space (no ASCII equivalent) */
    return 0x20;
}

/* ── C64 keyboard: PETSCII codes for special keys ── */
const KEY_MAP = {
    "Enter":      0x0D,  /* RETURN */
    "Backspace":  0x14,  /* INST/DEL (delete) */
    "Escape":     0x03,  /* RUN/STOP */
    "ArrowLeft":  0x9D,  /* Cursor left (SHIFT + cursor right) */
    "ArrowRight": 0x1D,  /* Cursor right */
    "ArrowUp":    0x91,  /* Cursor up (SHIFT + cursor down) */
    "ArrowDown":  0x11,  /* Cursor down */
    " ":          0x20,
    "Tab":        0x09,
    "F1":         0x85,
    "F3":         0x86,
    "F5":         0x87,
    "F7":         0x88,
};

/* ═════════════════════════════════════════════════ */

export class C64Emulator extends EmulatorShim {
    constructor() {
        super();
        this._emu = null;       /* reference to the actual C64 emulator */
        this._mem = null;       /* memory accessor */
        this._canvas = null;
        this._demoMode = false;
        this._demoScreen = [];  /* 25 x 40 screen codes (demo fallback) */
        this._demoCursorR = 0;
        this._demoCursorC = 0;
    }

    get rows() { return ROWS; }
    get cols() { return COLS; }

    /* ── Boot ── */

    async _boot(config) {
        /*
         * Try to find a C64 emulator library.  We support multiple emulators:
         *
         * 1. Viciious  — Pure JS, public domain, ideal for tinkering
         *    (https://github.com/luxocrates/viciious)
         *
         * 2. VICE.js   — VICE compiled to Emscripten/WASM, full accuracy
         *    (https://github.com/rjanicek/vice.js)
         *    Detected via Emscripten Module with VICE ccall exports
         *
         * 3. ts-emu-c64 — TypeScript, text-mode only (simplest integration)
         *    (https://github.com/davervw/ts-emu-c64)
         *
         * 4. Generic — any emulator exposing window.C64 / window.c64js
         */
        const C64Lib = window.C64 || window.Viciious || window.c64js || window.c64wasm;

        /* Check for VICE.js (Emscripten Module with ccall) */
        const viceModule = window.Module && typeof window.Module.ccall === "function"
            ? window.Module : null;

        if (viceModule) {
            await this._bootVICE(viceModule, config);
        } else if (C64Lib) {
            await this._bootReal(C64Lib, config);
        } else {
            console.warn("Commodore 64 emulator library not found — running in demo mode.");
            console.info(
                "To use a real emulator, include one of:\n" +
                "  - Viciious (https://github.com/luxocrates/viciious) — pure JS, public domain\n" +
                "  - VICE.js  (https://github.com/rjanicek/vice.js) — full VICE accuracy\n" +
                "  - c64js    (https://c64js.github.io/) — lightweight\n" +
                "Load the library and expose it as window.C64, window.Viciious, or Emscripten Module."
            );
            this._bootDemo(config);
        }
    }

    /**
     * Boot using VICE.js (Emscripten build of VICE).
     * VICE exposes ccall for keyboard_key_pressed/released and
     * the full 64KB RAM is inside the WASM heap.
     */
    async _bootVICE(mod, config) {
        this._viceModule = mod;
        this._emu = mod;

        /* For VICE.js, RAM is inside the Emscripten HEAPU8 at an internal offset.
         * We use ccall to read memory if a mem_read function is exported,
         * otherwise fall back to screen polling. */
        if (typeof mod.ccall === "function") {
            this._mem = {
                read: addr => {
                    try {
                        return mod.ccall("mem_read", "number", ["number"], [addr]);
                    } catch(e) {
                        return 0x20;
                    }
                }
            };
        }

        /* Load disk image if provided */
        if (config.diskUrl || config.diskBuffer) {
            try {
                if (config.diskUrl && typeof mod.ccall === "function") {
                    mod.ccall("autostart_autodetect", "number",
                        ["string", "string", "number", "number"],
                        [config.diskUrl, null, 0, 1]);
                }
            } catch(e) {
                console.warn("VICE.js disk load failed:", e);
            }
        }
    }

    async _bootReal(Lib, config) {
        const container = document.getElementById("v86-screen-container");
        this._canvas = container ? container.querySelector("canvas") : null;

        const emuConfig = {
            canvas: this._canvas,
            rom: {
                basic:  config.basicRom  || "basic.rom",
                kernal: config.kernalRom || "kernal.rom",
                chargen: config.chargenRom || "chargen.rom",
            },
            disk: config.diskUrl || config.diskBuffer,
        };

        if (typeof Lib === "function") {
            this._emu = new Lib(emuConfig);
        } else if (Lib.create) {
            this._emu = await Lib.create(emuConfig);
        }

        if (this._emu) {
            /*
             * Memory access priority:
             * - Viciious: internal RAM array accessible via JS scope
             * - ts-emu-c64: direct TypeScript array (this._emu.memory)
             * - generic: emu.ram or emu.cpu.read(addr)
             */
            this._mem = this._emu.ram || this._emu.memory || null;
            if (!this._mem && this._emu.cpu) {
                this._mem = { read: addr => this._emu.cpu.read(addr) };
            }
            if (this._emu.start) this._emu.start();
        }
    }

    /* ── Demo mode: C64-style text screen ── */

    _bootDemo(_config) {
        this._demoMode = true;
        for (let r = 0; r < ROWS; r++) {
            this._demoScreen[r] = new Uint8Array(COLS).fill(0x20); /* spaces */
        }

        const banner = [
            "    **** COMMODORE 64 BASIC V2 ****",
            "",
            " 64K RAM SYSTEM  38911 BASIC BYTES FREE",
            "",
            "READY.",
            "",
        ];

        const info = [
            "* EMULATOR LIBRARY NOT LOADED *",
            "",
            "THIS IS A DEMO OF THE C64 TEXT",
            "SCREEN EXTRACTION PIPELINE.",
            "",
            "TO LOAD A REAL EMULATOR, ADD A",
            "C64 JS EMULATOR LIBRARY.",
            "SEE: VICE.JS OR C64JS",
            "",
            "TYPE BELOW TO TEST TEXT INPUT.",
            "",
        ];

        const allLines = banner.concat(info);
        for (let i = 0; i < allLines.length && i < ROWS; i++) {
            this._setDemoLine(i, allLines[i]);
        }
        this._demoCursorR = allLines.length;
        this._demoCursorC = 0;
    }

    /** Write a string to a demo screen row using C64 screen codes. */
    _setDemoLine(row, text) {
        for (let c = 0; c < COLS; c++) {
            if (c < text.length) {
                this._demoScreen[row][c] = this._asciiToScreenCode(text.charCodeAt(c));
            } else {
                this._demoScreen[row][c] = 0x20;
            }
        }
    }

    /** Convert ASCII to C64 screen code. */
    _asciiToScreenCode(ascii) {
        if (ascii === 0x20) return 0x20;  /* space */
        if (ascii >= 0x41 && ascii <= 0x5A) return ascii - 0x40;  /* A-Z → $01-$1A */
        if (ascii >= 0x61 && ascii <= 0x7A) return ascii - 0x60;  /* a-z → $01-$1A (C64 is uppercase) */
        if (ascii >= 0x30 && ascii <= 0x39) return ascii;          /* 0-9 */
        if (ascii >= 0x21 && ascii <= 0x3F) return ascii;          /* punctuation */
        if (ascii === 0x40) return 0x00;  /* @ */
        if (ascii === 0x5B) return 0x1B;  /* [ */
        if (ascii === 0x5D) return 0x1D;  /* ] */
        return 0x20;
    }

    /* ── Screen reading ── */

    _readScreenChar(r, c) {
        if (this._demoMode) {
            const code = this._demoScreen[r] ? this._demoScreen[r][c] : 0x20;
            return screenCodeToAscii(code);
        }
        const addr = SCREEN_RAM + r * COLS + c;
        const code = this._readMem(addr);
        return screenCodeToAscii(code);
    }

    /** Read a byte from emulator memory. */
    _readMem(addr) {
        if (!this._mem) return 0x20;
        if (this._mem instanceof Uint8Array || Array.isArray(this._mem)) {
            return this._mem[addr] || 0x20;
        }
        if (typeof this._mem.read === "function") {
            return this._mem.read(addr);
        }
        if (typeof this._mem === "function") {
            return this._mem(addr);
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

        /* Convert ASCII char to PETSCII and queue it */
        let petscii = ch.charCodeAt(0);
        /* Convert lowercase to uppercase PETSCII (C64 default charset) */
        if (petscii >= 0x61 && petscii <= 0x7A) petscii -= 0x20;

        /*
         * Input priority:
         * 1. VICE.js ccall — keyboard_key_pressed / keyboard_key_released
         * 2. Generic emulator keyboard handler
         * 3. Queue / type methods
         */
        if (this._viceModule && typeof this._viceModule.ccall === "function") {
            this._viceKeyPress(petscii);
        } else if (this._emu.keyboard && this._emu.keyboard.keyDown) {
            this._emu.keyboard.keyDown({ key: ch, keyCode: petscii });
        } else if (this._emu.type) {
            this._emu.type(ch);
        } else if (this._emu.queueKey) {
            this._emu.queueKey(petscii);
        } else if (this._emu.pressKey) {
            this._emu.pressKey(petscii);
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
            if (this._viceModule && typeof this._viceModule.ccall === "function") {
                this._viceKeyPress(code);
            } else if (this._emu.queueKey) {
                this._emu.queueKey(code);
            } else if (this._emu.pressKey) {
                this._emu.pressKey(code);
            } else if (this._emu.keyboard && this._emu.keyboard.keyDown) {
                this._emu.keyboard.keyDown({ key: name, keyCode: code });
            }
        }
    }

    /**
     * Send a key via VICE.js Emscripten ccall interface.
     * VICE expects keyboard_key_pressed(keycode) / keyboard_key_released(keycode)
     * with a short delay between press and release.
     */
    _viceKeyPress(keyCode) {
        try {
            this._viceModule.ccall("keyboard_key_pressed", "undefined",
                ["number"], [keyCode]);
            setTimeout(() => {
                this._viceModule.ccall("keyboard_key_released", "undefined",
                    ["number"], [keyCode]);
            }, 60);
        } catch(e) {
            /* Fallback: dispatch DOM keyboard event to VICE canvas */
            const canvas = document.querySelector("#v86-screen-container canvas");
            if (canvas) {
                canvas.dispatchEvent(new KeyboardEvent("keydown", {
                    keyCode: keyCode, which: keyCode, bubbles: true
                }));
                setTimeout(() => {
                    canvas.dispatchEvent(new KeyboardEvent("keyup", {
                        keyCode: keyCode, which: keyCode, bubbles: true
                    }));
                }, 60);
            }
        }
    }

    /* ── Demo mode input ── */

    _demoType(ch) {
        const r = this._demoCursorR, c = this._demoCursorC;
        if (r < ROWS && c < COLS) {
            this._demoScreen[r][c] = this._asciiToScreenCode(ch.toUpperCase().charCodeAt(0));
            this._demoCursorC++;
        }
    }

    _demoEnter() {
        this._demoCursorR++;
        if (this._demoCursorR >= ROWS) {
            for (let r = 0; r < ROWS - 1; r++) {
                this._demoScreen[r] = this._demoScreen[r + 1];
            }
            this._demoScreen[ROWS - 1] = new Uint8Array(COLS).fill(0x20);
            this._demoCursorR = ROWS - 1;
        }
        this._demoCursorC = 0;
    }

    _demoBackspace() {
        if (this._demoCursorC > 0) {
            this._demoCursorC--;
            this._demoScreen[this._demoCursorR][this._demoCursorC] = 0x20;
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

export function createC64Emulator() {
    return new C64Emulator();
}

/* ── Platform metadata ── */

export const C64_INFO = {
    id: "c64",
    name: "Commodore 64",
    screenRows: ROWS,
    screenCols: COLS,
    charEncoding: "PETSCII screen codes ($0400-$07E7)",
    diskFormats: [".d64", ".t64", ".prg", ".tap", ".crt"],
    emulatorLibraries: [
        "VICE.js — VICE compiled to WebAssembly (most comprehensive)",
        "c64js — Lightweight JavaScript C64 emulator",
        "c64-wasm — Rust-based C64 emulator compiled to WASM",
    ],
    textMemory: "$0400-$07E7 (1000 bytes, 40x25 screen codes)",
    colorMemory: "$D800-$DBE7 (1000 bytes, one nybble per char)",
    notes: [
        "The C64 screen is 40x25 characters.",
        "Screen RAM uses 'screen codes' which differ from PETSCII.",
        "Default character set is uppercase; lowercase mode available.",
        "VIC-II register $D018 can relocate screen RAM (default $0400).",
        "Text adventures typically use the default BASIC screen.",
        "Infocom games output text through KERNAL CHROUT ($FFD2).",
    ],
    textAdventures: [
        {
            name: "Zork I: The Great Underground Empire",
            publisher: "Infocom",
            year: 1982,
            format: ".d64",
            notes: "Classic text adventure. The C64 version runs well.",
            source: "https://ifarchive.org/",
        },
        {
            name: "Zork II: The Wizard of Frobozz",
            publisher: "Infocom",
            year: 1982,
            format: ".d64",
        },
        {
            name: "Zork III: The Dungeon Master",
            publisher: "Infocom",
            year: 1982,
            format: ".d64",
        },
        {
            name: "The Hitchhiker's Guide to the Galaxy",
            publisher: "Infocom",
            year: 1984,
            format: ".d64",
            notes: "Douglas Adams + Steve Meretzky collaboration.",
        },
        {
            name: "Planetfall",
            publisher: "Infocom",
            year: 1983,
            format: ".d64",
        },
        {
            name: "Wishbringer",
            publisher: "Infocom",
            year: 1985,
            format: ".d64",
            notes: "A gentler introduction to Infocom adventures.",
        },
        {
            name: "Scott Adams Adventures (12 games)",
            publisher: "Adventure International",
            year: 1980,
            format: ".d64",
            notes: "Adventureland, Pirate Adventure, Voodoo Castle, etc.",
        },
        {
            name: "The Pawn",
            publisher: "Magnetic Scrolls",
            year: 1986,
            format: ".d64",
            notes: "Sophisticated parser with detailed descriptions.",
        },
        {
            name: "Pirate Adventure",
            publisher: "Adventure International / Scott Adams",
            year: 1978,
            format: ".d64",
            notes: "One of the earliest microcomputer text adventures.",
        },
    ],
};
