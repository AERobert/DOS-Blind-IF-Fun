import { gameSelect, aliasSection, aliasesEnabledToggle, aliasTbody, aliasAddBtn, aliasSaveBtn } from './state.js';
import { KNOWN_GAMES } from './game-configs.js';
import { GAME_STORAGE_PREFIX } from './constants.js';
import { announce } from './ui-helpers.js';

/* ═══════════════════════════════════════════
 * Command Aliases
 *
 * Regex-based find/replace aliases applied to commands before they
 * are sent to the emulator. Each alias has:
 *   pattern          - regex pattern string
 *   replace          - replacement string (supports $1, $2 backrefs)
 *   global           - apply globally (default true)
 *   caseInsensitive  - case-insensitive matching (default false)
 *
 * Aliases can come from the game config (static, read-only) or from
 * localStorage (user-defined, editable). User aliases take priority
 * (applied first) and appear at the top of the table.
 * ═══════════════════════════════════════════ */

/* Working copy of user aliases for the edit UI (not yet saved) */
let workingAliases = [];

/* ── Alias data access ── */

/** Get aliases from the current game's config (static, read-only). */
function getConfigAliases() {
    const gameName = gameSelect.value;
    if (!gameName) return [];
    const preset = KNOWN_GAMES[gameName];
    if (!preset || !preset.aliases) return [];
    return preset.aliases;
}

/** Get user-defined aliases from localStorage for the current game. */
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

/** Get all aliases: stored (user) first, then config. */
function getAllAliases() {
    return [...getStoredAliases(), ...getConfigAliases()];
}

/* ── Apply aliases to a command ── */

/**
 * Apply all active aliases to a command string.
 * Returns the transformed string (or the original if aliases are disabled).
 */
export function applyAliases(text) {
    if (!aliasesEnabledToggle || !aliasesEnabledToggle.checked) return text;
    const aliases = getAllAliases();
    for (const alias of aliases) {
        try {
            let flags = '';
            if (alias.global !== false) flags += 'g';
            if (alias.caseInsensitive) flags += 'i';
            const re = new RegExp(alias.pattern, flags);
            text = text.replace(re, alias.replace);
        } catch (e) {
            /* Invalid regex pattern — skip this alias */
        }
    }
    return text;
}

/* ── UI rendering ── */

