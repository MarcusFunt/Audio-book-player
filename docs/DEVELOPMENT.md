# Development

## Prerequisites
- A modern browser (Chrome, Firefox, Safari, or Edge).
- Node.js 22 or newer for the automated test suite.

## Local preview
1. Open `index.html` directly in your browser, **or** serve the repo with a static server.
2. Load an audio file from your device to begin playback.

### Example static server
If you want to avoid browser restrictions around local file access, run a lightweight server from the repo root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

## Tests
Install dependencies:

```bash
npm install
```

Run the full validation suite:

```bash
npm test
```

Run only the Playwright tests:

```bash
npm run test:e2e
```

The tests generate small WAV fixtures at runtime and do not require checked-in media files.

## Project structure
- `index.html`: App markup.
- `styles.css`: Styling and layout.
- `app.js`: Audio player logic and UI behavior.
- `manifest.webmanifest`: PWA install metadata.
- `sw.js`: Service worker for the static app shell.
- `tests/`: Playwright browser tests.
