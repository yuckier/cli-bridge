# Gemini Bridge

Run Gemini CLI (or Claude Code, OpenCode, etc.) on your PC and control it seamlessly from your phone or any browser on your network.

This acts as a "true terminal" bridge: it runs a real PTY (pseudo-terminal) locally and mirrors it directly to a web interface over WebSockets. Your phone gets a dedicated input bar, auto-reconnect, and full terminal output — syntax highlighting and colors intact.

---

## Prerequisites

1.  **Node.js** installed — [download here](https://nodejs.org) (LTS version is fine)
2.  **Gemini CLI** (or your preferred AI CLI) installed and accessible via your terminal.
3.  Your testing device (e.g., your smartphone) must be on the **same WiFi network** as your PC.

---

## 1. Installation

Clone or download this repository, open a terminal in the folder, and install the dependencies:

```bash
npm install
```

---

## 2. Usage

Double-click `start-bridge.bat` on Windows, or run via terminal:

```bash
npm start
```

By default, an interactive menu lets you pick which CLI to launch (Gemini, Claude Code, OpenCode, or a plain shell).

You can also pass arguments directly:

```bash
node bridge-server.js claude              # Run Claude Code
node bridge-server.js opencode            # Run OpenCode
node bridge-server.js cmd                 # Generic Windows Command Prompt
node bridge-server.js --port 4040 gemini  # Custom port
node bridge-server.js --no-tls            # Disable HTTPS (plain HTTP)
node bridge-server.js --token mySecret    # Pin a specific auth token
```

The server waits for a **keypress** before launching the CLI, giving you time to connect from your phone first.

---

## 3. Connect from your Phone

**Option A — QR Code (easiest):**
When the server starts, a **QR code** is printed directly in the terminal. Point your phone's camera at it — it opens the bridge UI in your browser. Done.

**Option B — Scan from the client:**
If you already have `client.html` open on your phone, tap the **📷 Scan** button in the header bar to scan the QR code from the server console.

**Option C — Manual URL:**
Look at the server logs for the URL (e.g., `https://192.168.1.5:3939`) and type it into your phone's browser.

> **Note:** On first visit, your browser will show a "connection not private" warning because the TLS certificate is self-signed. Tap **Advanced → Proceed** once, and it's remembered.

Once the page loads, it **auto-connects** — no token to copy, no buttons to press.

---

## Security

The bridge is designed for use on **trusted local networks** (home WiFi). It includes several security measures:

| Feature | Details |
|---|---|
| **Random auth token** | A fresh, cryptographically random token is generated every time the server starts. No hardcoded defaults. |
| **HTTPS / WSS** | All traffic is encrypted via a self-signed TLS certificate, auto-generated on first launch and stored in `.certs/`. |
| **Auth gating** | WebSocket clients must authenticate before they can send any commands to the PTY. |
| **Dynamic token delivery** | The client fetches its token from `/api/token` over HTTPS — no secrets in source code. |

To pin a specific token (useful for automation): `node bridge-server.js --token mySecret`

To disable TLS on a trusted network: `node bridge-server.js --no-tls`

> ⚠️ **Never expose this to the public internet** without a proper reverse proxy and authentication layer.

---

## Troubleshooting

-   **Can't reach the page on my phone?**
    Your PC's firewall is likely blocking port `3939`. Set your network profile to "Private" in Windows Settings, or add an inbound firewall rule for Node.js / port 3939.

-   **"Connection not private" warning?**
    Expected on first visit — the TLS cert is self-signed. Click through the warning once and it's remembered.

-   **Auth denied?**
    The token is auto-fetched when the page is served by the bridge. If you're opening `client.html` locally, use the **📷 Scan** button to scan the server's QR code.