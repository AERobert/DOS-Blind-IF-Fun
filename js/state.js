/* ═══════════════════════════════════════════
 * Shared mutable state + DOM element references
 * ═══════════════════════════════════════════ */

export const $ = id => document.getElementById(id);

/* ── Shared mutable state ──
 * Import as:  import { state } from './state.js';
 * Access as:  state.emulator, state.isReady = true, etc.
 */
export const state = {
    emulator: null, screenBuffer: [], prevLines: [],
    isReady: false, refreshTimer: null,
    commandHistory: [], historyIndex: -1,
    pendingChanges: [], lastResponseLines: [],
    changeSettleTimer: null, awaitingResponse: false,
    keyMode: "insert", readRow: 0, readCol: 0,
    isRecording: false, transcriptBuffer: "", serialBuffer: "",
    textCapActive: false, textCapBuffer: null,
    textCapCurRow: 0, textCapCurCol: 0, textCapDirty: false,
    textCapParseState: 0, /* TC_NORMAL */
    textCapCsiParams: "", textCapOscBuf: "",
    textCapMarkerPos: 0,
    transcriptCapActive: false,
    transcriptLines: [], transcriptLineBuffer: "",
    transcriptWatchdog: null,
    transcriptPollTimer: null, transcriptPollLastLength: 0,
    autoFlushPending: false, autoFlushTimer: null,
    customFloppyBlob: null,
    preloadFiles: [],
    responseLog: [], responseNavIndex: -1,
    voices: [],
    traceEnabled: false, traceLog: [], traceStartTime: 0,
    /* Device capture buffers */
    deviceCapture: {
        con:  { enabled: false, buffer: "", bytes: 0 },
        com1: { enabled: false, buffer: "", bytes: 0, rawBytes: [] },
        com2: { enabled: false, buffer: "", bytes: 0 },
        lpt1: { enabled: false, buffer: "", bytes: 0 },
    },
    deviceConPrevLines: [],  /* previous screen snapshot for CON diff */
    /* COM2 auto-speak state */
    com2LineBuffer: "",          /* current incomplete line being accumulated */
    com2SpeechPending: [],       /* complete lines waiting to be spoken */
    com2SpeechTimer: null,       /* debounce timer for batching lines */
    com2MuteScreen: false,       /* cached flag: suppress screen speech */
};

/* ── DOM Element References ── */

