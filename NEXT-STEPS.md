# Next Steps / Future Roadmap

Here are a few planned improvements to make Gemini Bridge even more powerful and feel more like an integrated IDE tool.

## 1. ~~Interactive CLI Selector on Launch~~ *(Completed)*

Implemented natively in `bridge-server.js` using raw `stdin` mode. Running the server without arguments presents an arrow-key menu.

---

## 2. ~~Security Hardening~~ *(Completed)*

- **Random auth token** generated on every server launch via `crypto.randomBytes()` — no more hardcoded defaults.
- **HTTPS / WSS** with auto-generated self-signed TLS certificates (stored in `.certs/`, reused on subsequent launches).
- **Dynamic token delivery** via `/api/token` endpoint — the client fetches it automatically over HTTPS.
- **CLI flags**: `--token <value>` to pin a token, `--no-tls` to disable TLS.

---

## 3. ~~QR Code Connection~~ *(Completed)*

- **Server console QR code** printed on startup via `qrcode-terminal` — scan with your phone camera to open the bridge URL instantly.
- **📷 Scan button** in the client UI opens the phone's camera to scan the server's QR code when `client.html` is opened locally.
- Scanned URL is parsed, token auto-fetched, and connection established — zero typing required.

---

## 4. "Claude Code" Style UX Improvements

While the current pure "Terminal Mirroring" approach is robust and universal, there are several UI/UX enhancements we can make to the client to make it feel more like a premium native tool (like Claude Code) rather than just a raw terminal:

- **Conversation History / Scrollback:**
  A dedicated UI panel that logs the back-and-forth conversation (like a chat app) for easier review.
- **Context / File Viewer:**
  A side panel tracking which files the AI currently has loaded in its context or is actively modifying.
- **Diff Viewer:**
  Intercepting AI code-change output and displaying structured side-by-side or inline diffs.
- **Copy/Paste Formatting:**
  Recognizing code blocks in output, styling them with a distinct background, and adding a one-click "Copy Code" button.

*Note: These features require deeper interpretation of the CLI's raw output stream, moving beyond pure PTY mirroring towards a structured custom client.*

