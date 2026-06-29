# Narxene Photo Organizer

A fast, keyboard-driven photo culling tool for Windows. Open a folder, press a number key, and the current photo (plus its RAW sibling) flies into the destination folder you bound to that key — then the next photo loads automatically. Built for quickly sorting large shoots without reaching for the mouse.

## Why

Existing tools are either clunky and not keyboard-first (XnView, digiKam) or polished but paid and built around heavy shoot workflows (Photo Mechanic, FastRawViewer). This is a small, free, single-purpose app focused on one thing: culling fast.

## Features

- **Keyboard culling** — press `1`–`9` to move/copy the current photo to a pre-bound folder; the view auto-advances
- **RAW + JPEG pairing** — files sharing a basename (e.g. `IMG_0042.CR2` + `IMG_0042.JPG`) move together as one unit
- **Filmstrip** — navigate without moving; the current photo is highlighted and processed photos are dimmed
- **Zoom & pan** — mouse wheel to zoom, drag to pan, double-click to toggle 100% — for checking focus
- **EXIF info panel** — press `i` to see ISO, shutter, aperture, focal length, camera, and lens
- **Undo** — `Ctrl+Z` reverses the last action (50-deep history)
- **Copy or Move** — session toggle, defaults to Copy (safe); a colored border shows which mode you're in
- **Safe by design** — conflict-free naming (never overwrites), atomic pair moves with rollback, no delete key
- **Persistent bindings** — your slot-to-folder bindings are saved between launches

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `1`–`9` | Send current photo to that slot's folder |
| `←` / `→` | Navigate without moving |
| `Space` | Skip to next |
| `Ctrl+Z` | Undo last action |
| `i` | Toggle EXIF info panel |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom |

## Install

Download the latest `photo-organizer.exe` from the [Releases](https://github.com/DivaAnanda/photo-organizer/releases) page and run it — no installation needed.

> The app is signed with a self-issued certificate, so Windows SmartScreen / Smart App Control
> may warn that the publisher is unverified. Click **More info → Run anyway**.

## Usage

1. Click the slots `1`–`9` at the bottom to bind each to a destination folder (right-click a slot to rename its label).
2. Click **Open folder…** and choose the folder of photos to sort.
3. Press number keys to file each photo. Use the filmstrip, arrows, and zoom to review along the way.
4. Switch between **Copy** and **Move** in the top bar (Copy is the safe default).

## Build from source

Requires [Node.js](https://nodejs.org) 20+ and [Rust](https://rustup.rs) (with the Microsoft C++ Build Tools on Windows).

```bash
npm install
npm run tauri dev     # run in development with hot reload
npm run tauri build   # produce a release build in src-tauri/target/release
```

## Tech stack

- [Tauri v2](https://tauri.app) — Rust backend, web frontend, ~10 MB binary
- Vanilla TypeScript + [Vite](https://vite.dev) for the UI
- [kamadak-exif](https://crates.io/crates/kamadak-exif) for EXIF parsing

## License

No license has been chosen yet. Until one is added, all rights are reserved by the author.
(If you'd like this to be open source, add a `LICENSE` file — MIT is a common, permissive choice.)
