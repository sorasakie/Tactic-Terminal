const fs = require("fs");
const os = require("os");
const childprocess = require("child_process");

const FRAME_RE = /^frame_(\d+)\.png$/;

let dead = false;
function fatal(message) {
    if (dead) return;
    dead = true;
    console.error(message);
    process.exit(1);
}

const build = () => {
    // 1. frame inventory
    let files;
    try {
        files = fs.readdirSync("./frames");
    } catch (e) {
        fatal(`Could not read ./frames — run npm run prepare first\n${e}`);
        return;
    }
    const frames = files
        .filter((f) => FRAME_RE.test(f))
        .sort((a, b) => parseInt(a.match(FRAME_RE)[1], 10) - parseInt(b.match(FRAME_RE)[1], 10));
    const N = frames.length;
    if (N === 0) {
        fatal("No frames found in ./frames (expected frame_0001.png, ...) — run npm run prepare first");
        return;
    }

    // 2. metadata
    let meta;
    try {
        meta = JSON.parse(fs.readFileSync("./data.meta.json", "utf8"));
    } catch (e) {
        fatal(`Could not read data.meta.json — run npm run prepare first\n${e}`);
        return;
    }
    const config = {
        cols: meta.cols,
        rows: meta.rows,
    };
    for (const k of Object.keys(config)) {
        if (config[k] === undefined || config[k] === null) {
            fatal(`data.meta.json is missing "${k}" — run npm run prepare first`);
            return;
        }
    }

    // 3. fresh output dir, drop any stale data.txt — only now that inputs are
    // validated, so a failed run never destroys an existing data.txt
    if (fs.existsSync("./data")) fs.rmSync("./data", { recursive: true, force: true });
    fs.mkdirSync("./data");
    if (fs.existsSync("./data.txt")) fs.rmSync("./data.txt", { force: true });

    // 4. one worker per CPU core, inclusive ranges covering 1..N exactly once
    const unit = Math.ceil(N / os.cpus().length);
    const workerCount = Math.ceil(N / unit);
    const workers = [];
    let done = 0;
    let finished = 0;

    const progress = () =>
        process.stdout.write(`\rConverting frames... ${done}/${N} (${((done / N) * 100).toFixed(2)}%)`);

    const killAll = () => {
        for (const w of workers) {
            try {
                w.kill();
            } catch (e) {}
        }
    };

    const merge = () => {
        if (dead) return;
        const parts = [];
        let ids;
        try {
            ids = fs
                .readdirSync("./data")
                .filter((f) => /^data_\d+\.txt$/.test(f))
                .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
        } catch (e) {
            fatal(`Could not read ./data — run npm run prepare first\n${e}`);
            return;
        }
        for (const f of ids) {
            const buf = fs.readFileSync(`./data/${f}`);
            if (buf.length === 0) {
                fatal(`Worker output ./data/${f} is empty — refusing to merge partial data`);
                return;
            }
            parts.push(buf);
        }
        if (parts.length !== workerCount) {
            fatal(`Expected ${workerCount} worker files, found ${parts.length} — refusing to merge partial data`);
            return;
        }

        const merged = Buffer.concat(parts);
        fs.writeFileSync("./data.txt", merged);

        // 7. exactly one "\n\n" per frame
        let found = 0;
        for (let i = 0; i < merged.length - 1; i++) {
            if (merged[i] === 0x0a && merged[i + 1] === 0x0a) {
                found++;
                i++;
            }
        }
        if (found !== N) {
            fatal(`Frame count mismatch: expected ${N} frames, found ${found}`);
            return;
        }
        process.stdout.write("\r");
        console.log(`Done! ${N} frames converted.`);
        console.log(`data.txt: ${(merged.length / 1024 / 1024).toFixed(2)} MB`);
        process.exit(0);
    };

    for (let i = 0; i < workerCount; i++) {
        const start = i * unit + 1;
        const end = Math.min(i * unit + unit, N);
        if (start > N) break;

        const w = childprocess.fork("./doFrame.js");
        workers.push(w);
        w.send({ id: i, start, end, config });
        w.on("message", (msg) => {
            if (msg === "plus") {
                done++;
                progress();
            }
        });
        w.on("error", (err) => {
            killAll();
            fatal(`Worker ${i} error: ${err && err.stack ? err.stack : err}`);
        });
        w.on("exit", (code, signal) => {
            if (dead) return;
            if (code !== 0 || signal) {
                killAll();
                fatal(`Worker ${i} exited with code ${code}${signal ? ` signal ${signal}` : ""} — aborting`);
                return;
            }
            finished++;
            if (finished === workerCount) merge();
        });
    }

    if (workers.length === 0) {
        fatal("No workers started");
    }
};

build();
