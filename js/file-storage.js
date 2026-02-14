"use strict";

/* ═══════════════════════════════════════════
 * IndexedDB Persistent File Storage
 *
 * Stores game files (saves, patches, etc.) across browser sessions.
 * Files are tagged with which game they belong to and shown in the
 * setup screen where the user can check which ones to load at boot.
 * ═══════════════════════════════════════════ */

const FILE_DB_NAME = "dos-player-files";
const FILE_DB_VERSION = 1;
const FILE_STORE_NAME = "files";

let fileDB = null;

/* ── Database operations ── */

function openFileDB() {
    return new Promise(function(resolve, reject) {
        if (!window.indexedDB) { reject(new Error("IndexedDB not supported")); return; }
        var req = indexedDB.open(FILE_DB_NAME, FILE_DB_VERSION);
        req.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
                var store = db.createObjectStore(FILE_STORE_NAME, { keyPath: "key" });
                store.createIndex("game", "game", { unique: false });
                store.createIndex("name", "name", { unique: false });
            }
        };
        req.onsuccess = function(e) {
            fileDB = e.target.result;
            resolve(fileDB);
        };
        req.onerror = function(e) { reject(e.target.error); };
    });
}

/**
 * Save a file to persistent storage.
 * @param {string} name     DOS filename (e.g. "SAVE1.DAT")
 * @param {ArrayBuffer|Uint8Array} data  File contents
 * @param {string} game     Game image filename (e.g. "tzero-data.img")
 */
function saveFileToStorage(name, data, game) {
    return new Promise(function(resolve, reject) {
        if (!fileDB) { reject(new Error("DB not open")); return; }
        /* Normalize data to ArrayBuffer */
        var ab = data;
        if (data instanceof Uint8Array) {
            ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }
        var gameLabel = (KNOWN_GAMES[game] && KNOWN_GAMES[game].label) || game || "Custom";
        var record = {
            key: (game || "unknown") + ":" + name.toUpperCase(),
            name: name.toUpperCase(),
            data: ab,
            size: ab.byteLength,
            game: game || "unknown",
            gameLabel: gameLabel,
            timestamp: Date.now()
        };
        var tx = fileDB.transaction(FILE_STORE_NAME, "readwrite");
        var store = tx.objectStore(FILE_STORE_NAME);
        var req = store.put(record);
        req.onsuccess = function() { resolve(); };
        req.onerror = function(e) { reject(e.target.error); };
    });
}

function removeFileFromStorage(key) {
    return new Promise(function(resolve, reject) {
        if (!fileDB) { reject(new Error("DB not open")); return; }
        var tx = fileDB.transaction(FILE_STORE_NAME, "readwrite");
        var store = tx.objectStore(FILE_STORE_NAME);
        var req = store.delete(key);
        req.onsuccess = function() { resolve(); };
        req.onerror = function(e) { reject(e.target.error); };
    });
}

function listStoredFiles() {
    return new Promise(function(resolve, reject) {
        if (!fileDB) { reject(new Error("DB not open")); return; }
        var tx = fileDB.transaction(FILE_STORE_NAME, "readonly");
        var store = tx.objectStore(FILE_STORE_NAME);
        var req = store.getAll();
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function(e) { reject(e.target.error); };
    });
}

function getStoredFile(key) {
    return new Promise(function(resolve, reject) {
        if (!fileDB) { reject(new Error("DB not open")); return; }
        var tx = fileDB.transaction(FILE_STORE_NAME, "readonly");
        var store = tx.objectStore(FILE_STORE_NAME);
        var req = store.get(key);
        req.onsuccess = function() { resolve(req.result || null); };
        req.onerror = function(e) { reject(e.target.error); };
    });
}

/* ── Stored files UI (Setup section table) ── */

/**
 * Render the stored files table in the Setup section.
 * Files matching the currently selected game are checked by default.
 */
async function renderStoredFilesTable() {
    var tbody = storedFilesTbody;
    tbody.innerHTML = "";

    try {
        var files = await listStoredFiles();
        if (files.length === 0) {
            storedFilesStatus.textContent = "No stored files yet. Save files from the File Manager after booting a game.";
            storedFilesTable.style.display = "none";
            return;
        }

        var currentGame = gameSelect.value;
        storedFilesStatus.textContent = files.length + " file(s) in storage.";
        storedFilesTable.style.display = "";

        /* Sort: current game files first, then alphabetically */
        files.sort(function(a, b) {
            if (a.game === currentGame && b.game !== currentGame) return -1;
            if (a.game !== currentGame && b.game === currentGame) return 1;
            return a.name.localeCompare(b.name);
        });

        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var tr = document.createElement("tr");

            /* Checkbox */
            var tdCheck = document.createElement("td");
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = (f.game === currentGame);
            cb.dataset.fileKey = f.key;
            cb.setAttribute("aria-label", "Load " + f.name);
            tdCheck.appendChild(cb);
            tr.appendChild(tdCheck);

            /* Name */
            var tdName = document.createElement("td");
            tdName.textContent = f.name;
            tr.appendChild(tdName);

            /* Size */
            var tdSize = document.createElement("td");
            tdSize.textContent = formatSize(f.size);
            tr.appendChild(tdSize);

            /* Game */
            var tdGame = document.createElement("td");
            tdGame.textContent = f.gameLabel;
            tr.appendChild(tdGame);

            /* Actions */
            var tdAct = document.createElement("td");
            var rmBtn = document.createElement("button");
            rmBtn.className = "btn-secondary btn-sm";
            rmBtn.textContent = "Remove";
            rmBtn.title = "Remove from storage";
            rmBtn.setAttribute("aria-label", "Remove " + f.name + " from storage");
            rmBtn.dataset.fileKey = f.key;
            rmBtn.addEventListener("click", function() {
                var key = this.dataset.fileKey;
                removeFileFromStorage(key).then(function() {
                    renderStoredFilesTable();
                    announce("Removed from storage.");
                });
            });
            tdAct.appendChild(rmBtn);
            tr.appendChild(tdAct);

            tbody.appendChild(tr);
        }
    } catch(e) {
        storedFilesStatus.textContent = "File storage unavailable.";
        storedFilesTable.style.display = "none";
    }
}

/**
 * Get file data for all checked stored files (for injection at boot).
 * Returns array of { name: string, data: ArrayBuffer }.
 */
async function getCheckedStoredFileData() {
    var result = [];
    var checkboxes = storedFilesTbody.querySelectorAll('input[type="checkbox"]:checked');
    for (var i = 0; i < checkboxes.length; i++) {
        var key = checkboxes[i].dataset.fileKey;
        var record = await getStoredFile(key);
        if (record) {
            result.push({ name: record.name, data: record.data });
        }
    }
    return result;
}

/* Re-render table when game selection changes (to update auto-check state) */
gameSelect.addEventListener("change", function() {
    if (fileDB) renderStoredFilesTable();
});

/* Initialize DB and render table on load */
openFileDB().then(function() {
    renderStoredFilesTable();
}).catch(function(e) {
    console.error("Failed to open file storage DB:", e);
    storedFilesStatus.textContent = "File storage unavailable.";
});
