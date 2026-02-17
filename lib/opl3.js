/*
 * OPL3 (YMF262) FM Synthesis Emulator
 *
 * Adapted from the OPL3 emulator by Robson Cozendey (Wikipedia Wikipedia Wikipedia)
 * JavaScript port by IDDQD@doom.js (https://github.com/nicknack70/nicknack.fm)
 * ES module conversion for v86 integration.
 *
 * This implements the Yamaha YMF262 (OPL3) FM synthesis chip used in
 * Sound Blaster 16 and compatible cards for DOS-era game music.
 */

/* ═══════════════════════════════════════════
 * Data Tables & Constants
 * ═══════════════════════════════════════════ */

const OPL3Data = {
    _1_NTS1_6_Offset: 0x08,
    DAM1_DVB1_RYT1_BD1_SD1_TOM1_TC1_HH1_Offset: 0xbd,
    _7_NEW1_Offset: 0x105,
    _2_CONNECTIONSEL6_Offset: 0x104,
    sampleRate: 49700,
    vibratoTable: [new Float64Array(8192), new Float64Array(8192)],
    tremoloTable: [new Float64Array(13432), new Float64Array(13432)],

    loadVibratoTable: function(vibratoTable) {
        var semitone = Math.pow(2, 1 / 12);
        var cent = Math.pow(semitone, 1 / 100);
        var DVB0 = Math.pow(cent, 7);
        var DVB1 = Math.pow(cent, 14);
        var i;
        for (i = 0; i < 1024; i++) {
            vibratoTable[0][i] = vibratoTable[1][i] = 1;
        }
        for (; i < 2048; i++) {
            vibratoTable[0][i] = Math.sqrt(DVB0);
            vibratoTable[1][i] = Math.sqrt(DVB1);
        }
        for (; i < 3072; i++) {
            vibratoTable[0][i] = DVB0;
            vibratoTable[1][i] = DVB1;
        }
        for (; i < 4096; i++) {
            vibratoTable[0][i] = Math.sqrt(DVB0);
            vibratoTable[1][i] = Math.sqrt(DVB1);
        }
        for (; i < 5120; i++) {
            vibratoTable[0][i] = vibratoTable[1][i] = 1;
        }
        for (; i < 6144; i++) {
            vibratoTable[0][i] = 1 / Math.sqrt(DVB0);
            vibratoTable[1][i] = 1 / Math.sqrt(DVB1);
        }
        for (; i < 7168; i++) {
            vibratoTable[0][i] = 1 / DVB0;
            vibratoTable[1][i] = 1 / DVB1;
        }
        for (; i < 8192; i++) {
            vibratoTable[0][i] = 1 / Math.sqrt(DVB0);
            vibratoTable[1][i] = 1 / Math.sqrt(DVB1);
        }
    },

    loadTremoloTable: function(tremoloTable) {
        var tremoloFrequency = 3.7;
        var tremoloDepth = [-1, -4.8];
        var tremoloIncrement = [
            OPL3Data.calculateIncrement(tremoloDepth[0], 0, 1 / (2 * tremoloFrequency)),
            OPL3Data.calculateIncrement(tremoloDepth[1], 0, 1 / (2 * tremoloFrequency))
        ];
        tremoloTable[0][0] = tremoloDepth[0];
        tremoloTable[1][0] = tremoloDepth[1];
        var counter = 0;
        while (tremoloTable[0][counter] < 0) {
            counter++;
            tremoloTable[0][counter] = tremoloTable[0][counter - 1] + tremoloIncrement[0];
            tremoloTable[1][counter] = tremoloTable[1][counter - 1] + tremoloIncrement[1];
        }
        while (tremoloTable[0][counter] > tremoloDepth[0] && counter < tremoloTable[0].length - 1) {
            counter++;
            tremoloTable[0][counter] = tremoloTable[0][counter - 1] - tremoloIncrement[0];
            tremoloTable[1][counter] = tremoloTable[1][counter - 1] - tremoloIncrement[1];
        }
    },

    calculateIncrement: function(begin, end, period) {
        return (end - begin) / OPL3Data.sampleRate * (1 / period);
    }
};

OPL3Data.loadVibratoTable(OPL3Data.vibratoTable);
OPL3Data.loadTremoloTable(OPL3Data.tremoloTable);

const ChannelData = {
    _2_KON1_BLOCK3_FNUMH2_Offset: 0xb0,
    FNUML8_Offset: 0xa0,
    CHD1_CHC1_CHB1_CHA1_FB3_CNT1_Offset: 0xc0,
    feedback: [0, 1/32, 1/16, 1/8, 1/4, 1/2, 1, 2]
};

const OperatorData = {
    AM1_VIB1_EGT1_KSR1_MULT4_Offset: 0x20,
    KSL2_TL6_Offset: 0x40,
    AR4_DR4_Offset: 0x60,
    SL4_RR4_Offset: 0x80,
    _5_WS3_Offset: 0xe0,
    waveLength: 1024,
    multTable: [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15],
    ksl3dBtable: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, -3, -6, -9],
        [0, 0, 0, 0, -3, -6, -9, -12],
        [0, 0, 0, -1.875, -4.875, -7.875, -10.875, -13.875],
        [0, 0, 0, -3, -6, -9, -12, -15],
        [0, 0, -1.125, -4.125, -7.125, -10.125, -13.125, -16.125],
        [0, 0, -1.875, -4.875, -7.875, -10.875, -13.875, -16.875],
        [0, 0, -2.625, -5.625, -8.625, -11.625, -14.625, -17.625],
        [0, 0, -3, -6, -9, -12, -15, -18],
        [0, -0.750, -3.750, -6.750, -9.750, -12.750, -15.750, -18.750],
        [0, -1.125, -4.125, -7.125, -10.125, -13.125, -16.125, -19.125],
        [0, -1.500, -4.500, -7.500, -10.500, -13.500, -16.500, -19.500],
        [0, -1.875, -4.875, -7.875, -10.875, -13.875, -16.875, -19.875],
        [0, -2.250, -5.250, -8.250, -11.250, -14.250, -17.250, -20.250],
        [0, -2.625, -5.625, -8.625, -11.625, -14.625, -17.625, -20.625],
        [0, -3, -6, -9, -12, -15, -18, -21]
    ],
    waveforms: [
        new Float64Array(1024), new Float64Array(1024), new Float64Array(1024), new Float64Array(1024),
        new Float64Array(1024), new Float64Array(1024), new Float64Array(1024), new Float64Array(1024)
    ]
};