/** Render the alias table from workingAliases + config aliases. */
export function renderAliasTable() {
    if (!aliasTbody) return;
    aliasTbody.innerHTML = "";

    const configAliases = getConfigAliases();

    /* User (localStorage) aliases — editable rows */
    workingAliases.forEach(function(alias, i) {
        const tr = document.createElement("tr");
        tr.dataset.source = "user";

        /* Pattern cell */
        const tdPattern = document.createElement("td");
        const patternInput = document.createElement("input");
        patternInput.type = "text";
        patternInput.value = alias.pattern;
        patternInput.className = "alias-input";
        patternInput.setAttribute("aria-label", "Regex pattern");
        patternInput.spellcheck = false;
        patternInput.addEventListener("input", function() {
            workingAliases[i].pattern = this.value;
        });
        tdPattern.appendChild(patternInput);
        tr.appendChild(tdPattern);

        /* Replace cell */
        const tdReplace = document.createElement("td");
        const replaceInput = document.createElement("input");
        replaceInput.type = "text";
        replaceInput.value = alias.replace;
        replaceInput.className = "alias-input";
        replaceInput.setAttribute("aria-label", "Replacement text");
        replaceInput.spellcheck = false;
        replaceInput.addEventListener("input", function() {
            workingAliases[i].replace = this.value;
        });
        tdReplace.appendChild(replaceInput);
        tr.appendChild(tdReplace);

        /* Flags cell */
        const tdFlags = document.createElement("td");
        tdFlags.style.cssText = "white-space:nowrap;";

        const globalLabel = document.createElement("label");
        globalLabel.style.cssText = "font-size:0.8rem;margin-right:0.5rem;cursor:pointer;";
        const globalCb = document.createElement("input");
        globalCb.type = "checkbox";
        globalCb.checked = alias.global !== false;
        globalCb.style.cssText = "width:0.9rem;height:0.9rem;accent-color:var(--accent);vertical-align:middle;";
        globalCb.addEventListener("change", function() {
            workingAliases[i].global = this.checked;
        });
        globalLabel.appendChild(globalCb);
        globalLabel.append(" G");
        tdFlags.appendChild(globalLabel);

        const caseiLabel = document.createElement("label");
        caseiLabel.style.cssText = "font-size:0.8rem;cursor:pointer;";
        const caseiCb = document.createElement("input");
        caseiCb.type = "checkbox";
        caseiCb.checked = !!alias.caseInsensitive;
        caseiCb.style.cssText = "width:0.9rem;height:0.9rem;accent-color:var(--accent);vertical-align:middle;";
        caseiCb.addEventListener("change", function() {
            workingAliases[i].caseInsensitive = this.checked;
        });
        caseiLabel.appendChild(caseiCb);
        caseiLabel.append(" I");
        tdFlags.appendChild(caseiLabel);

        tr.appendChild(tdFlags);

        /* Actions cell */
        const tdActions = document.createElement("td");
        tdActions.style.cssText = "white-space:nowrap;";

        const upBtn = document.createElement("button");
        upBtn.className = "btn-secondary btn-sm";
        upBtn.textContent = "\u25B2";
        upBtn.title = "Move up (higher priority)";
        upBtn.setAttribute("aria-label", "Move alias up");
        upBtn.disabled = (i === 0);
        upBtn.addEventListener("click", function() { moveAlias(i, -1); });

        const downBtn = document.createElement("button");
        downBtn.className = "btn-secondary btn-sm";
        downBtn.textContent = "\u25BC";
        downBtn.title = "Move down (lower priority)";
        downBtn.setAttribute("aria-label", "Move alias down");
        downBtn.disabled = (i === workingAliases.length - 1);
        downBtn.addEventListener("click", function() { moveAlias(i, 1); });

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-secondary btn-sm";
        removeBtn.textContent = "\u00D7";
        removeBtn.title = "Remove alias";
        removeBtn.setAttribute("aria-label", "Remove alias");
        removeBtn.addEventListener("click", function() { removeAlias(i); });

        tdActions.appendChild(upBtn);
        tdActions.append(" ");
        tdActions.appendChild(downBtn);
        tdActions.append(" ");
        tdActions.appendChild(removeBtn);
        tr.appendChild(tdActions);

        aliasTbody.appendChild(tr);
    });

    /* Config aliases — read-only rows at the bottom */
    configAliases.forEach(function(alias) {
        const tr = document.createElement("tr");
        tr.dataset.source = "config";
        tr.className = "alias-config-row";

        const tdPattern = document.createElement("td");
        const code1 = document.createElement("code");
        code1.textContent = alias.pattern;
        tdPattern.appendChild(code1);
        tr.appendChild(tdPattern);

        const tdReplace = document.createElement("td");
        const code2 = document.createElement("code");
        code2.textContent = alias.replace;
        tdReplace.appendChild(code2);
        tr.appendChild(tdReplace);

        const tdFlags = document.createElement("td");
        tdFlags.style.cssText = "white-space:nowrap;font-size:0.8rem;";
        var flagParts = [];
        if (alias.global !== false) flagParts.push("G");
        if (alias.caseInsensitive) flagParts.push("I");
        tdFlags.textContent = flagParts.join(" ") || "\u2014";
        tr.appendChild(tdFlags);

        const tdActions = document.createElement("td");
        tdActions.style.cssText = "font-size:0.8rem;color:var(--text-secondary);";
        tdActions.textContent = "(config)";
        tr.appendChild(tdActions);

        aliasTbody.appendChild(tr);
    });
}

