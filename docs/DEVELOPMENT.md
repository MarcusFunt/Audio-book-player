# Development

## Prerequisites
- A modern browser (Chrome, Firefox, Safari, or Edge).
- Optional: a local static server if you prefer not to open `index.html` directly.

## Local preview
1. Open `index.html` directly in your browser, **or** serve the repo with a static server.
2. Load an MP3 file from your device to begin playback.

### Example static server
If you want to avoid browser restrictions around local file access, run a lightweight server from the repo root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

## Project structure
- `index.html`: App markup.
- `styles.css`: Styling and layout.
- `app.js`: Audio player logic and UI behavior.
