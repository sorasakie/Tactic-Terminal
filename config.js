"use strict";

const DEFAULTS = {
    mode: "braille",
    fpsCap: 24,
    fallbackCols: 120,
    fallbackRows: 40
};

const VALID_FLAGS = ["--cols", "--rows", "--fps", "--mode", "--start", "--end"];
const MODES = ["braille"];

function die(msg) {
    console.error(msg);
    process.exit(1);
}

function intFlag(name, raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        die(`Invalid value for ${name}: "${raw}" (expected a positive integer)`);
    }
    return n;
}

function numFlag(name, raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        die(`Invalid value for ${name}: "${raw}" (expected a positive number)`);
    }
    return n;
}

function parseArgs(argv) {
    const flags = {};
    let video = null;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg.startsWith("--")) {
            if (!VALID_FLAGS.includes(arg)) {
                die(`Unknown flag: ${arg}\nValid flags: ${VALID_FLAGS.join(", ")}`);
            }
            const raw = argv[++i];
            if (raw === undefined || raw.startsWith("--")) {
                die(`Flag ${arg} requires a value`);
            }
            switch (arg) {
                case "--cols": flags.cols = intFlag(arg, raw); break;
                case "--rows": flags.rows = intFlag(arg, raw); break;
                case "--fps": flags.fps = numFlag(arg, raw); break;
                case "--start": flags.start = numFlag(arg, raw); break;
                case "--end": flags.end = numFlag(arg, raw); break;
                case "--mode":
                    if (!MODES.includes(raw)) {
                        die(`Invalid value for --mode: "${raw}" (expected ${MODES.join("|")})`);
                    }
                    flags.mode = raw;
                    break;
            }
            continue;
        }

        if (video === null) video = arg;
    }

    if (flags.start !== undefined && flags.end !== undefined && flags.end <= flags.start) {
        die("Invalid range: --end must be greater than --start");
    }

    return { video, flags };
}

module.exports = { DEFAULTS, parseArgs };
