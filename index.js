"use strict";

const fs = require("fs");
const { spawn } = require("child_process");

const SEP = Buffer.from("\n\n");
const ENTER = "\x1b[?1049h\x1b[?25l";
const RESTORE = "\x1b[?2026l\x1b[0m\x1b[?25h\x1b[?1049l";

const USAGE = [
    "Usage: node index.js [--audio <file>] [--dump <file>]",
    "",
    "  --audio <file>  Play audio with ffplay while rendering",
    "  --dump <file>   Write the first and last frame to <file> and exit",
].join("\n");

// ---- terminal state (restore runs exactly once, on every exit path) ----

let audio = null;
let drawMode = false;
let restored = false;

function restore() {
    if (restored) return;
    restored = true;
    if (!drawMode) return; // never touched the terminal, nothing to undo
    try {
        process.stdout.write(RESTORE);
    } catch (e) {}
}

function killAudio() {
    if (!audio) return;
    try {
        audio.kill();
    } catch (e) {}
    audio = null;
}

function shutdown(code) {
    restore();
    killAudio();
    process.exit(code);
}

process.on("exit", restore); // last-resort safety net

process.on("SIGINT", () => {
    shutdown(0);
});

process.on("uncaughtException", (err) => {
    restore();
    killAudio();
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
});

process.stdout.on("error", (err) => {
    if (err && err.code === "EPIPE") {
        shutdown(0); // quietly
        return;
    }
    throw err;
});

// ---- CLI ----

function parseArgs(argv) {
    const opts = { audio: null, dump: null };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === "--audio" || flag === "--dump") {
            const value = argv[++i];
            if (value === undefined) {
                console.error(USAGE);
                process.exit(1);
            }
            opts[flag.slice(2)] = value;
        } else {
            console.error(USAGE);
            process.exit(1);
        }
    }
    return opts;
}

const opts = parseArgs(process.argv.slice(2));

// ---- load + index ----

let buf;
try {
    buf = fs.readFileSync("data.txt");
} catch (e) {
    console.error("Could not read data.txt - run npm run prepare first.");
    process.exit(1);
}

let meta;
try {
    meta = JSON.parse(fs.readFileSync("data.meta.json", "utf8"));
} catch (e) {
    console.error("Could not read data.meta.json - run npm run prepare first.");
    process.exit(1);
}

const frames = [];
{
    let start = 0;
    for (let i = buf.indexOf(SEP); i !== -1; i = buf.indexOf(SEP, i + 2)) {
        frames.push({ start, end: i });
        start = i + 2;
    }
    if (start < buf.length) frames.push({ start, end: buf.length }); // non-empty tail without separator
}

if (frames.length === 0) {
    console.error("data.txt contains no frames - run npm run prepare first.");
    process.exit(1);
}
if (frames.length !== meta.frameCount) {
    console.error(
        `Warning: data.meta.json says ${meta.frameCount} frames, data.txt indexes ${frames.length}; playing the indexed frames.`
    );
}
const fps = Number(meta.fps);
if (!(fps > 0)) {
    console.error("data.meta.json has an invalid fps - run npm run prepare first.");
    process.exit(1);
}

// only the current frame is ever decoded
function decodeFrame(i) {
    const f = frames[i];
    return buf.toString("utf8", f.start, f.end);
}

// ---- dump mode (no alt screen, no cursor changes) ----

if (opts.dump) {
    const out = decodeFrame(0) + "\n\n===SPLIT===\n\n" + decodeFrame(frames.length - 1);
    try {
        fs.writeFileSync(opts.dump, out);
    } catch (e) {
        console.error(`Could not write ${opts.dump}: ${e.message}`);
        process.exit(1);
    }
    console.log(`Dumped first + last frame to ${opts.dump} (${frames.length} frames indexed).`);
    process.exit(0);
}

// ---- playback preflight (printed before the alt screen) ----

console.log(`Source     : ${meta.source}`);
console.log(`Grid       : ${meta.cols}x${meta.rows}`);
console.log(`FPS        : ${meta.fps}`);
console.log(`Frames     : ${frames.length}`);
console.log(`Color mode : ${meta.colorMode}`);

if (typeof process.stdout.columns === "number") {
    const curCols = process.stdout.columns;
    const curRows = process.stdout.rows;
    if (curCols < meta.cols || curRows < meta.rows) {
        console.error(
            `Terminal too small: need at least ${meta.cols}x${meta.rows} cells, current ${curCols}x${curRows}. ` +
                `Resize the terminal or re-run prepare with smaller --cols/--rows.`
        );
        process.exit(1);
    }
}
// not a TTY (piped) -> size check skipped silently

// ---- audio ----

if (opts.audio) {
    audio = spawn("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", opts.audio], {
        stdio: "ignore",
    });
    audio.on("error", () => {
        console.error("ffplay not found - continuing without audio");
        audio = null;
    });
}

// ---- draw mode + time-based playback ----

drawMode = true;
process.stdout.write(ENTER);

const t0 = Date.now();
let lastDrawnIndex = -1;

function tick() {
    const index = Math.floor(((Date.now() - t0) / 1000) * fps);
    if (index >= frames.length) {
        shutdown(0); // natural end: restore, kill audio, exit 0 cleanly
        return;
    }
    if (index !== lastDrawnIndex) {
        lastDrawnIndex = index;
        process.stdout.write("\x1b[?2026h\x1b[H" + decodeFrame(index) + "\x1b[?2026l");
    }
    setTimeout(tick, 1000 / fps);
}
tick();
