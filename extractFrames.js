"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const config = require("./config");
const { DEFAULTS } = config;

function fail(msg, extra) {
    console.error(msg);
    if (extra !== undefined) console.error(extra);
    process.exit(1);
}

function run(cmd, args) {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { windowsHide: true });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("error", (err) => {
            console.error(`Failed to start ${cmd}:`);
            console.error(err);
            process.exit(1);
        });
        child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
}

async function probe(video) {
    const { code, stdout, stderr } = await run("ffprobe", [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        "-select_streams", "v:0",
        video
    ]);
    if (code !== 0) {
        fail(`ffprobe failed for ${video} (exit ${code}):`, stderr);
    }
    let info;
    try {
        info = JSON.parse(stdout);
    } catch (e) {
        fail("Could not parse ffprobe output:", e);
    }
    const stream = (info.streams || [])[0];
    if (!stream) fail(`No video stream found in ${video}`);

    const srcW = stream.width;
    const srcH = stream.height;
    if (!srcW || !srcH) fail("Could not determine source video dimensions.");

    let fps = null;
    const parseRate = (r) => {
        if (!r || typeof r !== "string") return null;
        const [n, d] = r.split("/").map(Number);
        if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n <= 0) return null;
        return n / d;
    };
    fps = parseRate(stream.avg_frame_rate) ?? parseRate(stream.r_frame_rate) ?? 30;

    const durationRaw = (info.format && info.format.duration) ?? stream.duration ?? null;
    const duration = Number.isFinite(Number(durationRaw)) && durationRaw !== null ? Number(durationRaw) : null;

    return { srcW, srcH, fps, duration };
}

function computeSize(srcW, srcH, flags) {
    // displayed aspect = COLS / (2*ROWS) must equal srcW/srcH  =>  COLS/ROWS = 2*srcW/srcH
    const a = (2 * srcW) / srcH;

    let cols, rows, usedFallback = false;
    if (flags.cols && flags.rows) {
        cols = flags.cols;
        rows = flags.rows;
    } else if (flags.cols) {
        cols = flags.cols;
        rows = Math.max(1, Math.round(cols / a));
    } else if (flags.rows) {
        rows = flags.rows;
        cols = Math.max(2, Math.round(rows * a));
    } else {
        cols = process.stdout.columns || DEFAULTS.fallbackCols;
        rows = Math.round(cols / a);
        const maxRows = process.stdout.rows ? process.stdout.rows - 1 : DEFAULTS.fallbackRows;
        if (rows > maxRows) {
            rows = maxRows;
            cols = Math.round(rows * a);
        }
        usedFallback = !process.stdout.columns;
    }

    cols = Math.max(2, cols - (cols % 2));
    rows = Math.max(1, rows);

    return { cols, rows, pw: cols * 2, ph: rows * 4, usedFallback };
}

function formatBytes(b) {
    if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
    if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(2)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(2)} KB`;
    return `${b} bytes`;
}

async function main() {
    const cfg = config.parseArgs(process.argv.slice(2));
    const flags = cfg.flags;
    const video = cfg.video || "res/tactic.webm";

    if (!fs.existsSync(video)) {
        fail(`Input video not found: ${path.resolve(video)}`);
    }

    const { srcW, srcH, fps: srcFps, duration } = await probe(video);
    const { cols, rows, pw, ph, usedFallback } = computeSize(srcW, srcH, flags);

    const fps = flags.fps ?? Math.min(srcFps, DEFAULTS.fpsCap);
    const colorMode = flags.color ?? DEFAULTS.colorMode;
    const flat = flags.flat ?? DEFAULTS.flat;
    const colorStep = flags.colorStep ?? DEFAULTS.colorStep;
    const mode = flags.mode ?? DEFAULTS.mode;

    const frameCount = duration !== null ? Math.ceil(duration * fps) : null;
    const bytesPerCell = { truecolor: 24, 256: 14, mono: 4 }[colorMode] ?? 24;
    const estBytes = frameCount !== null
        ? frameCount * (rows * (cols * bytesPerCell + 1) + 2)
        : null;

    console.log("=== Extraction parameters ===");
    console.log(`Source file  : ${path.resolve(video)}`);
    console.log(`Source size  : ${srcW} x ${srcH}`);
    console.log(`Source fps   : ${srcFps.toFixed(3)}`);
    console.log(`Duration     : ${duration !== null ? duration.toFixed(2) + " s" : "unknown"}`);
    console.log(`Grid         : ${cols} cols x ${rows} rows`);
    console.log(`FPS          : ${fps}`);
    console.log(`Pixel size   : ${pw} x ${ph}`);
    console.log(`Color mode   : ${colorMode} (${mode})`);
    console.log(`Frames (est) : ${frameCount !== null ? frameCount : "unknown (no duration)"}`);
    if (estBytes !== null) {
        console.log(`data.txt est.: ${formatBytes(estBytes)}`);
        if (estBytes > 500 * 1024 * 1024) {
            console.log("\n*** WARNING: estimated data.txt exceeds 500 MB. ***");
            console.log("*** Consider lowering --cols, --rows, or --fps. ***\n");
        }
    }
    if (usedFallback) {
        console.log("Note: stdout is not a TTY (no columns detected), using fallback size.");
    }

    fs.rmSync("./frames", { recursive: true, force: true });
    fs.mkdirSync("./frames");

    const vf = `scale=${pw}:${ph}:force_original_aspect_ratio=decrease,pad=${pw}:${ph}:(ow-iw)/2:(oh-ih)/2:color=black`;
    console.log("\nExtracting frames...");
    const ext = await run("ffmpeg", [
        "-y", "-i", video,
        "-vf", vf,
        "-r", String(fps),
        "frames/frame_%04d.png"
    ]);
    if (ext.code !== 0) {
        console.error("FFmpeg frame extraction failed.");
        console.error(`Exit code: ${ext.code}  Signal: ${ext.signal}`);
        console.error("Full stderr:");
        console.error(ext.stderr);
        process.exit(1);
    }

    const pngs = fs.readdirSync("./frames").filter((f) => /^frame_\d+\.png$/.test(f));
    if (pngs.length === 0) {
        fail("FFmpeg produced no frames. Full stderr:", ext.stderr);
    }
    const actualFrames = pngs.length;
    console.log(`Extracted ${actualFrames} frames.`);

    if (flags.extractAudio) {
        console.log("Extracting audio...");
        const aud = await run("ffmpeg", ["-y", "-i", video, "-vn", "audio.mp3"]);
        if (aud.code !== 0) {
            console.error("FFmpeg audio extraction failed.");
            console.error(`Exit code: ${aud.code}  Signal: ${aud.signal}`);
            console.error("Full stderr:");
            console.error(aud.stderr);
            process.exit(1);
        }
        console.log("Wrote audio.mp3.");
    }

    const meta = {
        cols,
        rows,
        fps,
        frameCount: actualFrames,
        source: path.basename(video),
        colorMode,
        flat,
        colorStep,
        mode,
        pixelWidth: pw,
        pixelHeight: ph
    };
    fs.writeFileSync("data.meta.json", JSON.stringify(meta, null, 2) + "\n");

    console.log("\nDone.");
    console.log(`  ${cols}x${rows} grid, ${actualFrames} frames @ ${fps} fps, ${colorMode}`);
    console.log("  Next: npm run build (data.meta.json written).");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
