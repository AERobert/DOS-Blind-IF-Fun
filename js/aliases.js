import { gameSelect } from './state.js';
import { KNOWN_GAMES } from './game-configs.js';
import { GAME_STORAGE_PREFIX } from './constants.js';
import { announce } from './ui-helpers.js';

/* Resolve alias DOM elements locally to avoid circular-import issues
   (settings.js → aliases.js → state.js all load at startup) */
const aliasSection = document.getElementById("alias-section");
const aliasesEnabledToggle = document.getElementById("aliases-enabled-toggle");
const aliasList = document.getElementById("alias-list");
const aliasAddRegexBtn = document.getElementById("alias-add-regex-btn");
const aliasAddMacroBtn = document.getElementById("alias-add-macro-btn");
const aliasSaveBtn = document.getElementById("alias-save-btn");
const aliasMacroDelay = document.getElementById("alias-macro-delay");

/* ═══════════════════════════════════════════
 * Command Aliases
 *
 * Two alias types:
 *   "regex" — regex find/replace on the command text
 *     { type:"regex", pattern, replace, global (default true), caseInsensitive (default false) }
 *   "macro" — exact-match trigger that expands to multiple semicolon-separated commands
 *     { type:"macro", pattern (trigger), replace (commands joined by ;) }
 *
 * Aliases can come from game configs (static) or localStorage (user-editable).
 * User aliases take priority (applied first) and appear at the top of the list.
 * ═══════════════════════════════════════════ */

/* Working copy of user aliases for the edit UI (not yet saved) */
let workingAliases = [];

/* ── Alias data access ── */

function getConfigAliases() {
    const gameName = gameSelect.value;
    if (!gameName) return [];
    const preset = KNOWN_GAMES[gameName];
    if (!preset || !preset.aliases) return [];
    return preset.aliases;
}

function getStoredAliases() {
    const gameName = gameSelect.value;
    if (!gameName) return [];
    try {
        const raw = localStorage.getItem(GAME_STORAGE_PREFIX + gameName);
        if (!raw) return [];
        const s = JSON.parse(raw);
        return s.aliases || [];
    } catch (e) {
        return [];
    }
}

function getAllAliases() {
    return [...getStoredAliases(), ...getConfigAliases()];
}

/* ── Apply aliases to a command ── */

/**
 * Apply all active aliases to a command string.
 * Returns a string for single commands, or an array of strings for macro expansion.
 */
export function applyAliases(text) {
    if (!aliasesEnabledToggle || !aliasesEnabledToggle.checked) return text;
    const aliases = getAllAliases();

    /* First pass: check for exact macro matches (case-insensitive) */
    var trimmed = text.trim();
    for (const alias of aliases) {
        if ((alias.type === "macro") && alias.pattern &&
            trimmed.toLowerCase() === alias.pattern.trim().toLowerCase()) {
            return alias.replace.split(";").map(function(cmd) { return cmd.trim(); }).filter(function(cmd) { return cmd; });
        }
    }

    /* Second pass: apply regex aliases */
    for (const alias of aliases) {
        if (alias.type === "macro") continue;
        try {
            let flags = '';
            if (alias.global !== false) flags += 'g';
            if (alias.caseInsensitive) flags += 'i';
            const re = new RegExp(alias.pattern, flags);
            text = text.replace(re, alias.replace);
        } catch (e) {
            /* Invalid regex pattern — skip */
        }
    }
    return text;
}

/**
 * Get the configured delay (ms) between macro commands.
 */
export function getMultiCommandDelay() {
    const val = aliasMacroDelay ? parseInt(aliasMacroDelay.value, 10) : 500;
    return Math.max(100, Math.min(5000, val || 500));
}

/* ── UI rendering (list-based) ── */

