/*
 * Emulator Shim — v86-compatible adapter base class
 *
 * Non-DOS emulators (Apple II, C64, BBC Micro) implement this interface
 * so the existing screen.js, commands.js, speech.js etc. work without
 * modification.  The shim emits the same events that v86 does:
 *
 *   "screen-put-char"  → [row, col, charCode]
 *   "serial0-output-byte" → byte  (unused for non-DOS, but kept for compat)
 *
 * Subclasses must override:
 *   _boot(config)         — start the platform emulator, resolve when ready
 *   _sendChar(ch)         — send a single printable character
 *   _sendKey(name)        — send a named key ("Enter","Backspace", etc.)
 *   _readScreenChar(r,c)  — return the char code at row,col (or 0x20)
 *   _destroy()            — tear down the emulator
 *   rows, cols            — screen dimensions (getters)
 */

export class EmulatorShim {
    constructor() {
        this._listeners = {};
        this._prevScreen = null;   /* previous screen snapshot for diff */
        this._pollTimer = null;
        this._ready = false;

        /* v86 compat: keyboard_adapter with a destroy() method */
        this.keyboard_adapter = { destroy() {} };
    }

    /* ── v86-compatible event API ── */

    add_listener(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }

    _emit(event, data) {
        const fns = this._listeners[event];
        if (fns) for (let i = 0; i < fns.length; i++) fns[i](data);
    }

    /* ── v86-compatible keyboard API ── */

    /**
     * Send a single character (v86 sends one char at a time via keyboard_send_text).
     */
    keyboard_send_text(ch) {
        this._sendChar(ch);
    }

    /**
     * v86 sends scancodes as [down, up] pairs.
     * We map the common ones to named keys for the platform adapters.
     */
    keyboard_send_scancodes(codes) {
        if (!codes || !codes.length) return;
        const down = codes[0];
        /* Map PC scancodes to key names */
        const map = {
            0x1C: "Enter", 0x0E: "Backspace", 0x01: "Escape",
            0x48: "ArrowUp", 0x50: "ArrowDown",
            0x4B: "ArrowLeft", 0x4D: "ArrowRight",
            0x39: " ", 0x0F: "Tab",
            /* F-keys */
            0x3B: "F1", 0x3C: "F2", 0x3D: "F3", 0x3E: "F4",
            0x3F: "F5", 0x40: "F6", 0x41: "F7", 0x42: "F8",
        };
        const name = map[down];
        if (name) this._sendKey(name);
    }

    /* ── Screen polling ──
     * Periodically reads the emulator's screen memory and emits
     * screen-put-char events for any cells that changed.
     */

    _startScreenPoll(intervalMs) {
        const rows = this.rows, cols = this.cols;
        this._prevScreen = [];
        for (let r = 0; r < rows; r++) {
            this._prevScreen[r] = new Uint8Array(cols).fill(0x20);
        }
        this._pollTimer = setInterval(() => this._pollScreen(), intervalMs || 100);
    }

    _pollScreen() {
        const rows = this.rows, cols = this.cols;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const ch = this._readScreenChar(r, c);
                if (ch !== this._prevScreen[r][c]) {
                    this._prevScreen[r][c] = ch;
                    this._emit("screen-put-char", [r, c, ch]);
                }
            }
        }
    }

    _stopScreenPoll() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    /* ── Lifecycle ── */

    async boot(config) {
        await this._boot(config);
        this._ready = true;
        this._startScreenPoll(100);
    }

    destroy() {
        this._stopScreenPoll();
        this._destroy();
        this._listeners = {};
        this._ready = false;
    }

    /* ── Subclass hooks (must override) ── */

    get rows() { return 25; }
    get cols() { return 80; }

    _boot(_config) { return Promise.resolve(); }
    _sendChar(_ch) {}
    _sendKey(_name) {}
    _readScreenChar(_r, _c) { return 0x20; }
    _destroy() {}
}
