"use strict";

const DEFAULTS = {
    flat: 20,
    colorStep: 17,
    colorMode: "truecolor",
    mode: "braille",
    fpsCap: 24,
    fallbackCols: 120,
    fallbackRows: 40
};

const VALID_FLAGS = ["--cols", "--rows", "--fps", "--flat", "--color", "--mode", "--extract-audio"];
const COLOR_MODES = ["truecolor", "256", "mono"];
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

        if (arg === "--extract-audio") {
            flags.extractAudio = true;
            continue;
        }

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
                case "--flat": flags.flat = intFlag(arg, raw); break;
                case "--color":
                    if (!COLOR_MODES.includes(raw)) {
                        die(`Invalid value for --color: "${raw}" (expected ${COLOR_MODES.join("|")})`);
                    }
                    flags.color = raw;
                    break;
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

    return { video, flags };
}

module.exports = { DEFAULTS, parseArgs };
