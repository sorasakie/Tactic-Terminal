const fs = require("fs");
const getPixels = require("get-pixels");

// Braille dot bit per (col, row) inside one 2x4 pixel cell.
const DOT = [
    [0x01, 0x02, 0x04, 0x40],
    [0x08, 0x10, 0x20, 0x80],
];

// Mono only: absolute ordered-dither thresholds per (col, row), evenly spaced
// 32 apart over 16..240. A dot lights when its raw luminance >= its threshold,
// so density tracks ABSOLUTE brightness instead of the block's own mean, and
// uniformly bright cells are no longer blanked by the flat-block shortcut.
// Light-up order: 16, 48, 80, 112, 144, 176, 208, 240 (dispersed).
const THRESH = [
    [16, 144, 80, 208],   // col 0, rows 0..3
    [240, 112, 176, 48],  // col 1, rows 0..3
];

function renderFrame(pixels, config) {
    const { cols, rows } = config;
    const w = pixels.shape[0];
    const h = pixels.shape[1];
    if (w < cols * 2 || h < rows * 4) {
        console.error(`Frame too small: got ${w}x${h}px, need at least ${cols * 2}x${rows * 4}px`);
        process.exit(1);
    }

    const s0 = pixels.stride[0], s1 = pixels.stride[1], s2 = pixels.stride[2];
    const data = pixels.data;
    const lines = [];

    for (let cy = 0; cy < rows; cy++) {
        let line = "";

        for (let cx = 0; cx < cols; cx++) {
            const lum = [];

            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    const o = (cx * 2 + c) * s0 + (cy * 4 + r) * s1;
                    const R = data[o], G = data[o + s2], B = data[o + 2 * s2];
                    lum.push(0.2126 * R + 0.7152 * G + 0.0722 * B);
                }
            }

            // Dither every cell against absolute thresholds (no flat shortcut).
            // 1e-9 absorbs float error in 0.2126R+0.7152G+0.0722B, which can land
            // 1 ULP below an integer threshold (e.g. gray 80 -> 79.99999999999999).
            let mask = 0;
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 2; c++) {
                    if (lum[r * 2 + c] >= THRESH[c][r] - 1e-9) mask |= DOT[c][r];
                }
            }
            line += String.fromCharCode(0x2800 + mask);
        }

        line += "\x1b[0m";
        lines.push(line);
    }

    return lines.join("\n");
}

function run({ id, start, end, config }) {
    const outPath = `./data/data_${id}.txt`;
    fs.writeFileSync(outPath, "");

    let i = start;
    (function next() {
        if (i > end) {
            // Done: drop the IPC channel so this worker actually exits and
            // build.js's exit handler can reach the merge step.
            if (process.connected) process.disconnect();
            return;
        }
        const index = i++;
        const path = `frames/frame_${String(index).padStart(4, "0")}.png`;
        getPixels(path, (err, pixels) => {
            if (err) {
                console.error(`Failed to read ${path}`);
                console.error(err);
                process.exit(1);
            }
            let frame;
            try {
                frame = renderFrame(pixels, config);
            } catch (e) {
                console.error(`Failed to render ${path}`);
                console.error(e);
                process.exit(1);
            }
            fs.appendFileSync(outPath, frame + "\n\n");
            process.send("plus");
            next();
        });
    })();
}

process.on("message", run);
