export default {
    platform: "c64",
    filename: "zork1-c64.d64",
    label: "Zork I (C64)",
    autorun: "LOAD \"*\",8,1\nRUN\n",  /* Standard C64 disk load sequence */
    prompt: ">",
    depth: "below",
    disk: "floppy",
    diskFormat: "d64",
    notes: "The Great Underground Empire on the Commodore 64. " +
           "170KB .d64 disk image. Type LOAD \"*\",8,1 then RUN to start. " +
           "The C64 version runs well with full Infocom parser.",
    source: "https://ifarchive.org/ or https://www.lemon64.com/",
};
