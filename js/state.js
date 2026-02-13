"use strict";

/* ═══════ State ═══════ */
let emulator = null, screenBuffer = [], prevLines = [];
let isReady = false, refreshTimer = null;
let commandHistory = [], historyIndex = -1;
let pendingChanges = [], lastResponseLines = [];
let changeSettleTimer = null, awaitingResponse = false;

/* Keyboard mode: "insert" (type commands) or "read" (VI-style navigation) */
let keyMode = "insert";
/* Reading cursor position in read mode */
let readRow = 0, readCol = 0;

/* Transcript recording state */
let isRecording = false;
let transcriptBuffer = "";
/* Serial port capture buffer (for DOS SCRIPT -> LPT1 -> COM1 redirect) */
let serialBuffer = "";

/*
 * TextCap: INT 10h hooking TSR that mirrors text output to COM1.
 * When active, serial bytes are parsed as ANSI escape sequences
 * and rendered to a virtual text buffer for screen reader access.
 * This enables accessibility for games running in graphics mode.
 */
let textCapActive = false;
let textCapBuffer = null;   /* 25x80 character grid, initialized on activation */
let textCapCurRow = 0;
let textCapCurCol = 0;
let textCapDirty = false;   /* true when buffer has changed since last render */

/* ANSI parser state machine for TextCap serial input */
let textCapParseState = TC_NORMAL;
let textCapCsiParams = "";  /* accumulates CSI parameter digits/semicolons */
let textCapOscBuf = "";     /* accumulates OSC payload */

/*
 * Transcript capture: polls the game disk directly for a transcript file.
 * When transcript capture is active, it COMPLETELY owns speech output.
 */
let transcriptCapActive = false;   /* true = transcript owns speech */
let transcriptLines = [];          /* array of clean transcript lines received */
let transcriptLineBuffer = "";     /* partial line from last poll */
let transcriptWatchdog = null;     /* timer to detect stalled transcript */

/* Disk polling state */
let transcriptPollTimer = null;    /* setInterval handle */
let transcriptPollLastLength = 0;  /* bytes of file content already processed */

/* Auto-flush state */
let autoFlushPending = false;      /* true while an auto-flush cycle is running */
let autoFlushTimer = null;         /* setTimeout handle for delayed flush */

/* Custom floppy image loaded via file picker (ArrayBuffer or null) */
let customFloppyBlob = null;

/*
 * responseLog: array of response objects:
 *   { type: "command"|"response", lines: string[], index: number }
 * Used for navigating between responses with F7/F8.
 */
let responseLog = [];
let responseNavIndex = -1; /* current position in responseLog for nav */

/* TextCap marker detection state */
let textCapMarkerPos = 0;

/* Speech voices */
let voices = [];

/* ═══════ DOM refs ═══════ */
const $ = id => document.getElementById(id);
const bootBtn=$("boot-btn"), bootPromptBtn=$("boot-prompt-btn"), statusEl=$("status");
const commandInput=$("command-input"), sendBtn=$("send-btn");
const enterOnlyBtn=$("enter-only-btn"), singleKeyToggle=$("single-key-mode");
const screenEl=$("accessible-screen"), announcer=$("announcer");
const historyLog=$("history-log");
const voiceSelect=$("voice-select"), rateSlider=$("rate-slider"), rateValue=$("rate-value");
const pitchSlider=$("pitch-slider"), pitchValue=$("pitch-value");
const autoSpeakToggle=$("auto-speak-toggle"), speakAfterCmdToggle=$("speak-after-cmd-toggle");
const skipDecorToggle=$("skip-decorative-toggle");
const speakScreenBtn=$("speak-screen-btn"), speakNewBtn=$("speak-new-btn");
const speakLastBtn=$("speak-last-btn"), stopSpeechBtn=$("stop-speech-btn");
const testSpeechBtn=$("test-speech-btn");
const histPrevBtn=$("hist-prev-btn"), histNextBtn=$("hist-next-btn"), histPosition=$("hist-position");
const fmRefreshBtn=$("fm-refresh-btn"), fmUploadBtn=$("fm-upload-btn");
const fmDlFloppyBtn=$("fm-dl-floppy-btn"), fmUploadInput=$("fm-upload-input");
const fmStatus=$("fm-status"), fmTable=$("fm-table"), fmTbody=$("fm-tbody");
const stateSaveBtn=$("state-save-btn"), stateRestoreBtn=$("state-restore-btn");
const stateRestoreInput=$("state-restore-input");
const modeIndicator=$("mode-indicator");
const recordBtn=$("record-btn"), downloadTranscriptBtn=$("download-transcript-btn");
const clearTranscriptBtn=$("clear-transcript-btn"), transcriptFilename=$("transcript-filename");
const transcriptPreview=$("transcript-preview"), transcriptStats=$("transcript-stats");
const typingFeedbackSelect=$("typing-feedback-select");
const gameSelect=$("game-select"), autorunInput=$("autorun-input"), diskTypeSelect=$("disk-type-select");
const customImgInput=$("custom-img-input"), loadCustomImgBtn=$("load-custom-img-btn");
const promptCharInput=$("prompt-char-input");
const promptDepthSelect=$("prompt-depth-select");
const transcriptCapState=$("transcript-cap-state"), transcriptCapInfo=$("transcript-cap-info");
const transcriptWatchBtn=$("transcript-watch-btn");
const transcriptWatchFilename=$("transcript-watch-filename");
const transcriptPollSpeedSelect=$("transcript-poll-speed");
const transcriptFlushBtn=$("transcript-flush-btn");
const transcriptDisconnectBtn=$("transcript-disconnect-btn");
const transcriptAutoSpeakToggle=$("transcript-auto-speak-toggle");
const transcriptReplaceScreenToggle=$("transcript-replace-screen-toggle");
const transcriptMuteScreenToggle=$("transcript-mute-screen-toggle");
const transcriptAutoFlushToggle=$("transcript-auto-flush-toggle");
const transcriptAutoFlushOptions=$("transcript-auto-flush-options");
const transcriptFlushDelay=$("transcript-flush-delay");
const transcriptFlushD1=$("transcript-flush-d1");
const transcriptFlushD2=$("transcript-flush-d2");
const transcriptFlushD3=$("transcript-flush-d3");
const transcriptFlushTotal=$("transcript-flush-total");
const transcriptTestReadBtn=$("transcript-test-read-btn");
const transcriptSpeakLastBtn=$("transcript-speak-last-btn");