(function loadWaveforms(waveforms) {
    var i, theta;
    for (i = 0, theta = 0; i < 1024; i++, theta += (2 * Math.PI / 1024)) {
        waveforms[0][i] = Math.sin(theta);
    }
    var sineTable = waveforms[0];
    for (i = 0; i < 512; i++) {
        waveforms[1][i] = sineTable[i];
        waveforms[1][512 + i] = 0;
    }
    for (i = 0; i < 512; i++) {
        waveforms[2][i] = waveforms[2][512 + i] = sineTable[i];
    }
    for (i = 0; i < 256; i++) {
        waveforms[3][i] = waveforms[3][512 + i] = sineTable[i];
        waveforms[3][256 + i] = waveforms[3][768 + i] = 0;
    }
    for (i = 0; i < 512; i++) {
        waveforms[4][i] = sineTable[i * 2];
        waveforms[4][512 + i] = 0;
    }
    for (i = 0; i < 256; i++) {
        waveforms[5][i] = waveforms[5][256 + i] = sineTable[i * 2];
        waveforms[5][512 + i] = waveforms[5][768 + i] = 0;
    }
    for (i = 0; i < 512; i++) {
        waveforms[6][i] = 1;
        waveforms[6][512 + i] = -1;
    }
    for (i = 0; i < 512; i++) {
        var x = i * (16 / 256);
        waveforms[7][i] = Math.pow(2, -x);
        waveforms[7][1023 - i] = -Math.pow(2, -(x + 1 / 16));
    }
})(OperatorData.waveforms);

