# dsh-highlighter — DeepSeek Harness Highlight & Annotation Plugin

Provides in-page text highlight and annotation for chat conversations within DeepSeek Harness: highlight immediately upon selection, 8 classic colors, write notes, add tags, one-click copy/delete, and **color-coded dots on the right side** for quick navigation.
Each dot is linked to an annotation: matching the highlight color and aligned with document context (upper highlights appear above, lower ones below, proportionally mapped to content height).

## Features

| Action | Description |
|---|---|
| Select text | Popup toolbar: 3 quick colors (Red/Yellow/Blue) + full palette (8 colors) + Tag + Copy |
| Click highlighted text | Management toolbar: Change color / Write note / Add tag / Copy / Delete |
| Hover highlighted text | Displays note and tags associated with the highlight |
| Right-side dot rail | One dot per highlight, arranged from top to bottom by document position; click dot to smoothly scroll and flash highlight |
| Persistence | Saved in page localStorage (key `dshhl_highlights`), preserved across refreshes |

8 classic colors: Red `#F6A6A6`, Orange `#FFCC80`, Yellow `#FFF176`, Green `#B9F6CA`,
Teal `#69F0D8`, Blue `#A8D8FF`, Purple `#D3B0FF`, Pink `#FFB3DE`.

## Installation

### Method 1: Clone from GitHub (Recommended)

```powershell
git clone https://github.com/pedromarcioap/dsh-highlighter-en.git
cd dsh-highlighter-en
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

### Method 2: Use Directly from this Directory

```powershell
# Run from the project directory (this directory)
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

The installation script will:
1. Deploy the plugin package to `$DSH_HOME\profiles\node_modules\dsh-highlighter` (default `~\.dsh\...`);
2. Append a loader entry to `$DSH_HOME\profiles\web\cordis.patch.yml` (idempotent, safe to rerun).

Then **fully exit and restart DeepSeek Harness** (close and reopen from the upper-right corner, or quit via the system tray icon).
The plugin will load automatically on application startup. No manual injection needed.

## Verification

After restarting, open the browser/DevTools console (F12) and run:

```js
window.__dshHighlighterDiagnostics.health()   // { ok: true, ... }
await window.__dshHighlighterDiagnostics.selfTest()  // Read-only self-test, does not write data
```

- `health().ok === true`: Plugin is loaded and mounted.
- `selfTest().ok === true`: Selection toolbar opens properly and storage remains unpolluted.

You can also select some text directly to try it out.

## How It Works

- The plugin is a static client-side plugin for DSH (`dsh.client` bundle): deployed to the user profile's `profiles/node_modules`, registered as an entry in the `insert` list of `cordis.patch.yml`. The host-side `client-modules` service scans the bundle into the `window.__DSH_BOOT__` boot graph, and the kernel automatically imports and activates it upon page load (no Cordis tools or build toolchain required).
- Highlights wrap selected text in `<span class="dsh-hl">`. Records are saved to `localStorage` as "text + prefix/suffix context". When React re-rendering causes spans to be lost, `MutationObserver` re-anchors them based on the full-text index.
- The dot rail uses Shadow DOM for style isolation; each dot's vertical position = proportional position of the highlight within the scrollable content.

## Uninstallation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Then restart DeepSeek Harness. Existing annotation data remains in localStorage and will not be lost.

## Files

| File | Description |
|---|---|
| `client.js` | Browser-side bundle: all highlight and annotation features |
| `index.js` | Host-side placeholder plugin (ensures entry has a live fiber) |
| `package.json` | Package manifest: `dsh.client.platform: web` + `exports["./client"]` |
| `install.ps1` / `uninstall.ps1` | Deployment / Uninstallation scripts |

## Known Limitations

- Highlight records are stored per page origin (browser tabs and desktop windows may be isolated from each other);
- Highlights may temporarily disappear for a moment during AI streaming output / re-rendering, then automatically re-anchor (~0.7s);
- Text within input boxes and editable areas will not be highlighted.