/** Render the alias list from workingAliases + config aliases. */
export function renderAliasList() {
    if (!aliasList) return;
    aliasList.innerHTML = "";

    const configAliases = getConfigAliases();

    /* User (localStorage) aliases — editable items */
    workingAliases.forEach(function(alias, i) {
        var li = document.createElement("li");
        li.className = "alias-item";
        var isMacro = alias.type === "macro";

        /* Type badge */
        var badge = document.createElement("span");
        badge.className = "alias-type-badge " + (isMacro ? "macro" : "regex");
        badge.textContent = isMacro ? "Macro" : "Regex";
        li.appendChild(badge);

        if (isMacro) {
            /* Trigger field */
            var trigLabel = document.createElement("label");
            trigLabel.className = "alias-field";
            var trigSpan = document.createElement("span");
            trigSpan.className = "alias-field-label";
            trigSpan.textContent = "Trigger:";
            trigLabel.appendChild(trigSpan);
            var trigInput = document.createElement("input");
            trigInput.type = "text";
            trigInput.value = alias.pattern;
            trigInput.className = "alias-input";
            trigInput.setAttribute("aria-label", "Macro trigger text");
            trigInput.spellcheck = false;
            trigInput.addEventListener("input", function() { workingAliases[i].pattern = this.value; });
            trigLabel.appendChild(trigInput);
            li.appendChild(trigLabel);

            /* Commands field */
            var cmdLabel = document.createElement("label");
            cmdLabel.className = "alias-field alias-field-wide";
            var cmdSpan = document.createElement("span");
            cmdSpan.className = "alias-field-label";
            cmdSpan.textContent = "Commands:";
            cmdLabel.appendChild(cmdSpan);
            var cmdInput = document.createElement("input");
            cmdInput.type = "text";
            cmdInput.value = alias.replace;
            cmdInput.className = "alias-input";
            cmdInput.setAttribute("aria-label", "Commands separated by semicolons");
            cmdInput.placeholder = "cmd1; cmd2; cmd3";
            cmdInput.spellcheck = false;
            cmdInput.addEventListener("input", function() { workingAliases[i].replace = this.value; });
            cmdLabel.appendChild(cmdInput);
            li.appendChild(cmdLabel);
        } else {
            /* Pattern field */
            var patLabel = document.createElement("label");
            patLabel.className = "alias-field";
            var patSpan = document.createElement("span");
            patSpan.className = "alias-field-label";
            patSpan.textContent = "Pattern:";
            patLabel.appendChild(patSpan);
            var patInput = document.createElement("input");
            patInput.type = "text";
            patInput.value = alias.pattern;
            patInput.className = "alias-input";
            patInput.setAttribute("aria-label", "Regex pattern");
            patInput.spellcheck = false;
            patInput.addEventListener("input", function() { workingAliases[i].pattern = this.value; });
            patLabel.appendChild(patInput);
            li.appendChild(patLabel);

            /* Replace field */
            var repLabel = document.createElement("label");
            repLabel.className = "alias-field";
            var repSpan = document.createElement("span");
            repSpan.className = "alias-field-label";
            repSpan.textContent = "Replace:";
            repLabel.appendChild(repSpan);
            var repInput = document.createElement("input");
            repInput.type = "text";
            repInput.value = alias.replace;
            repInput.className = "alias-input";
            repInput.setAttribute("aria-label", "Replacement text");
            repInput.spellcheck = false;
            repInput.addEventListener("input", function() { workingAliases[i].replace = this.value; });
            repLabel.appendChild(repInput);
            li.appendChild(repLabel);

            /* Flags */
            var flagsSpan = document.createElement("span");
            flagsSpan.className = "alias-flags";

            var gLabel = document.createElement("label");
            var gCb = document.createElement("input");
            gCb.type = "checkbox";
            gCb.checked = alias.global !== false;
            gCb.style.cssText = "width:0.9rem;height:0.9rem;accent-color:var(--accent);";
            gCb.addEventListener("change", function() { workingAliases[i].global = this.checked; });
            gLabel.appendChild(gCb);
            gLabel.append(" G");
            flagsSpan.appendChild(gLabel);

            var iLabel = document.createElement("label");
            var iCb = document.createElement("input");
            iCb.type = "checkbox";
            iCb.checked = !!alias.caseInsensitive;
            iCb.style.cssText = "width:0.9rem;height:0.9rem;accent-color:var(--accent);";
            iCb.addEventListener("change", function() { workingAliases[i].caseInsensitive = this.checked; });
            iLabel.appendChild(iCb);
            iLabel.append(" I");
            flagsSpan.appendChild(iLabel);

            li.appendChild(flagsSpan);
        }

        /* Action buttons */
        var actions = document.createElement("span");
        actions.className = "alias-actions";

        var upBtn = document.createElement("button");
        upBtn.className = "btn-secondary btn-sm";
        upBtn.textContent = "\u25B2";
        upBtn.title = "Move up (higher priority)";
        upBtn.setAttribute("aria-label", "Move alias up");
        upBtn.disabled = (i === 0);
        upBtn.addEventListener("click", function() { moveAlias(i, -1); });

        var downBtn = document.createElement("button");
        downBtn.className = "btn-secondary btn-sm";
        downBtn.textContent = "\u25BC";
        downBtn.title = "Move down (lower priority)";
        downBtn.setAttribute("aria-label", "Move alias down");
        downBtn.disabled = (i === workingAliases.length - 1);
        downBtn.addEventListener("click", function() { moveAlias(i, 1); });

        var removeBtn = document.createElement("button");
        removeBtn.className = "btn-secondary btn-sm";
        removeBtn.textContent = "\u00D7";
        removeBtn.title = "Remove alias";
        removeBtn.setAttribute("aria-label", "Remove alias");
        removeBtn.addEventListener("click", function() { removeAlias(i); });

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(removeBtn);
        li.appendChild(actions);

        aliasList.appendChild(li);
    });

    /* Config aliases — read-only items at the bottom */
    configAliases.forEach(function(alias) {
        var li = document.createElement("li");
        li.className = "alias-item alias-config-row";
        var isMacro = alias.type === "macro";

        var badge = document.createElement("span");
        badge.className = "alias-type-badge " + (isMacro ? "macro" : "regex");
        badge.textContent = isMacro ? "Macro" : "Regex";
        li.appendChild(badge);

        if (isMacro) {
            var trigField = document.createElement("span");
            trigField.className = "alias-field";
            var trigLbl = document.createElement("span");
            trigLbl.className = "alias-field-label";
            trigLbl.textContent = "Trigger:";
            trigField.appendChild(trigLbl);
            var trigCode = document.createElement("code");
            trigCode.textContent = alias.pattern;
            trigField.appendChild(trigCode);
            li.appendChild(trigField);

            var cmdField = document.createElement("span");
            cmdField.className = "alias-field";
            var cmdLbl = document.createElement("span");
            cmdLbl.className = "alias-field-label";
            cmdLbl.textContent = "Commands:";
            cmdField.appendChild(cmdLbl);
            var cmdCode = document.createElement("code");
            cmdCode.textContent = alias.replace;
            cmdField.appendChild(cmdCode);
            li.appendChild(cmdField);
        } else {
            var patField = document.createElement("span");
            patField.className = "alias-field";
            var patLbl = document.createElement("span");
            patLbl.className = "alias-field-label";
            patLbl.textContent = "Pattern:";
            patField.appendChild(patLbl);
            var patCode = document.createElement("code");
            patCode.textContent = alias.pattern;
            patField.appendChild(patCode);
            li.appendChild(patField);

            var repField = document.createElement("span");
            repField.className = "alias-field";
            var repLbl = document.createElement("span");
            repLbl.className = "alias-field-label";
            repLbl.textContent = "Replace:";
            repField.appendChild(repLbl);
            var repCode = document.createElement("code");
            repCode.textContent = alias.replace;
            repField.appendChild(repCode);
            li.appendChild(repField);

            var flagsText = document.createElement("span");
            flagsText.className = "alias-flags";
            var parts = [];
            if (alias.global !== false) parts.push("G");
            if (alias.caseInsensitive) parts.push("I");
            flagsText.textContent = parts.join(" ") || "\u2014";
            li.appendChild(flagsText);
        }

        var cfgLabel = document.createElement("span");
        cfgLabel.className = "alias-actions";
        cfgLabel.style.color = "var(--text-secondary)";
        cfgLabel.style.fontSize = "0.8rem";
        cfgLabel.textContent = "(config)";
        li.appendChild(cfgLabel);

        aliasList.appendChild(li);
    });
}

