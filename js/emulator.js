"use strict";

/* ═══════════════════════════════════════════
 * Emulator
 * ═══════════════════════════════════════════ */

function bootEmulator(autoLaunch) {
    if (typeof V86Starter === "undefined" && typeof V86 === "undefined") {
        setStatus("error", "v86 not loaded. Serve via HTTP (use start.command).");
        return;
    }

    /* Determine which disk image to use */
    const selectedImg = gameSelect.value;
    if (!selectedImg && !customFloppyBlob) {
        setStatus("error", "No game disk image selected.");
        return;
    }

    setStatus("loading", "Loading BIOS and FreeDOS...");
    bootBtn.disabled = true; bootPromptBtn.disabled = true;
    initBuffer(); initScreenDOM();

    /* Build disk config based on disk type (floppy -> fdb, hard disk -> hda) */
    const isHDD = diskTypeSelect.value === "hdd";
    const diskConfig = customFloppyBlob
        ? { buffer: customFloppyBlob }
        : { url: selectedImg };

    const emulatorConfig = {
        wasm_path: "v86.wasm",
        bios: { url: "seabios.bin" }, vga_bios: { url: "vgabios.bin" },
        fda: { url: "freedos722.img" },
        boot_order: 801,
        screen_container: document.getElementById("v86-screen-container"),
        memory_size: 32 * 1024 * 1024, /* 32MB for larger games */
        autostart: true,
    };

    /* Mount game disk as floppy B: or hard disk C: */
    if (isHDD) {
        emulatorConfig.hda = diskConfig;
    } else {
        emulatorConfig.fdb = diskConfig;
    }

    const Ctor = (typeof V86Starter !== "undefined") ? V86Starter : V86;
    try {
        emulator = new Ctor(emulatorConfig);
    } catch (err) {
        setStatus("error", "Emulator failed: " + err.message);
        bootBtn.disabled = false; bootPromptBtn.disabled = false;
        return;
    }
    setStatus("loading", "Booting FreeDOS... please wait (15-30 sec).");

    emulator.add_listener("screen-put-char", function(d) {
        const row = d[0], col = d[1], ch = d[2];
        if (row >= 0 && row < ROWS && col >= 0 && col < COLS) screenBuffer[row][col] = ch;
    });

    /* Capture serial port output */
    let serialTraceBuf = "";
    let serialTraceTimer = null;
    emulator.add_listener("serial0-output-byte", function(byte) {
        /* Batch serial bytes into short trace lines to avoid per-byte spam */
        if (traceEnabled) {
            if (byte >= 32 && byte < 127) {
                serialTraceBuf += String.fromCharCode(byte);
            } else {
                serialTraceBuf += "<0x" + byte.toString(16).padStart(2, "0") + ">";
            }
            if (!serialTraceTimer) {
                serialTraceTimer = setTimeout(function() {
                    if (serialTraceBuf) {
                        trace("SERIAL", "textCap=" + textCapActive + " data: " + serialTraceBuf);
                        serialTraceBuf = "";
                    }
                    serialTraceTimer = null;
                }, 100);
            }
        }

        /* Check for TextCap startup marker (ESC[TC]) */
        if (!textCapActive && checkTextCapMarker(byte)) {
            textCapActive = true;
            initTextCapBuffer();
            console.log("TextCap TSR detected — serial text capture active");
            trace("TEXTCAP", "TextCap TSR marker detected — serial text capture active");
            announce("Text capture active. Game text will be read via serial port.");
            return;
        }

        /* If TextCap is active, route all printable data to the ANSI parser. */
        if (textCapActive) {
            if (byte === 0x02 || byte === 0x03) return; /* skip framing bytes */
            textCapParseByte(byte);
            return;
        }

        /* Original serial capture for printer redirect (no TextCap) */
        if (byte === 13) return;
        if (byte === 10) { serialBuffer += "\n"; return; }
        if (byte >= 32 && byte < 127) serialBuffer += String.fromCharCode(byte);
    });

    let checks = 0;
    const checker = setInterval(() => {
        checks++;
        let found = false;
        for (let r = ROWS - 1; r >= ROWS - 5 && r >= 0; r--) {
            const l = rowToString(r).trim();
            if (/[A-Z]:\\>?\s*$/.test(l) || l.endsWith(">")) { found = true; break; }
        }
        if (found || checks > 200) {
            clearInterval(checker);
            pendingChanges = []; lastResponseLines = [];
            trace("BOOT", "DOS prompt detected after " + checks + " checks (" + (checks * 0.5) + "s)");

            /*
             * CRITICAL VoiceOver fix: destroy v86's browser keyboard adapter.
             */
            if (emulator.keyboard_adapter && emulator.keyboard_adapter.destroy) {
                emulator.keyboard_adapter.destroy();
            }

            enableInput();

            /* Try to redirect LPT1 -> COM1 so SCRIPT command output gets captured */
            setTimeout(async () => {
                await typeToDOS("MODE LPT1:=COM1:", true);

                if (autoLaunch) {
                    const autoCmd = autorunInput.value.trim();
                    if (autoCmd) {
                        /* Floppy games are on B:, hard disk games are on C: */
                        const gameDrive = diskTypeSelect.value === "hdd" ? "C:" : "B:";

                        /*
                         * If this game uses graphics mode, load TEXTCAP.COM first.
                         */
                        const preset = KNOWN_GAMES[gameSelect.value];
                        if (preset && preset.textcap) {
                            setStatus("ready", "DOS booted. Loading text capture TSR...");
                            await typeToDOS("A:\\TEXTCAP.COM", true);
                            /* Wait for TSR to install and print its banner */
                            await new Promise(r => setTimeout(r, 2000));
                        }

                        setStatus("ready", "DOS booted. Launching game...");
                        await typeToDOS(gameDrive, true);
                        /* Wait for drive change to complete */
                        await new Promise(r => setTimeout(r, 1500));
                        await typeToDOS(autoCmd, true);
                        setStatus("ready", "Game launched! Type commands below.");
                    } else {
                        const driveHint = diskTypeSelect.value === "hdd" ? "C:" : "B:";
                        setStatus("ready", "DOS booted. Game disk on " + driveHint + " drive.");
                    }
                } else {
                    const driveHint = diskTypeSelect.value === "hdd" ? "C:" : "B:";
                    setStatus("ready", "DOS booted. Game disk on " + driveHint + " drive. Type " + driveHint + " then DIR to browse.");
                }
            }, 500);
        }
        if (checks % 8 === 0 && checks <= 200) setStatus("loading", "Booting FreeDOS" + ".".repeat((checks/8)%4+1));
    }, 500);

    refreshTimer = setInterval(refreshScreen, 200);

    /*
     * Graphics mode detection
     */
    let lastCharEventTime = Date.now();
    emulator.add_listener("screen-put-char", function() { lastCharEventTime = Date.now(); });

    let wasGraphicsMode = false;
    setInterval(function() {
        const container = document.getElementById("v86-screen-container");
        const canvas = container ? container.querySelector("canvas") : null;
        if (!canvas) return;

        const w = canvas.width, h = canvas.height;
        /* Known text-mode canvas sizes in v86 */
        const textSizes = [[720,400],[640,400],[300,150],[720,350]];
        const isTextSize = textSizes.some(function(s) { return s[0] === w && s[1] === h; });
        const hasRecentChars = (Date.now() - lastCharEventTime) < 5000;

        if (!isTextSize && !hasRecentChars && w > 0 && h > 0) {
            if (!wasGraphicsMode) {
                wasGraphicsMode = true;

                if (textCapActive) {
                    announce("Graphics mode detected. Text capture TSR is active — game text will be read via serial port.");
                } else {
                    /* No TextCap — show the static fallback message */
                    const gLines = [
                        "GRAPHICS MODE DETECTED — Screen reader limited",
                        "",
                        "This game uses a graphical display.",
                        "Text cannot be automatically read from the screen.",
                        "",
                        "You can still type commands in the input box.",
                        "If the game has a text prompt, typed commands",
                        "will be sent to it.",
                        "",
                        "Press F2 to hear this message again.",
                        "Press Escape in game to skip title screens.",
                    ];
                    for (let r = 0; r < ROWS; r++) {
                        const el = document.getElementById("screen-line-" + r);
                        if (el) {
                            const txt = r < gLines.length ? gLines[r] : "";
                            el.textContent = txt || "\u00A0";
                            el.setAttribute("aria-label", "Line " + (r+1) + ": " + (txt || "blank"));
                        }
                    }
                    announce("Game is in graphics mode. Screen reader access is limited but commands can still be typed.");
                }
            }

            if (textCapActive && textCapDirty && !transcriptCapActive) {
                renderTextCapScreen();
            }
        } else if (hasRecentChars) {
            wasGraphicsMode = false;
        }
    }, 3000);
}