export const bootBtn = $("boot-btn");
export const bootPromptBtn = $("boot-prompt-btn");
export const statusEl = $("status");
export const commandInput = $("command-input");
export const sendBtn = $("send-btn");
export const enterOnlyBtn = $("enter-only-btn");
export const singleKeyToggle = $("single-key-mode");
export const screenEl = $("accessible-screen");
export const announcer = $("announcer");
export const historyLog = $("history-log");
export const voiceSelect = $("voice-select");
export const rateSlider = $("rate-slider");
export const rateValue = $("rate-value");
export const pitchSlider = $("pitch-slider");
export const pitchValue = $("pitch-value");
export const autoSpeakToggle = $("auto-speak-toggle");
export const speakAfterCmdToggle = $("speak-after-cmd-toggle");
export const skipDecorToggle = $("skip-decorative-toggle");
export const speakScreenBtn = $("speak-screen-btn");
export const speakNewBtn = $("speak-new-btn");
export const speakLastBtn = $("speak-last-btn");
export const stopSpeechBtn = $("stop-speech-btn");
export const testSpeechBtn = $("test-speech-btn");
export const histPrevBtn = $("hist-prev-btn");
export const histNextBtn = $("hist-next-btn");
export const histPosition = $("hist-position");
export const fmRefreshBtn = $("fm-refresh-btn");
export const fmUploadBtn = $("fm-upload-btn");
export const fmDlFloppyBtn = $("fm-dl-floppy-btn");
export const fmUploadInput = $("fm-upload-input");
export const fmStatus = $("fm-status");
export const fmTable = $("fm-table");
export const fmTbody = $("fm-tbody");
export const stateSaveBtn = $("state-save-btn");
export const stateRestoreBtn = $("state-restore-btn");
export const stateRestoreInput = $("state-restore-input");
export const modeIndicator = $("mode-indicator");
export const recordBtn = $("record-btn");
export const downloadTranscriptBtn = $("download-transcript-btn");
export const clearTranscriptBtn = $("clear-transcript-btn");
export const transcriptFilename = $("transcript-filename");
export const transcriptPreview = $("transcript-preview");
export const transcriptStats = $("transcript-stats");
export const typingFeedbackSelect = $("typing-feedback-select");
export const gameSelect = $("game-select");
export const autorunInput = $("autorun-input");
export const diskTypeSelect = $("disk-type-select");
export const customImgInput = $("custom-img-input");
export const loadCustomImgBtn = $("load-custom-img-btn");
export const promptCharInput = $("prompt-char-input");
export const promptDepthSelect = $("prompt-depth-select");
export const transcriptCapState = $("transcript-cap-state");
export const transcriptCapInfo = $("transcript-cap-info");
export const transcriptWatchBtn = $("transcript-watch-btn");
export const transcriptWatchFilename = $("transcript-watch-filename");
export const transcriptPollSpeedSelect = $("transcript-poll-speed");
export const transcriptFlushBtn = $("transcript-flush-btn");
export const transcriptDisconnectBtn = $("transcript-disconnect-btn");
export const transcriptAutoSpeakToggle = $("transcript-auto-speak-toggle");
export const transcriptReplaceScreenToggle = $("transcript-replace-screen-toggle");
export const transcriptMuteScreenToggle = $("transcript-mute-screen-toggle");
export const transcriptAutoFlushToggle = $("transcript-auto-flush-toggle");
export const transcriptAutoFlushOptions = $("transcript-auto-flush-options");
export const transcriptFlushDelay = $("transcript-flush-delay");
export const transcriptFlushD1 = $("transcript-flush-d1");
export const transcriptFlushD2 = $("transcript-flush-d2");
export const transcriptFlushD3 = $("transcript-flush-d3");
export const transcriptFlushTotal = $("transcript-flush-total");
export const transcriptTestReadBtn = $("transcript-test-read-btn");
export const transcriptSpeakLastBtn = $("transcript-speak-last-btn");
export const traceToggleBtn = $("trace-toggle-btn");
export const traceDownloadBtn = $("trace-download-btn");
export const traceClearBtn = $("trace-clear-btn");
export const traceStatus = $("trace-status");
export const traceFSTrackToggle = $("trace-fs-track-toggle");
export const traceFSSnapBtn = $("trace-fs-snap-btn");
export const traceFSDiffBtn = $("trace-fs-diff-btn");
export const histCopyBtn = $("hist-copy-btn");
export const preloadFilesBtn = $("preload-files-btn");
export const preloadFilesInput = $("preload-files-input");
export const preloadFilesList = $("preload-files-list");
export const preloadFilesCount = $("preload-files-count");
export const storedFilesTable = $("stored-files-table");
export const storedFilesTbody = $("stored-files-tbody");
export const storedFilesStatus = $("stored-files-status");

/* Device Monitor DOM references */
export const devConToggle = $("dev-con-toggle");
export const devConStatus = $("dev-con-status");
export const devConDownloadBtn = $("dev-con-download");
export const devConClearBtn = $("dev-con-clear");
export const devCom1Toggle = $("dev-com1-toggle");
export const devCom1Status = $("dev-com1-status");
export const devCom1DownloadBtn = $("dev-com1-download");
export const devCom1ClearBtn = $("dev-com1-clear");
export const devCom2Toggle = $("dev-com2-toggle");
export const devCom2Status = $("dev-com2-status");
export const devCom2DownloadBtn = $("dev-com2-download");
export const devCom2ClearBtn = $("dev-com2-clear");
export const devCom2Preview = $("dev-com2-preview");
export const devLpt1Toggle = $("dev-lpt1-toggle");
export const devLpt1Status = $("dev-lpt1-status");
export const devLpt1DownloadBtn = $("dev-lpt1-download");
export const devLpt1ClearBtn = $("dev-lpt1-clear");
export const devDownloadAllBtn = $("dev-download-all");
export const devClearAllBtn = $("dev-clear-all");
export const devCom1RawToggle = $("dev-com1-raw-toggle");
export const devCom1StripAnsiToggle = $("dev-com1-strip-ansi");
export const devConPreview = $("dev-con-preview");
export const devCom1Preview = $("dev-com1-preview");
export const devLpt1Preview = $("dev-lpt1-preview");

/* COM2 auto-speak DOM references */
export const devCom2SpeakToggle = $("dev-com2-speak-toggle");
export const devCom2MuteScreenToggle = $("dev-com2-mute-screen-toggle");
export const devCom2ReplaceScreenToggle = $("dev-com2-replace-screen-toggle");
