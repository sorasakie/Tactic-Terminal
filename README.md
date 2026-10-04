# Tactic-Terminal

Tactic-Terminal converts any input video (`.mp4`/`.webm`/`.mkv` — anything FFmpeg reads) into Braille characters (U+2800 block, 2x4 pixels per cell), black and white by default (optional color with `--color truecolor|256`), stores the frames as text in `data.txt`, and plays them back in your terminal. Original Bad Apple terminal demo: https://youtu.be/_JTHbbsSCZk

## Requirements

- Node.js
- FFmpeg installed and on PATH — the tool invokes `ffmpeg`, `ffprobe`, and (for audio) `ffplay`
- A terminal that supports Unicode (truecolor only needed for `--color truecolor`/`--color 256`; Windows Terminal on Windows 10/11 is recommended)

## Quick start

```sh
npm install --ignore-scripts
```

A plain `npm install` triggers npm's `prepare` lifecycle script, which would immediately start converting the default video — skip scripts on install.

```sh
npm run prepare
npm start
```

`npm run prepare` converts the default video `res/tactic.webm` (16:9, 854x480). `npm start` plays the result.

## Usage & examples

```sh
npm run prepare -- myvideo.webm
npm run prepare -- video.webm --cols 160 --rows 45 --fps 24
npm run prepare -- input.mkv --color 256 --extract-audio
npm start -- --audio audio.mp3
```

Re-playing needs no re-prepare unless you change the video or flags — `data.txt` persists until you run `npm run prepare` again.

## Flags reference

### `npm run prepare`

| Flag | Default | Meaning |
|------|---------|---------|
| `--cols <n>` | current terminal width | Target width in cells. |
| `--rows <n>` | current terminal rows - 1 | Target height in cells. |
| `--fps <n>` | min(source fps, 24) | Output frame rate. |
| `--flat <n>` | `20` | Flat-block luminance threshold. |
| `--color <truecolor\|256\|mono>` | `mono` | Color depth of the output; default is black and white. |
| `--mode <braille>` | `braille` | Conversion mode; only supported value. |
| `--extract-audio` | off | Write `audio.mp3` next to the repo. |

Source width/height/fps/duration are auto-detected with FFprobe. The aspect ratio is preserved with a centered letterbox/pillarbox (never stretched).

### `npm start`

| Flag | Default | Meaning |
|------|---------|---------|
| `--audio <file>` | none | Start `ffplay -nodisp -autoexit -loglevel quiet` with the video; warns and continues if `ffplay` is missing. |
| `--dump <file>` | none | Debug: write the first and last frame to the file, then exit. |

FPS and dimensions are read from `data.meta.json`, so playback always matches the conversion.

## Terminal & font notes

- The font must render the Braille block cleanly. **Cascadia Mono** (bundled with Windows Terminal) is the safe choice.
- Font size must be small enough that a full frame does not scroll the terminal.
- Windows Terminal has truecolor on by default.
- The terminal must be at least `COLS`x`ROWS` cells — the player checks and exits with a clear message if not. Resize the terminal or re-prepare with smaller `--cols`/`--rows`.

## data.txt size

Size scales with `cols x rows x fps x color depth`. `npm run prepare` prints an estimate and warns above 500 MB. If it gets too big, lower `--cols`/`--rows`/`--fps` or use `--color 256` / `--color mono`.

`frames/`, `data/`, `data.txt`, `data.meta.json` and all media extensions are gitignored — never commit them.

## Troubleshooting

- **Garbled characters / boxes instead of Braille dots** — the font lacks U+2800. Switch to Cascadia Mono.
- **No colors** — the terminal is not in truecolor. Windows Terminal: Settings → Profiles → Advanced → Use 24-bit color.
- **"Terminal too small"** — resize the terminal or re-prepare with smaller `--cols`/`--rows`.
- **Prepare fails** — the full FFmpeg error is printed. Check that the input path exists and that `ffmpeg`/`ffprobe` are on PATH.
- **"ffplay not found" warning** — audio is skipped, playback continues.
- **Playback timing** — frames are time-based: a slow machine skips frames instead of slowing down.

## Media & copyright

Users must supply their own video files and must respect copyright. Only the repo owner's sample clips live under `res/`. The `.gitignore` rules block `*.mp4`/`*.webm`/`*.mkv`/`*.mp3`, `frames/`, `data/` and `data.txt` so copyrighted media and generated data never get committed.

## Credits

This project is based on [KineticTactic/Bad-Apple-Terminal](https://github.com/KineticTactic/Bad-Apple-Terminal) and is published as a GitHub fork of it to credit the original work. The code has since diverged into a general-purpose video renderer and does not track upstream changes.

## Contributors

Special thanks to [@yeonfish6040](https://github.com/yeonfish6040) for adding support for custom videos and optimising the video to text extraction process.
