# Frontend Chat (No Backend)

A pure frontend chat app with Google login and local chat storage. No backend, no user discovery, no sync.

## Features
- Google OAuth login (One Tap)
- Chat with any user by email (must know their email)
- Messages stored locally in browser per account
- Responsive, modern UI

## Usage
1. Visit: https://harithkavish.github.io/chat
2. Login with Google
3. Enter a peer's email to start chatting

## Development
- All code is in `index.html`, `app.js`, and `styles.css`.
- To run locally: `python -m http.server 8000` and open http://localhost:8000

## Deploying
- Hosted via GitHub Pages from the `main` or `master` branch root.
- `.nojekyll` disables Jekyll processing for static assets.

## Limitations
- No backend, no user search/discovery
- Chats are not synced across devices
- For cross-device sync, add cloud storage or a backend
