export default {
    filename: "timequest.img",
    label: "Time Quest",
    autorun: "TQ.EXE",
    prompt: ">",
    depth: "below",
    disk: "hdd",
    graphics: true,
    textcap: true,
    aliases: [
        { type: "macro", pattern: "asu", replace: "full mode; script; COM2" }
    ]
};
