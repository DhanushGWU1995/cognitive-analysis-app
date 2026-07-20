# SELeCT Toddler — Electron desktop app

Packages the Angular web app as a **native desktop application** for lab machines.

Electron supports **macOS**, **Windows**, and **Linux** from the same codebase. You build installers on each platform (or use CI).

## Prerequisites

- Node.js 20+
- Angular web dependencies installed: `npm install` in `../web`
- For **macOS** builds: run on a Mac
- For **Windows** `.exe` builds: run on Windows (recommended)

## Quick start (development)

```bash
cd desktop
npm install
npm start
```

`npm start` rebuilds the web app with `baseHref: ./` (required for `file://` loading), then opens Electron fullscreen.

If you already built the web app: `npm run start:fast`

## Create installers

```bash
cd desktop
npm install
npm run dist        # current OS
npm run dist:mac    # .dmg + .zip (macOS only)
npm run dist:win    # NSIS .exe installer (Windows only)
npm run dist:linux  # AppImage
```

Output goes to `desktop/release/` locally. CI copies the Windows installer to the repo **`release/`** folder on every push to `main`.

## Automated builds (GitHub Actions)

On each push to `main` (except commits that only touch `release/`):

1. **GitHub Pages** — web app at `https://<user>.github.io/cognitive-analysis-app/`
2. **Windows desktop** — builds `SELeCT-Toddler-win.exe` and commits it to `release/` in the repo

Download: `release/SELeCT-Toddler-win.exe` on GitHub (raw or from the repo browser).

**Note:** Enable [Git LFS](https://git-lfs.com) on the repository if the installer exceeds GitHub’s 100 MB file limit. The workflow uses LFS for `release/*.exe`.

## Platform notes

| Platform | Output | Build on |
|----------|--------|----------|
| macOS | `.app`, `.dmg`, `.zip` | Mac |
| Windows | `.exe` (NSIS installer) | Windows |
| Linux | `.AppImage` | Linux |

Unsigned macOS builds run locally after right-click → Open. Distribution outside your lab usually needs Apple code signing + notarization.

## Project layout

```
cognitive-analysis-app/
  web/                 Angular app (GitHub Pages + desktop UI)
  desktop/
    main.js            Electron main process
    preload.js         Optional bridge to the renderer
    package.json       electron-builder config
    release/           Built installers (gitignored)
```

The packaged app bundles `web/dist/web/browser` (pictures, sounds, video included via Angular `public/assets`).
