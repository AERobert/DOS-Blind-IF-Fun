/* ═══════════════════════════════════════════
 * Audio — OPL3 FM Synthesis Bridge
 *
 * Connects v86's SB16 FM register writes to a software OPL3
 * emulator and outputs the synthesized audio via Web Audio API.
 *
 * The v86 emulator's SB16 device has stubbed FM/OPL synthesis.
 * This module intercepts FM register writes (emitted as "opl-write"
 * bus events from patched libv86.js) and generates real FM audio.
 * ═══════════════════════════════════════════ */

import { OPL3, OPL3Data } from '../lib/opl3.js';

let audioContext = null;
let opl3 = null;
let processorNode = null;
let isInitialized = false;

/* OPL3 native sample rate */
const OPL_RATE = OPL3Data.sampleRate; /* 49700 Hz */

/* ScriptProcessorNode buffer size — 4096 gives ~85ms latency at 48kHz.
 * Smaller = less latency but more CPU. Larger = more latency but smoother. */
const BUFFER_SIZE = 4096;

/**
 * Initialize the OPL3 audio system.
 * Call this after the v86 emulator is created.
 *
 * @param {Object} emulator - The V86Starter (or V86) instance
 */
export function initOPLAudio(emulator) {
    if (isInitialized) return;

    /* Create OPL3 chip emulator */
    opl3 = new OPL3();

    /* Listen for FM register writes from v86's patched SB16.
     * Event data: [array, address, value]
     *   array   = 0 (bank 0 / ports 0x220-0x221, 0x388-0x389)
     *             1 (bank 1 / ports 0x222-0x223, 0x38A-0x38B)
     *   address = OPL register address (0x00-0xF5)
     *   value   = data byte written */
    emulator.add_listener("opl-write", function(data) {
        if (!opl3) return;
        opl3.write(data[0], data[1], data[2]);

        /* Lazily create AudioContext on first actual FM write.
         * This ensures we only spin up audio processing when a game
         * actually uses FM synthesis, and satisfies the browser's
         * requirement for user-gesture-initiated audio. */
        if (!audioContext) {
            startAudioOutput();
        }
    });

    isInitialized = true;
    console.log("OPL3 FM synthesis: initialized, waiting for FM register writes");
}

/**
 * Create the Web Audio output pipeline.
 * Called lazily on first FM register write.
 */
function startAudioOutput() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn("OPL3: Could not create AudioContext:", e);
        return;
    }

    /* Resume context if suspended (browser autoplay policy) */
    if (audioContext.state === "suspended") {
        audioContext.resume();
    }

    var outputRate = audioContext.sampleRate;

    /* Use ScriptProcessorNode for main-thread audio generation.
     * This avoids the complexity of AudioWorklet cross-thread messaging
     * while keeping OPL register writes synchronous. */
    processorNode = audioContext.createScriptProcessor(BUFFER_SIZE, 0, 2);

    /* Pre-allocate OPL sample buffer — sized for worst-case ratio */
    var maxOplSamples = Math.ceil(BUFFER_SIZE * (OPL_RATE / outputRate)) + 4;
    var oplBuffer = new Float32Array(maxOplSamples * 2);

    processorNode.onaudioprocess = function(event) {
        if (!opl3) return;

        var leftOut = event.outputBuffer.getChannelData(0);
        var rightOut = event.outputBuffer.getChannelData(1);
        var outLen = leftOut.length;

        /* Generate OPL samples at the OPL's native rate */
        var ratio = OPL_RATE / outputRate;
        var oplSamplesNeeded = Math.ceil(outLen * ratio);
        var oplLen = oplSamplesNeeded * 2; /* stereo interleaved */

        /* Ensure our buffer is large enough */
        if (oplBuffer.length < oplLen) {
            oplBuffer = new Float32Array(oplLen + 8);
        }

        /* Fill with zeros and generate */
        oplBuffer.fill(0, 0, oplLen);
        opl3.read(oplBuffer, 0);

        /* Resample from OPL rate to output rate using linear interpolation */
        for (var i = 0; i < outLen; i++) {
            var srcPos = i * ratio;
            var srcIdx = srcPos | 0; /* floor */
            var frac = srcPos - srcIdx;
            var baseL = srcIdx * 2;
            var baseR = baseL + 1;

            /* Linear interpolation between adjacent samples */
            var nextL = baseL + 2;
            var nextR = baseR + 2;
            if (nextL < oplLen) {
                leftOut[i] = oplBuffer[baseL] * (1 - frac) + oplBuffer[nextL] * frac;
                rightOut[i] = oplBuffer[baseR] * (1 - frac) + oplBuffer[nextR] * frac;
            } else {
                leftOut[i] = oplBuffer[baseL] || 0;
                rightOut[i] = oplBuffer[baseR] || 0;
            }
        }
    };

    /* Connect to audio output */
    processorNode.connect(audioContext.destination);
    console.log("OPL3 FM synthesis: audio output started (" + outputRate + " Hz)");
}

/**
 * Clean up audio resources. Call when the emulator is destroyed.
 */
export function destroyOPLAudio() {
    if (processorNode) {
        processorNode.disconnect();
        processorNode = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    opl3 = null;
    isInitialized = false;
}
