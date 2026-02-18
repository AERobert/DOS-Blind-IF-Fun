export default {
    filename: "castleralf.img",
    label: "Castle Ralf",
    autorun: "RALF.EXE",
    prompt: "> ",
    depth: "last",
    disk: "floppy",
    aliases: [
        { pattern: "^x\\b", replace: "examine", global: true, caseInsensitive: true },
        { pattern: "^l\\b", replace: "look", global: true, caseInsensitive: true },
        { pattern: "^restore\\b", replace: "load", global: true, caseInsensitive: true }
    ]
};