/* ── UI actions ── */

function moveAlias(index, direction) {
    var newIndex = index + direction;
    if (newIndex < 0 || newIndex >= workingAliases.length) return;
    var temp = workingAliases[index];
    workingAliases[index] = workingAliases[newIndex];
    workingAliases[newIndex] = temp;
    renderAliasList();
}

function removeAlias(index) {
    workingAliases.splice(index, 1);
    renderAliasList();
}

function addRegexAlias() {
    workingAliases.unshift({
        type: "regex",
        pattern: "",
        replace: "",
        global: true,
        caseInsensitive: false
    });
    renderAliasList();
    focusFirstInput();
}

function addMacroAlias() {
    workingAliases.unshift({
        type: "macro",
        pattern: "",
        replace: ""
    });
    renderAliasList();
    focusFirstInput();
}

function focusFirstInput() {
    if (!aliasList) return;
    var firstInput = aliasList.querySelector("li:first-child .alias-input");
    if (firstInput) firstInput.focus();
}

function saveAliasChanges() {
    var gameName = gameSelect.value;
    if (!gameName) return;

    /* Filter out aliases with empty patterns */
    var toSave = workingAliases.filter(function(a) { return a.pattern.trim() !== ""; });

    try {
        var raw = localStorage.getItem(GAME_STORAGE_PREFIX + gameName);
        var s = raw ? JSON.parse(raw) : {};
        s.aliases = toSave;
        s.aliasesEnabled = aliasesEnabledToggle.checked;
        if (aliasMacroDelay) s.aliasMacroDelay = parseInt(aliasMacroDelay.value, 10) || 500;
        localStorage.setItem(GAME_STORAGE_PREFIX + gameName, JSON.stringify(s));
    } catch (e) {}

    workingAliases = toSave.map(function(a) {
        var copy = { type: a.type || "regex", pattern: a.pattern, replace: a.replace };
        if (copy.type === "regex") {
            copy.global = a.global;
            copy.caseInsensitive = a.caseInsensitive;
        }
        return copy;
    });
    renderAliasList();

    if (aliasSection) aliasSection.open = false;
    announce("Aliases saved.");
}