const EnvelopeGeneratorData = {
    rateOffset: [
        [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    ],
    attackTimeValuesTable: [
        [Infinity, Infinity], [Infinity, Infinity], [Infinity, Infinity], [Infinity, Infinity],
        [2826.24, 1482.75], [2252.80, 1155.07], [1884.16, 991.23], [1597.44, 868.35],
        [1413.12, 741.38], [1126.40, 577.54], [942.08, 495.62], [798.72, 434.18],
        [706.56, 370.69], [563.20, 288.77], [471.04, 247.81], [399.36, 217.09],
        [353.28, 185.34], [281.60, 144.38], [235.52, 123.90], [199.68, 108.54],
        [176.76, 92.67], [140.80, 72.19], [117.76, 61.95], [99.84, 54.27],
        [88.32, 46.34], [70.40, 36.10], [58.88, 30.98], [49.92, 27.14],
        [44.16, 23.17], [35.20, 18.05], [29.44, 15.49], [24.96, 13.57],
        [22.08, 11.58], [17.60, 9.02], [14.72, 7.74], [12.48, 6.78],
        [11.04, 5.79], [8.80, 4.51], [7.36, 3.87], [6.24, 3.39],
        [5.52, 2.90], [4.40, 2.26], [3.68, 1.94], [3.12, 1.70],
        [2.76, 1.45], [2.20, 1.13], [1.84, 0.97], [1.56, 0.85],
        [1.40, 0.73], [1.12, 0.61], [0.92, 0.49], [0.80, 0.43],
        [0.70, 0.37], [0.56, 0.31], [0.46, 0.26], [0.42, 0.22],
        [0.38, 0.19], [0.30, 0.14], [0.24, 0.11], [0.20, 0.11],
        [0.00, 0.00], [0.00, 0.00], [0.00, 0.00], [0.00, 0.00]
    ],
    decayAndReleaseTimeValuesTable: [
        [Infinity, Infinity], [Infinity, Infinity], [Infinity, Infinity], [Infinity, Infinity],
        [39280.64, 8212.48], [31416.32, 6574.08], [26173.44, 5509.12], [22446.08, 4730.88],
        [19640.32, 4106.24], [15708.16, 3287.04], [13086.72, 2754.56], [11223.04, 2365.44],
        [9820.16, 2053.12], [7854.08, 1643.52], [6543.36, 1377.28], [5611.52, 1182.72],
        [4910.08, 1026.56], [3927.04, 821.76], [3271.68, 688.64], [2805.76, 591.36],
        [2455.04, 513.28], [1936.52, 410.88], [1635.84, 344.34], [1402.88, 295.68],
        [1227.52, 256.64], [981.76, 205.44], [817.92, 172.16], [701.44, 147.84],
        [613.76, 128.32], [490.88, 102.72], [488.96, 86.08], [350.72, 73.92],
        [306.88, 64.16], [245.44, 51.36], [204.48, 43.04], [175.36, 36.96],
        [153.44, 32.08], [122.72, 25.68], [102.24, 21.52], [87.68, 18.48],
        [76.72, 16.04], [61.36, 12.84], [51.12, 10.76], [43.84, 9.24],
        [38.36, 8.02], [30.68, 6.42], [25.56, 5.38], [21.92, 4.62],
        [19.20, 4.02], [15.36, 3.22], [12.80, 2.68], [10.96, 2.32],
        [9.60, 2.02], [7.68, 1.62], [6.40, 1.35], [5.48, 1.15],
        [4.80, 1.01], [3.84, 0.81], [3.20, 0.69], [2.74, 0.58],
        [2.40, 0.51], [2.40, 0.51], [2.40, 0.51], [2.40, 0.51]
    ]
};

/* ═══════════════════════════════════════════
 * Envelope Generator Stage Constants
 * ═══════════════════════════════════════════ */

const Stage = {
    ATTACK: 'ATTACK',
    DECAY: 'DECAY',
    SUSTAIN: 'SUSTAIN',
    RELEASE: 'RELEASE',
    OFF: 'OFF'
};

/* ═══════════════════════════════════════════
 * Phase Generator
 * ═══════════════════════════════════════════ */

function PhaseGenerator(opl) {
    this.opl = opl;
    this.phase = 0;
    this.phaseIncrement = 0;
}

PhaseGenerator.prototype.setFrequency = function(f_number, block, mult) {
    var baseFrequency = f_number * Math.pow(2, block - 1) * OPL3Data.sampleRate / Math.pow(2, 19);
    var operatorFrequency = baseFrequency * OperatorData.multTable[mult];
    this.phaseIncrement = operatorFrequency / OPL3Data.sampleRate;
};

PhaseGenerator.prototype.getPhase = function(vib) {
    if (vib == 1) {
        this.phase += this.phaseIncrement * OPL3Data.vibratoTable[this.opl.dvb][this.opl.vibratoIndex];
    } else {
        this.phase += this.phaseIncrement;
    }
    this.phase %= 1;
    return this.phase;
};

PhaseGenerator.prototype.keyOn = function() {
    this.phase = 0;
};

/* ═══════════════════════════════════════════
 * Envelope Generator
 * ═══════════════════════════════════════════ */

function EnvelopeGenerator(opl) {
    this.opl = opl;
    this.stage = Stage.OFF;
    this.actualAttackRate = 0;
    this.actualDecayRate = 0;
    this.actualReleaseRate = 0;
    this.xAttackIncrement = 0;
    this.xMinimumInAttack = 0;
    this.dBdecayIncrement = 0;
    this.dBreleaseIncrement = 0;
    this.attenuation = 0;
    this.totalLevel = 0;
    this.sustainLevel = 0;
    this.x = this.dBtoX(-96);
    this.resolutionMaximum = this.dBtoX(-0.1875);
    this.percentage10 = this.percentageToX(0.1);
    this.percentage90 = this.percentageToX(0.9);
    this.envelope = -96;
}

EnvelopeGenerator.Stage = Stage;

EnvelopeGenerator.prototype.setActualSustainLevel = function(sl) {
    if (sl == 0x0f) { this.sustainLevel = -93; return; }
    this.sustainLevel = -3 * sl;
};

EnvelopeGenerator.prototype.setTotalLevel = function(tl) {
    this.totalLevel = tl * -0.75;
};

EnvelopeGenerator.prototype.setAtennuation = function(f_number, block, ksl) {
    var hi4bits = (f_number >> 6) & 0x0f;
    switch (ksl) {
        case 0: this.attenuation = 0; break;
        case 1: this.attenuation = OperatorData.ksl3dBtable[hi4bits][block]; break;
        case 2: this.attenuation = OperatorData.ksl3dBtable[hi4bits][block] / 2; break;
        case 3: this.attenuation = OperatorData.ksl3dBtable[hi4bits][block] * 2; break;
    }
};

EnvelopeGenerator.prototype.setActualAttackRate = function(attackRate, ksr, keyScaleNumber) {
    this.actualAttackRate = this.calculateActualRate(attackRate, ksr, keyScaleNumber) | 0;
    var period0to100inSeconds = EnvelopeGeneratorData.attackTimeValuesTable[this.actualAttackRate][0] / 1000;
    var period0to100inSamples = (period0to100inSeconds * OPL3Data.sampleRate) | 0;
    var period10to90inSeconds = EnvelopeGeneratorData.attackTimeValuesTable[this.actualAttackRate][1] / 1000;
    var period10to90inSamples = (period10to90inSeconds * OPL3Data.sampleRate) | 0;
    this.xAttackIncrement = OPL3Data.calculateIncrement(this.percentage10, this.percentage90, period10to90inSeconds);
    var period10to100inSamples = (period10to90inSamples + (this.resolutionMaximum - this.percentage90) / this.xAttackIncrement) | 0;
    this.xMinimumInAttack = this.percentage10 - (period0to100inSamples - period10to100inSamples) * this.xAttackIncrement;
};

EnvelopeGenerator.prototype.setActualDecayRate = function(decayRate, ksr, keyScaleNumber) {
    this.actualDecayRate = this.calculateActualRate(decayRate, ksr, keyScaleNumber) | 0;
    var period10to90inSeconds = EnvelopeGeneratorData.decayAndReleaseTimeValuesTable[this.actualDecayRate][1] / 1000;
    this.dBdecayIncrement = OPL3Data.calculateIncrement(this.percentageToDB(0.1), this.percentageToDB(0.9), period10to90inSeconds);
};

EnvelopeGenerator.prototype.setActualReleaseRate = function(releaseRate, ksr, keyScaleNumber) {
    this.actualReleaseRate = this.calculateActualRate(releaseRate, ksr, keyScaleNumber) | 0;
    var period10to90inSeconds = EnvelopeGeneratorData.decayAndReleaseTimeValuesTable[this.actualReleaseRate][1] / 1000;
    this.dBreleaseIncrement = OPL3Data.calculateIncrement(this.percentageToDB(0.1), this.percentageToDB(0.9), period10to90inSeconds);
};

EnvelopeGenerator.prototype.calculateActualRate = function(rate, ksr, keyScaleNumber) {
    var rof = EnvelopeGeneratorData.rateOffset[ksr][keyScaleNumber];
    var actualRate = rate * 4 + rof;
    if (actualRate > 63) actualRate = 63;
    return actualRate;
};

EnvelopeGenerator.prototype.getEnvelope = function(egt, am) {
    var envelopeSustainLevel = this.sustainLevel / 2;
    var envelopeTremolo = OPL3Data.tremoloTable[this.opl.dam][this.opl.tremoloIndex] / 2;
    var envelopeAttenuation = this.attenuation / 2;
    var envelopeTotalLevel = this.totalLevel / 2;
    var envelopeMinimum = -96;
    var envelopeResolution = 0.1875;
    var outputEnvelope;

    switch (this.stage) {
        case Stage.ATTACK:
            if (this.envelope < -envelopeResolution && this.xAttackIncrement != -Infinity) {
                this.envelope = -Math.pow(2, this.x);
                this.x += this.xAttackIncrement;
                break;
            } else {
                this.envelope = 0;
                this.stage = Stage.DECAY;
            }
            /* falls through */
        case Stage.DECAY:
            if (this.envelope > envelopeSustainLevel) {
                this.envelope -= this.dBdecayIncrement;
                break;
            } else {
                this.stage = Stage.SUSTAIN;
            }
            /* falls through */
        case Stage.SUSTAIN:
            if (egt == 1) break;
            if (this.envelope > envelopeMinimum) {
                this.envelope -= this.dBreleaseIncrement;
            } else {
                this.stage = Stage.OFF;
            }
            break;
        case Stage.RELEASE:
            if (this.envelope > envelopeMinimum) {
                this.envelope -= this.dBreleaseIncrement;
            } else {
                this.stage = Stage.OFF;
            }
            break;
    }

    outputEnvelope = this.envelope;
    if (am == 1) outputEnvelope += envelopeTremolo;
    outputEnvelope += envelopeAttenuation;
    outputEnvelope += envelopeTotalLevel;
    return outputEnvelope;
};

EnvelopeGenerator.prototype.keyOn = function() {
    var xCurrent = Math.log2(-this.envelope);
    this.x = xCurrent < this.xMinimumInAttack ? xCurrent : this.xMinimumInAttack;
    this.stage = Stage.ATTACK;
};

EnvelopeGenerator.prototype.keyOff = function() {
    if (this.stage != Stage.OFF) this.stage = Stage.RELEASE;
};

EnvelopeGenerator.prototype.dBtoX = function(dB) {
    return Math.log2(-dB);
};

EnvelopeGenerator.prototype.percentageToDB = function(percentage) {
    return Math.log10(percentage) * 10;
};

EnvelopeGenerator.prototype.percentageToX = function(percentage) {
    return this.dBtoX(this.percentageToDB(percentage));
};

/* ═══════════════════════════════════════════
 * Operator
 * ═══════════════════════════════════════════ */

function Operator(baseAddress, opl) {
    this.opl = opl;
    this.operatorBaseAddress = baseAddress;
    this.phaseGenerator = new PhaseGenerator(opl);
    this.envelopeGenerator = new EnvelopeGenerator(opl);
    this.envelope = 0;
    this.am = 0;
    this.vib = 0;
    this.ksr = 0;
    this.egt = 0;
    this.mult = 0;
    this.ksl = 0;
    this.tl = 0;
    this.ar = 0;
    this.dr = 0;
    this.sl = 0;
    this.rr = 0;
    this.ws = 0;
    this.keyScaleNumber = 0;
    this.f_number = 0;
    this.block = 0;
}

Operator.noModulator = 0;

Operator.prototype.update_AM1_VIB1_EGT1_KSR1_MULT4 = function() {
    var v = this.opl.registers[this.operatorBaseAddress + OperatorData.AM1_VIB1_EGT1_KSR1_MULT4_Offset];
    this.am = (v & 0x80) >> 7;
    this.vib = (v & 0x40) >> 6;
    this.egt = (v & 0x20) >> 5;
    this.ksr = (v & 0x10) >> 4;
    this.mult = v & 0x0f;
    this.phaseGenerator.setFrequency(this.f_number, this.block, this.mult);
    this.envelopeGenerator.setActualAttackRate(this.ar, this.ksr, this.keyScaleNumber);
    this.envelopeGenerator.setActualDecayRate(this.dr, this.ksr, this.keyScaleNumber);
    this.envelopeGenerator.setActualReleaseRate(this.rr, this.ksr, this.keyScaleNumber);
};

Operator.prototype.update_KSL2_TL6 = function() {
    var v = this.opl.registers[this.operatorBaseAddress + OperatorData.KSL2_TL6_Offset];
    this.ksl = (v & 0xc0) >> 6;
    this.tl = v & 0x3f;
    this.envelopeGenerator.setAtennuation(this.f_number, this.block, this.ksl);
    this.envelopeGenerator.setTotalLevel(this.tl);
};

Operator.prototype.update_AR4_DR4 = function() {
    var v = this.opl.registers[this.operatorBaseAddress + OperatorData.AR4_DR4_Offset];
    this.ar = (v & 0xf0) >> 4;
    this.dr = v & 0x0f;
    this.envelopeGenerator.setActualAttackRate(this.ar, this.ksr, this.keyScaleNumber);
    this.envelopeGenerator.setActualDecayRate(this.dr, this.ksr, this.keyScaleNumber);
};

Operator.prototype.update_SL4_RR4 = function() {
    var v = this.opl.registers[this.operatorBaseAddress + OperatorData.SL4_RR4_Offset];
    this.sl = (v & 0xf0) >> 4;
    this.rr = v & 0x0f;
    this.envelopeGenerator.setActualSustainLevel(this.sl);
    this.envelopeGenerator.setActualReleaseRate(this.rr, this.ksr, this.keyScaleNumber);
};

Operator.prototype.update_5_WS3 = function() {
    var v = this.opl.registers[this.operatorBaseAddress + OperatorData._5_WS3_Offset];
    this.ws = v & 0x07;
};

Operator.prototype.getOperatorOutput = function(modulator) {
    if (this.envelopeGenerator.stage == Stage.OFF) return 0;
    var envelopeInDB = this.envelopeGenerator.getEnvelope(this.egt, this.am);
    this.envelope = Math.pow(10, envelopeInDB / 10);
    this.ws = this.ws & ((this.opl._new << 2) + 3);
    var waveform = OperatorData.waveforms[this.ws];
    this.phase = this.phaseGenerator.getPhase(this.vib);
    return this.getOutput(modulator, this.phase, waveform);
};

Operator.prototype.getOutput = function(modulator, outputPhase, waveform) {
    outputPhase = (outputPhase + modulator) % 1;
    if (outputPhase < 0) { outputPhase++; outputPhase %= 1; }
    var sampleIndex = (outputPhase * OperatorData.waveLength) | 0;
    return waveform[sampleIndex] * this.envelope;
};

Operator.prototype.keyOn = function() {
    if (this.ar > 0) {
        this.envelopeGenerator.keyOn();
        this.phaseGenerator.keyOn();
    } else {
        this.envelopeGenerator.stage = Stage.OFF;
    }
};

Operator.prototype.keyOff = function() {
    this.envelopeGenerator.keyOff();
};

Operator.prototype.updateOperator = function(ksn, f_num, blk) {
    this.keyScaleNumber = ksn;
    this.f_number = f_num;
    this.block = blk;
    this.update_AM1_VIB1_EGT1_KSR1_MULT4();
    this.update_KSL2_TL6();
    this.update_AR4_DR4();
    this.update_SL4_RR4();
    this.update_5_WS3();
};

/* ═══════════════════════════════════════════
 * Rhythm-specific Operators
 * ═══════════════════════════════════════════ */

function TopCymbalOperator(opl, baseAddress) {
    Operator.call(this, baseAddress !== undefined ? baseAddress : 0x15, opl);
}
TopCymbalOperator.prototype = Object.create(Operator.prototype);
TopCymbalOperator.prototype.constructor = TopCymbalOperator;

TopCymbalOperator.prototype.getOperatorOutput = function(modulator, externalPhase) {
    if (externalPhase === undefined) {
        externalPhase = this.opl.highHatOperator.phase * OperatorData.multTable[this.opl.highHatOperator.mult];
    }
    var envelopeInDB = this.envelopeGenerator.getEnvelope(this.egt, this.am);
    this.envelope = Math.pow(10, envelopeInDB / 10);
    this.phase = this.phaseGenerator.getPhase(this.vib);
    var waveIndex = (this.ws & ((this.opl._new << 2) + 3)) | 0;
    var waveform = OperatorData.waveforms[waveIndex];
    var carrierPhase = (8 * this.phase) % 1;
    var modulatorPhase = externalPhase;
    var modulatorOutput = this.getOutput(Operator.noModulator, modulatorPhase, waveform);
    var carrierOutput = this.getOutput(modulatorOutput, carrierPhase, waveform);
    var cycles = 4;
    if ((carrierPhase * cycles) % cycles > 0.1) carrierOutput = 0;
    return carrierOutput * 2;
};

function HighHatOperator(opl) {
    TopCymbalOperator.call(this, opl, 0x11);
}
HighHatOperator.prototype = Object.create(TopCymbalOperator.prototype);
HighHatOperator.prototype.constructor = HighHatOperator;

HighHatOperator.prototype.getOperatorOutput = function(modulator) {
    var topCymbalPhase = this.opl.topCymbalOperator.phase * OperatorData.multTable[this.opl.topCymbalOperator.mult];
    var operatorOutput = TopCymbalOperator.prototype.getOperatorOutput.call(this, modulator, topCymbalPhase);
    if (operatorOutput == 0) operatorOutput = Math.random() * this.envelope;
    return operatorOutput;
};

function SnareDrumOperator(opl) {
    Operator.call(this, 0x14, opl);
}
SnareDrumOperator.prototype = Object.create(Operator.prototype);
SnareDrumOperator.prototype.constructor = SnareDrumOperator;

SnareDrumOperator.prototype.getOperatorOutput = function(modulator) {
    if (this.envelopeGenerator.stage == Stage.OFF) return 0;
    var envelopeInDB = this.envelopeGenerator.getEnvelope(this.egt, this.am);
    this.envelope = Math.pow(10, envelopeInDB / 10);
    var waveIndex = (this.ws & ((this.opl._new << 2) + 3)) | 0;
    var waveform = OperatorData.waveforms[waveIndex];
    this.phase = this.opl.highHatOperator.phase * 2;
    var operatorOutput = this.getOutput(modulator, this.phase, waveform);
    var noise = Math.random() * this.envelope;
    if (operatorOutput / this.envelope != 1 && operatorOutput / this.envelope != -1) {
        if (operatorOutput > 0) operatorOutput = noise;
        else if (operatorOutput < 0) operatorOutput = -noise;
        else operatorOutput = 0;
    }
    return operatorOutput * 2;
};

function TomTomOperator(opl) {
    Operator.call(this, 0x12, opl);
}
TomTomOperator.prototype = Object.create(Operator.prototype);
TomTomOperator.prototype.constructor = TomTomOperator;

/* ═══════════════════════════════════════════
 * Channel (base class)
 * ═══════════════════════════════════════════ */

function Channel(baseAddress, opl) {
    this.opl = opl;
    this.channelBaseAddress = baseAddress;
    this.fnuml = 0;
    this.fnumh = 0;
    this.kon = 0;
    this.block = 0;
    this.cha = 0;
    this.chb = 0;
    this.chc = 0;
    this.chd = 0;
    this.fb = 0;
    this.cnt = 0;
    this.feedback = [0, 0];
    this.toPhase = 4;
    this.output = new Float64Array(4);
}

Channel.prototype.update_2_KON1_BLOCK3_FNUMH2 = function() {
    var v = this.opl.registers[this.channelBaseAddress + ChannelData._2_KON1_BLOCK3_FNUMH2_Offset];
    this.block = (v & 0x1c) >> 2;
    this.fnumh = v & 0x03;
    this.updateOperators();
    var newKon = (v & 0x20) >> 5;
    if (newKon != this.kon) {
        if (newKon == 1) this.keyOn();
        else this.keyOff();
        this.kon = newKon;
    }
};

Channel.prototype.update_FNUML8 = function() {
    var v = this.opl.registers[this.channelBaseAddress + ChannelData.FNUML8_Offset];
    this.fnuml = v & 0xff;
    this.updateOperators();
};

Channel.prototype.update_CHD1_CHC1_CHB1_CHA1_FB3_CNT1 = function() {
    var v = this.opl.registers[this.channelBaseAddress + ChannelData.CHD1_CHC1_CHB1_CHA1_FB3_CNT1_Offset];
    this.chd = (v & 0x80) >> 7;
    this.chc = (v & 0x40) >> 6;
    this.chb = (v & 0x20) >> 5;
    this.cha = (v & 0x10) >> 4;
    this.fb = (v & 0x0e) >> 1;
    this.cnt = v & 0x01;
    this.updateOperators();
};

Channel.prototype.updateChannel = function() {
    this.update_2_KON1_BLOCK3_FNUMH2();
    this.update_FNUML8();
    this.update_CHD1_CHC1_CHB1_CHA1_FB3_CNT1();
};

Channel.prototype.getInFourChannels = function(channelOutput) {
    if (this.opl._new == 0) {
        this.output[0] = this.output[1] = this.output[2] = this.output[3] = channelOutput;
    } else {
        this.output[0] = (this.cha == 1) ? channelOutput : 0;
        this.output[1] = (this.chb == 1) ? channelOutput : 0;
        this.output[2] = (this.chc == 1) ? channelOutput : 0;
        this.output[3] = (this.chd == 1) ? channelOutput : 0;
    }
    return this.output;
};

/* Stubs for subclasses to override */
Channel.prototype.getChannelOutput = function() { return this.getInFourChannels(0); };
Channel.prototype.keyOn = function() {};
Channel.prototype.keyOff = function() {};
Channel.prototype.updateOperators = function() {};

/* ═══════════════════════════════════════════
 * Channel2op
 * ═══════════════════════════════════════════ */

function Channel2op(baseAddress, o1, o2, opl) {
    Channel.call(this, baseAddress, opl);
    this.op1 = o1;
    this.op2 = o2;
}
Channel2op.prototype = Object.create(Channel.prototype);
Channel2op.prototype.constructor = Channel2op;

Channel2op.prototype.getChannelOutput = function() {
    var channelOutput = 0, op1Output = 0, op2Output = 0;
    var feedbackOutput = (this.feedback[0] + this.feedback[1]) / 2;
    if (this.cnt == 0) {
        if (this.op2.envelopeGenerator.stage == Stage.OFF) return this.getInFourChannels(0);
        op1Output = this.op1.getOperatorOutput(feedbackOutput);
        channelOutput = this.op2.getOperatorOutput(op1Output * this.toPhase);
    } else {
        if (this.op1.envelopeGenerator.stage == Stage.OFF &&
            this.op2.envelopeGenerator.stage == Stage.OFF) return this.getInFourChannels(0);
        op1Output = this.op1.getOperatorOutput(feedbackOutput);
        op2Output = this.op2.getOperatorOutput(Operator.noModulator);
        channelOutput = (op1Output + op2Output) / 2;
    }
    this.feedback[0] = this.feedback[1];
    this.feedback[1] = (op1Output * ChannelData.feedback[this.fb]) % 1;
    return this.getInFourChannels(channelOutput);
};

Channel2op.prototype.keyOn = function() {
    this.op1.keyOn();
    this.op2.keyOn();
    this.feedback[0] = this.feedback[1] = 0;
};

Channel2op.prototype.keyOff = function() {
    this.op1.keyOff();
    this.op2.keyOff();
};

Channel2op.prototype.updateOperators = function() {
    var keyScaleNumber = this.block * 2 + ((this.fnumh >> this.opl.nts) & 0x01);
    var f_number = (this.fnumh << 8) | this.fnuml;
    this.op1.updateOperator(keyScaleNumber, f_number, this.block);
    this.op2.updateOperator(keyScaleNumber, f_number, this.block);
};

/* ═══════════════════════════════════════════
 * Channel4op
 * ═══════════════════════════════════════════ */

function Channel4op(baseAddress, o1, o2, o3, o4, opl) {
    Channel.call(this, baseAddress, opl);
    this.op1 = o1;
    this.op2 = o2;
    this.op3 = o3;
    this.op4 = o4;
}
Channel4op.prototype = Object.create(Channel.prototype);
Channel4op.prototype.constructor = Channel4op;

Channel4op.prototype.getChannelOutput = function() {
    var channelOutput = 0, op1Output = 0, op2Output = 0, op3Output = 0, op4Output = 0;
    var secondChannelBaseAddress = this.channelBaseAddress + 3;
    var secondCnt = this.opl.registers[secondChannelBaseAddress + ChannelData.CHD1_CHC1_CHB1_CHA1_FB3_CNT1_Offset] & 1;
    var cnt4op = (this.cnt << 1) | secondCnt;
    var feedbackOutput = (this.feedback[0] + this.feedback[1]) / 2;

    switch (cnt4op) {
        case 0:
            if (this.op4.envelopeGenerator.stage == Stage.OFF) return this.getInFourChannels(0);
            op1Output = this.op1.getOperatorOutput(feedbackOutput);
            op2Output = this.op2.getOperatorOutput(op1Output * this.toPhase);
            op3Output = this.op3.getOperatorOutput(op2Output * this.toPhase);
            channelOutput = this.op4.getOperatorOutput(op3Output * this.toPhase);
            break;
        case 1:
            if (this.op2.envelopeGenerator.stage == Stage.OFF &&
                this.op4.envelopeGenerator.stage == Stage.OFF) return this.getInFourChannels(0);
            op1Output = this.op1.getOperatorOutput(feedbackOutput);
            op2Output = this.op2.getOperatorOutput(op1Output * this.toPhase);
            op3Output = this.op3.getOperatorOutput(Operator.noModulator);
            op4Output = this.op4.getOperatorOutput(op3Output * this.toPhase);
            channelOutput = (op2Output + op4Output) / 2;
            break;
        case 2:
            if (this.op1.envelopeGenerator.stage == Stage.OFF &&
                this.op4.envelopeGenerator.stage == Stage.OFF) return this.getInFourChannels(0);
            op1Output = this.op1.getOperatorOutput(feedbackOutput);
            op2Output = this.op2.getOperatorOutput(Operator.noModulator);
            op3Output = this.op3.getOperatorOutput(op2Output * this.toPhase);
            op4Output = this.op4.getOperatorOutput(op3Output * this.toPhase);
            channelOutput = (op1Output + op4Output) / 2;
            break;
        case 3:
            if (this.op1.envelopeGenerator.stage == Stage.OFF &&
                this.op3.envelopeGenerator.stage == Stage.OFF &&
                this.op4.envelopeGenerator.stage == Stage.OFF) return this.getInFourChannels(0);
            op1Output = this.op1.getOperatorOutput(feedbackOutput);
            op2Output = this.op2.getOperatorOutput(Operator.noModulator);
            op3Output = this.op3.getOperatorOutput(op2Output * this.toPhase);
            op4Output = this.op4.getOperatorOutput(Operator.noModulator);
            channelOutput = (op1Output + op3Output + op4Output) / 3;
            break;
    }
    this.feedback[0] = this.feedback[1];
    this.feedback[1] = (op1Output * ChannelData.feedback[this.fb]) % 1;
    return this.getInFourChannels(channelOutput);
};

Channel4op.prototype.keyOn = function() {
    this.op1.keyOn();
    this.op2.keyOn();
    this.op3.keyOn();
    this.op4.keyOn();
    this.feedback[0] = this.feedback[1] = 0;
};

Channel4op.prototype.keyOff = function() {
    this.op1.keyOff();
    this.op2.keyOff();
    this.op3.keyOff();
    this.op4.keyOff();
};

Channel4op.prototype.updateOperators = function() {
    var keyScaleNumber = this.block * 2 + ((this.fnumh >> this.opl.nts) & 0x01);
    var f_number = (this.fnumh << 8) | this.fnuml;
    this.op1.updateOperator(keyScaleNumber, f_number, this.block);
    this.op2.updateOperator(keyScaleNumber, f_number, this.block);
    this.op3.updateOperator(keyScaleNumber, f_number, this.block);
    this.op4.updateOperator(keyScaleNumber, f_number, this.block);
};

/* ═══════════════════════════════════════════
 * DisabledChannel
 * ═══════════════════════════════════════════ */

function DisabledChannel(opl) {
    Channel.call(this, 0, opl);
}
DisabledChannel.prototype = Object.create(Channel.prototype);
DisabledChannel.prototype.constructor = DisabledChannel;

/* ═══════════════════════════════════════════
 * Rhythm Channels
 * ═══════════════════════════════════════════ */

function RhythmChannel(baseAddress, o1, o2, opl) {
    Channel2op.call(this, baseAddress, o1, o2, opl);
}
RhythmChannel.prototype = Object.create(Channel2op.prototype);
RhythmChannel.prototype.constructor = RhythmChannel;

RhythmChannel.prototype.getChannelOutput = function() {
    var op1Output = this.op1.getOperatorOutput(Operator.noModulator);
    var op2Output = this.op2.getOperatorOutput(Operator.noModulator);
    return this.getInFourChannels((op1Output + op2Output) / 2);
};
RhythmChannel.prototype.keyOn = function() {};
RhythmChannel.prototype.keyOff = function() {};

function BassDrumChannel(opl) {
    Channel2op.call(this, 6, new Operator(0x10, opl), new Operator(0x13, opl), opl);
}
BassDrumChannel.prototype = Object.create(Channel2op.prototype);
BassDrumChannel.prototype.constructor = BassDrumChannel;

BassDrumChannel.prototype.getChannelOutput = function() {
    if (this.cnt == 1) this.op1.ar = 0;
    return Channel2op.prototype.getChannelOutput.call(this);
};
BassDrumChannel.prototype.keyOn = function() {};
BassDrumChannel.prototype.keyOff = function() {};

function HighHatSnareDrumChannel(opl) {
    RhythmChannel.call(this, 7, opl.highHatOperator, opl.snareDrumOperator, opl);
}
HighHatSnareDrumChannel.prototype = Object.create(RhythmChannel.prototype);
HighHatSnareDrumChannel.prototype.constructor = HighHatSnareDrumChannel;

function TomTomTopCymbalChannel(opl) {
    RhythmChannel.call(this, 8, opl.tomTomOperator, opl.topCymbalOperator, opl);
}
TomTomTopCymbalChannel.prototype = Object.create(RhythmChannel.prototype);
TomTomTopCymbalChannel.prototype.constructor = TomTomTopCymbalChannel;

/* ═══════════════════════════════════════════
 * OPL3 — Main Chip
 * ═══════════════════════════════════════════ */

function OPL3() {
    this.nts = 0;
    this.dam = 0;
    this.dvb = 0;
    this.ryt = 0;
    this.bd = 0;
    this.sd = 0;
    this.tom = 0;
    this.tc = 0;
    this.hh = 0;
    this._new = 0;
    this.connectionsel = 0;
    this.vibratoIndex = 0;
    this.tremoloIndex = 0;

    this.registers = new Int32Array(0x200);
    this.channels = [new Array(9), new Array(9)];

    this.initOperators();
    this.initChannels2op();
    this.initChannels4op();
    this.initRhythmChannels();
    this.initChannels();

    this.output = new Int16Array(2);
    this.outputBuffer = new Float64Array(4);
    this.outputChannelNumber = 2;
}

OPL3.prototype.read = function(output, seek) {
    var offset = seek || 0;
    output = output || this.output;
    var converterScale = output instanceof Float32Array ? 32768 : 1;

    do {
        var channelOutput, outputChannelNumber;
        for (outputChannelNumber = 0; outputChannelNumber < 4; outputChannelNumber++) {
            this.outputBuffer[outputChannelNumber] = 0;
        }

        for (var array = 0; array < (this._new + 1); array++) {
            for (var channelNumber = 0; channelNumber < 9; channelNumber++) {
                channelOutput = this.channels[array][channelNumber].getChannelOutput();
                for (outputChannelNumber = 0; outputChannelNumber < 4; outputChannelNumber++) {
                    this.outputBuffer[outputChannelNumber] += channelOutput[outputChannelNumber];
                }
            }
        }

        for (outputChannelNumber = 0; outputChannelNumber < this.outputChannelNumber; outputChannelNumber++) {
            output[offset + outputChannelNumber] = ((this.outputBuffer[outputChannelNumber] / 18) * 0x7FFF) / converterScale;
        }

        this.vibratoIndex++;
        if (this.vibratoIndex >= OPL3Data.vibratoTable[this.dvb].length) this.vibratoIndex = 0;
        this.tremoloIndex++;
        if (this.tremoloIndex >= OPL3Data.tremoloTable[this.dam].length) this.tremoloIndex = 0;

        offset += this.outputChannelNumber;
    } while (offset < output.length);

    return output;
};

OPL3.prototype.write = function(array, address, data) {
    var registerAddress = (array << 8) | address;
    if (registerAddress < 0 || registerAddress >= 0x200) return;

    this.registers[registerAddress] = data;
    switch (address & 0xe0) {
        case 0x00:
            if (array == 1) {
                if (address == 0x04) this.update_2_CONNECTIONSEL6();
                else if (address == 0x05) this.update_7_NEW1();
            } else if (address == 0x08) this.update_1_NTS1_6();
            break;
        case 0xA0:
            if (address == 0xBD) {
                if (array == 0) this.update_DAM1_DVB1_RYT1_BD1_SD1_TOM1_TC1_HH1();
                break;
            }
            if ((address & 0xF0) == 0xB0 && address <= 0xB8) {
                this.channels[array][address & 0x0F].update_2_KON1_BLOCK3_FNUMH2();
                break;
            }
            if ((address & 0xF0) == 0xA0 && address <= 0xA8) {
                this.channels[array][address & 0x0F].update_FNUML8();
            }
            break;
        case 0xC0:
            if (address <= 0xC8) this.channels[array][address & 0x0F].update_CHD1_CHC1_CHB1_CHA1_FB3_CNT1();
            break;
        default:
            var operatorOffset = address & 0x1F;
            if (!this.operators[array][operatorOffset]) break;
            switch (address & 0xE0) {
                case 0x20: this.operators[array][operatorOffset].update_AM1_VIB1_EGT1_KSR1_MULT4(); break;
                case 0x40: this.operators[array][operatorOffset].update_KSL2_TL6(); break;
                case 0x60: this.operators[array][operatorOffset].update_AR4_DR4(); break;
                case 0x80: this.operators[array][operatorOffset].update_SL4_RR4(); break;
                case 0xE0: this.operators[array][operatorOffset].update_5_WS3(); break;
            }
    }
};

OPL3.prototype.initOperators = function() {
    this.operators = [[], []];
    for (var array = 0; array < 2; array++) {
        for (var group = 0; group <= 0x10; group += 8) {
            for (var offset = 0; offset < 6; offset++) {
                var baseAddress = (array << 8) | (group + offset);
                this.operators[array][group + offset] = new Operator(baseAddress, this);
            }
        }
    }
    this.highHatOperator = new HighHatOperator(this);
    this.snareDrumOperator = new SnareDrumOperator(this);
    this.tomTomOperator = new TomTomOperator(this);
    this.topCymbalOperator = new TopCymbalOperator(this);
    this.highHatOperatorInNonRhythmMode = this.operators[0][0x11];
    this.snareDrumOperatorInNonRhythmMode = this.operators[0][0x14];
    this.tomTomOperatorInNonRhythmMode = this.operators[0][0x12];
    this.topCymbalOperatorInNonRhythmMode = this.operators[0][0x15];
};

OPL3.prototype.initChannels2op = function() {
    this.channels2op = [[], []];
    for (var array = 0; array < 2; array++) {
        for (var channelNumber = 0; channelNumber < 3; channelNumber++) {
            var baseAddress = (array << 8) | channelNumber;
            this.channels2op[array][channelNumber] = new Channel2op(baseAddress, this.operators[array][channelNumber], this.operators[array][channelNumber + 0x3], this);
            this.channels2op[array][channelNumber + 3] = new Channel2op(baseAddress + 3, this.operators[array][channelNumber + 0x8], this.operators[array][channelNumber + 0xb], this);
            this.channels2op[array][channelNumber + 6] = new Channel2op(baseAddress + 6, this.operators[array][channelNumber + 0x10], this.operators[array][channelNumber + 0x13], this);
        }
    }
};

OPL3.prototype.initChannels4op = function() {
    this.channels4op = [[], []];
    for (var array = 0; array < 2; array++) {
        for (var channelNumber = 0; channelNumber < 3; channelNumber++) {
            var baseAddress = (array << 8) | channelNumber;
            this.channels4op[array][channelNumber] = new Channel4op(
                baseAddress,
                this.operators[array][channelNumber],
                this.operators[array][channelNumber + 0x3],
                this.operators[array][channelNumber + 0x8],
                this.operators[array][channelNumber + 0xb],
                this
            );
        }
    }
};

OPL3.prototype.initRhythmChannels = function() {
    this.bassDrumChannel = new BassDrumChannel(this);
    this.highHatSnareDrumChannel = new HighHatSnareDrumChannel(this);
    this.tomTomTopCymbalChannel = new TomTomTopCymbalChannel(this);
};

OPL3.prototype.initChannels = function() {
    for (var array = 0; array < 2; array++) {
        for (var i = 0; i < 9; i++) {
            this.channels[array][i] = this.channels2op[array][i];
        }
    }
    this.disabledChannel = new DisabledChannel(this);
};

OPL3.prototype.update_1_NTS1_6 = function() {
    var v = this.registers[OPL3Data._1_NTS1_6_Offset];
    this.nts = (v & 0x40) >> 6;
};

OPL3.prototype.update_DAM1_DVB1_RYT1_BD1_SD1_TOM1_TC1_HH1 = function() {
    var v = this.registers[OPL3Data.DAM1_DVB1_RYT1_BD1_SD1_TOM1_TC1_HH1_Offset];
    this.dam = (v & 0x80) >> 7;
    this.dvb = (v & 0x40) >> 6;

    var new_ryt = (v & 0x20) >> 5;
    if (new_ryt != this.ryt) { this.ryt = new_ryt; this.setRhythmMode(); }

    var new_bd = (v & 0x10) >> 4;
    if (new_bd != this.bd) { this.bd = new_bd; if (this.bd == 1) { this.bassDrumChannel.op1.keyOn(); this.bassDrumChannel.op2.keyOn(); } }

    var new_sd = (v & 0x08) >> 3;
    if (new_sd != this.sd) { this.sd = new_sd; if (this.sd == 1) this.snareDrumOperator.keyOn(); }

    var new_tom = (v & 0x04) >> 2;
    if (new_tom != this.tom) { this.tom = new_tom; if (this.tom == 1) this.tomTomOperator.keyOn(); }

    var new_tc = (v & 0x02) >> 1;
    if (new_tc != this.tc) { this.tc = new_tc; if (this.tc == 1) this.topCymbalOperator.keyOn(); }

    var new_hh = v & 0x01;
    if (new_hh != this.hh) { this.hh = new_hh; if (this.hh == 1) this.highHatOperator.keyOn(); }
};

OPL3.prototype.update_7_NEW1 = function() {
    var v = this.registers[OPL3Data._7_NEW1_Offset];
    this._new = (v & 0x01);
    if (this._new == 1) this.setEnabledChannels();
    this.set4opConnections();
};

OPL3.prototype.setEnabledChannels = function() {
    for (var array = 0; array < 2; array++) {
        for (var i = 0; i < 9; i++) {
            var baseAddress = this.channels[array][i].channelBaseAddress;
            this.registers[baseAddress + ChannelData.CHD1_CHC1_CHB1_CHA1_FB3_CNT1_Offset] |= 0xf0;
            this.channels[array][i].update_CHD1_CHC1_CHB1_CHA1_FB3_CNT1();
        }
    }
};

OPL3.prototype.update_2_CONNECTIONSEL6 = function() {
    var v = this.registers[OPL3Data._2_CONNECTIONSEL6_Offset];
    this.connectionsel = (v & 0x3f);
    this.set4opConnections();
};

OPL3.prototype.set4opConnections = function() {
    for (var array = 0; array < 2; ++array) {
        for (var i = 0; i < 3; ++i) {
            if (this._new == 1) {
                var shift = array * 3 + i;
                var connectionBit = (this.connectionsel >> shift) & 0x01;
                if (connectionBit == 1) {
                    this.channels[array][i] = this.channels4op[array][i];
                    this.channels[array][i + 3] = this.disabledChannel;
                    this.channels[array][i].updateChannel();
                    continue;
                }
            }
            this.channels[array][i] = this.channels2op[array][i];
            this.channels[array][i + 3] = this.channels2op[array][i + 3];
            this.channels[array][i].updateChannel();
            this.channels[array][i + 3].updateChannel();
        }
    }
};

OPL3.prototype.setRhythmMode = function() {
    if (this.ryt == 1) {
        this.channels[0][6] = this.bassDrumChannel;
        this.channels[0][7] = this.highHatSnareDrumChannel;
        this.channels[0][8] = this.tomTomTopCymbalChannel;
        this.operators[0][0x11] = this.highHatOperator;
        this.operators[0][0x14] = this.snareDrumOperator;
        this.operators[0][0x12] = this.tomTomOperator;
        this.operators[0][0x15] = this.topCymbalOperator;
    } else {
        for (var i = 6; i <= 8; i++) this.channels[0][i] = this.channels2op[0][i];
        this.operators[0][0x11] = this.highHatOperatorInNonRhythmMode;
        this.operators[0][0x14] = this.snareDrumOperatorInNonRhythmMode;
        this.operators[0][0x12] = this.tomTomOperatorInNonRhythmMode;
        this.operators[0][0x15] = this.topCymbalOperatorInNonRhythmMode;
    }
    for (var j = 6; j <= 8; j++) this.channels[0][j].updateChannel();
};

/* ═══════════════════════════════════════════
 * Exports
 * ═══════════════════════════════════════════ */

export { OPL3, OPL3Data };
