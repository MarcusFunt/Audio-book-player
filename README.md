# Audio-book-player

A client-side audiobook player built for GitHub Pages. Load audio files, save your listening position per profile, reopen approved files in compatible browsers, and use a sleep timer without any server.

## Features
- Local audio playback with progress tracking.
- Lightweight profile system stored in browser storage.
- Resume prompt for previously played files on the same device.
- Stable file identity based on name, size, and modified time to avoid same-name collisions.
- Adjustable playback speed, volume, and sleep timer.
- Progressive Web App manifest and service worker for install support.
- File System Access API quick reopen support where the browser allows it.

## Getting started
1. Open `index.html` in your browser or serve the folder with any static server.
2. Create or sign in to a profile.
3. Choose an audio file from your device to begin listening.

> **Note**: Browsers that support the File System Access API can reopen previously approved files. Other browsers still require you to choose the file again each session.

## Testing
```bash
npm install
npm test
```

The Playwright suite covers startup, corrupt storage recovery, profile migration, file loading, resume behavior, same-name file collisions, user switching, sleep timer behavior, object URL cleanup, and PWA registration.

## Documentation
- [Development guide](docs/DEVELOPMENT.md)
- [Hosting on GitHub Pages](docs/HOSTING.md)

## Deployment
This repo includes a GitHub Actions workflow that deploys the site to GitHub Pages whenever changes land on `main`. See the hosting guide for setup details.