/* ── Initialization ── */

/**
 * Initialize alias UI for the currently selected game.
 * Called when game settings are loaded (game change or page load).
 */
export function initAliasesForGame() {
    workingAliases = getStoredAliases().map(function(a) {
        var copy = { type: a.type || "regex", pattern: a.pattern, replace: a.replace };
        if (copy.type === "regex") {
            copy.global = a.global;
            copy.caseInsensitive = a.caseInsensitive;
        }
        return copy;
    });

    renderAliasList();

    /* Set enabled toggle default */
    if (aliasesEnabledToggle) {
        var gameName = gameSelect.value;
        var savedEnabled;
        var savedDelay;
        try {
            var raw = localStorage.getItem(GAME_STORAGE_PREFIX + gameName);
            if (raw) {
                var s = JSON.parse(raw);
                if (s.aliasesEnabled !== undefined) savedEnabled = s.aliasesEnabled;
                if (s.aliasMacroDelay !== undefined) savedDelay = s.aliasMacroDelay;
            }
        } catch (e) {}

        if (savedEnabled !== undefined) {
            aliasesEnabledToggle.checked = savedEnabled;
        } else {
            var configAliases = getConfigAliases();
            var hasAny = workingAliases.length > 0 || configAliases.length > 0;
            aliasesEnabledToggle.checked = hasAny;
        }

        if (aliasMacroDelay) {
            aliasMacroDelay.value = savedDelay || 500;
        }
    }
}

/* ── Event listeners ── */

if (aliasAddRegexBtn) aliasAddRegexBtn.addEventListener("click", addRegexAlias);
if (aliasAddMacroBtn) aliasAddMacroBtn.addEventListener("click", addMacroAlias);
if (aliasSaveBtn) aliasSaveBtn.addEventListener("click", saveAliasChanges);

if (aliasesEnabledToggle) {
    aliasesEnabledToggle.addEventListener("change", function() {
        var gameName = gameSelect.value;
        if (!gameName) return;
        try {
            var raw = localStorage.getItem(GAME_STORAGE_PREFIX + gameName);
            var s = raw ? JSON.parse(raw) : {};
            s.aliasesEnabled = aliasesEnabledToggle.checked;
            localStorage.setItem(GAME_STORAGE_PREFIX + gameName, JSON.stringify(s));
        } catch (e) {}
    });
}
