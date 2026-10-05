"use strict";

const fs = require("fs");
const { spawn } = require("child_process");

const SEP = Buffer.from("\n\n");
const ENTER = "\x1b[?1049h\x1b[?25l";
const RESTORE = "\x1b[?2026l\x1b[0m\x1b[?25h\x1b[?1049l";

const USAGE = [
    "Usage: node index.js [--audio <file>] [--no-audio] [--loops <n>] [--dump <file>]",
    "",
    "  --audio <file>  Play audio with ffplay while rendering",
    "  --no-audio      Disable audio entirely",
    "  --loops <n>     Play n times total, then exit (default 1)",
    "  --dump <file>   Write the first and last frame to <file> and exit",
].join("\n");

// ---- terminal state (restore runs exactly once, on every exit path) ----

let audio = null;
let drawMode = false;
let restored = false;

function restore() {
    if (restored) return;
    restored = true;
    try {
        process.stdin.setRawMode(false);
    } catch (e) {}
    try {
        process.stdin.pause();
    } catch (e) {}
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
    const opts = { audio: null, dump: null, noAudio: false, loops: 1 };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === "--no-audio") {
            opts.noAudio = true;
            continue;
        }
        if (flag === "--audio" || flag === "--dump" || flag === "--loops") {
            const value = argv[++i];
            if (value === undefined) {
                console.error(USAGE);
                process.exit(1);
            }
            if (flag === "--loops") {
                const n = Number(value);
                if (!Number.isInteger(n) || n < 1) {
                    console.error("--loops must be a positive integer.");
                    process.exit(1);
                }
                opts.loops = n;
            } else {
                opts[flag.slice(2)] = value;
            }
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
console.log("Controls   : space pause · ←→ seek ±5s · ↑↓ volume · m mute · l loop · q quit");

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

let audioAvailable = true;
const volumeStep = 10;
let volume = 80;
let muted = false;

let audioFile = null;
if (!opts.noAudio) {
    if (opts.audio) audioFile = opts.audio;
    else if (fs.existsSync("audio.mp3")) audioFile = "audio.mp3";
}

// ponytail: respawn-per-adjust (each pause/seek/volume change restarts ffplay at
// -ss) is the ceiling here; gaps become noticeable -> upgrade to a real audio lib.
function spawnAudio(posSec) {
    if (!audioFile || !audioAvailable) return;
    killAudio();
    const proc = spawn(
        "ffplay",
        [
            "-nodisp",
            "-autoexit",
            "-loglevel",
            "quiet",
            "-ss",
            posSec.toFixed(3),
            "-volume",
            String(muted ? 0 : volume),
            audioFile,
        ],
        { stdio: "ignore" }
    );
    audio = proc;
    proc.on("error", () => {
        if (audio === proc) audio = null;
        if (audioAvailable) console.error("ffplay not found - continuing without audio");
        audioAvailable = false;
    });
}

// ---- draw mode + time-based playback ----

drawMode = true;
process.stdout.write(ENTER);

// ---- timeline state ----

let t0 = Date.now(); // video timeline origin
let paused = false;
let pausedAt = null; // Date.now() snapshot when paused
let loopsLeft = opts.loops; // from --loops, default 1
let loopOn = false; // 'l' toggle, infinite, takes precedence while on
let lastDrawnIndex = -1;

function posMs() {
    return paused ? pausedAt - t0 : Date.now() - t0;
}

function togglePause() {
    if (paused) {
        t0 = Date.now() - (pausedAt - t0); // resume: keep the timeline continuous
        paused = false;
        spawnAudio(posMs() / 1000);
    } else {
        paused = true;
        pausedAt = Date.now();
        killAudio();
    }
}

function seek(deltaSec) {
    const maxMs = ((frames.length - 1) * 1000) / fps;
    const target = Math.min(Math.max(posMs() + deltaSec * 1000, 0), maxMs);
    if (paused) pausedAt = t0 + target;
    else t0 = Date.now() - target;
    if (!paused && audioFile) spawnAudio(target / 1000);
    // redraw happens naturally on the next tick (index changed)
}

function setVolume(next) {
    volume = Math.min(Math.max(next, 0), 100);
    if (!paused && audioFile) spawnAudio(posMs() / 1000); // paused: state only, respawn on resume
}

function toggleMute() {
    muted = !muted;
    if (!paused && audioFile) spawnAudio(posMs() / 1000);
}

function resetTimeline() {
    t0 = Date.now();
    if (paused) pausedAt = t0;
    lastDrawnIndex = -1;
}

// ---- keyboard controls (raw mode only on a real TTY) ----

if (process.stdin.isTTY) {
    try {
        process.stdin.setRawMode(true);
    } catch (e) {}
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
        const s = chunk.toString();
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (c === "\x1b" && s[i + 1] === "[") {
                const dir = s[i + 2];
                i += 2; // consume the whole arrow sequence as one key
                if (dir === "D") seek(-5);
                else if (dir === "C") seek(5);
                else if (dir === "A") setVolume(volume + 10);
                else if (dir === "B") setVolume(volume - 10);
                continue;
            }
            if (c === "\x03" || c === "q") shutdown(0);
            else if (c === " ") togglePause();
            else if (c === "m") toggleMute();
            else if (c === "l") loopOn = !loopOn;
        }
    });
}

// ---- tick: absolute-time index, deadline-based reschedule ----

function tick() {
    let ms = posMs();
    let index = Math.floor((ms / 1000) * fps);
    if (index >= frames.length) {
        if (loopOn || loopsLeft > 1) {
            if (!loopOn) loopsLeft--;
            resetTimeline();
            ms = posMs();
            index = 0;
        } else {
            shutdown(0); // natural end: restore, kill audio, exit 0 cleanly
            return;
        }
    }
    if (index !== lastDrawnIndex) {
        lastDrawnIndex = index;
        process.stdout.write("\x1b[?2026h\x1b[H" + decodeFrame(index) + "\x1b[?2026l");
    }
    // deadline scheduling: lands exactly on the next frame boundary, no cumulative
    // setTimeout drift; index stays absolute-time-based so a slow draw skips ahead.
    const delay = paused ? 100 : Math.max(0, ((index + 1) * 1000) / fps - ms);
    setTimeout(tick, delay);
}
spawnAudio(posMs() / 1000);
tick();