/* ── UI actions ── */

function moveAlias(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= workingAliases.length) return;
    const temp = workingAliases[index];
    workingAliases[index] = workingAliases[newIndex];
    workingAliases[newIndex] = temp;
    renderAliasTable();
}

function removeAlias(index) {
    workingAliases.splice(index, 1);
    renderAliasTable();
}

function addAlias() {
    workingAliases.unshift({
        pattern: "",
        replace: "",
        global: true,
        caseInsensitive: false
    });
    renderAliasTable();
    /* Focus the pattern input of the new row */
    const firstInput = aliasTbody.querySelector("tr[data-source='user'] .alias-input");
    if (firstInput) firstInput.focus();
}

function saveAliasChanges() {
    const gameName = gameSelect.value;
    if (!gameName) return;

    /* Filter out aliases with empty patterns */
    const toSave = workingAliases.filter(function(a) { return a.pattern.trim() !== ""; });

    try {
        const raw = localStorage.getItem(GAME_STORAGE_PREFIX + gameName);
        const s = raw ? JSON.parse(raw) : {};
        s.aliases = toSave;
        s.aliasesEnabled = aliasesEnabledToggle.checked;
        localStorage.setItem(GAME_STORAGE_PREFIX + gameName, JSON.stringify(s));
    } catch (e) {}

    /* Update working copy to match saved (removes empty-pattern entries) */
    workingAliases = toSave.map(function(a) {
        return { pattern: a.pattern, replace: a.replace, global: a.global, caseInsensitive: a.caseInsensitive };
    });
    renderAliasTable();

    /* Collapse the section */
    if (aliasSection) aliasSection.open = false;

    announce("Aliases saved.");
}

/* ── Initialization ── */

/**
 * Initialize alias UI for the currently selected game.
 * Called when game settings are loaded (game change or page load).
 */
export function initAliasesForGame() {
    /* Load stored user aliases into the working copy */
    workingAliases = getStoredAliases().map(function(a) {
        return { pattern: a.pattern, replace: a.replace, global: a.global, caseInsensitive: a.caseInsensitive };
    });

    renderAliasTable();

    /* Set the enabled toggle default:
     * If a saved value exists in localStorage, use it.
     * Otherwise, default ON if any aliases exist (config or stored), OFF if none. */
    if (aliasesEnabledToggle) {
        const gameName = gameSelect.value;
        let savedEnabled;
        try {
            const raw = localStorage.getItem(GAME_STORAGE_PREFIX + gameName);
            if (raw) {
                const s = JSON.parse(raw);
                if (s.aliasesEnabled !== undefined) savedEnabled = s.aliasesEnabled;
            }
        } catch (e) {}

        if (savedEnabled !== undefined) {
            aliasesEnabledToggle.checked = savedEnabled;
        } else {
            const configAliases = getConfigAliases();
            const hasAny = workingAliases.length > 0 || configAliases.length > 0;
            aliasesEnabledToggle.checked = hasAny;
        }
    }
}

/* ── Event listeners ── */

if (aliasAddBtn) aliasAddBtn.addEventListener("click", addAlias);
if (aliasSaveBtn) aliasSaveBtn.addEventListener("click", saveAliasChanges);

/* Save the enabled toggle to localStorage immediately when changed */
if (aliasesEnabledToggle) {
    aliasesEnabledToggle.addEventListener("change", function() {
        const gameName = gameSelect.value;
        if (!gameName) return;
        try {
            const raw = localStorage.getItem(GAME_STORAGE_PREFIX + gameName);
            const s = raw ? JSON.parse(raw) : {};
            s.aliasesEnabled = aliasesEnabledToggle.checked;
            localStorage.setItem(GAME_STORAGE_PREFIX + gameName, JSON.stringify(s));
        } catch (e) {}
    });
}
