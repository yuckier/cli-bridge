# CLI Bridge

Run any AI CLI tool — Gemini, Claude Code, OpenCode, or a plain shell — on your PC and control it from your phone or any browser on your network.

This is a true terminal bridge: it spawns a real PTY (pseudo-terminal) locally and mirrors it over WebSockets to a web interface. Your phone gets a dedicated input bar, auto-reconnect, shortcut keys, and full terminal output — syntax highlighting and colors intact.

---

## Prerequisites

1.  **Node.js** installed — [download here](https://nodejs.org) (LTS version is fine)
2.  Your preferred AI CLI (Gemini, Claude Code, OpenCode, etc.) installed and accessible via your terminal.
3.  Your phone must be on the **same network** as your PC (WiFi, or via Tailscale — see below).

---

## 1. Installation

```bash
git clone https://github.com/yuckier/cli-bridge.git
cd cli-bridge
npm install
```

---

## 2. Usage

Double-click `start-bridge.bat` on Windows, or run via terminal:

```bash
npm start
```

An interactive menu lets you pick which CLI to launch. You can also pass arguments directly:

```bash
node bridge-server.js claude              # Run Claude Code
node bridge-server.js opencode            # Run OpenCode
node bridge-server.js cmd                 # Generic Windows Command Prompt
node bridge-server.js --port 4040 gemini  # Custom port
node bridge-server.js --no-tls            # Disable HTTPS (plain HTTP)
node bridge-server.js --token mySecret    # Pin a specific auth token
node bridge-server.js --host my.hostname  # Add a custom hostname to the TLS cert
```

The server waits for a **keypress** before launching the CLI, giving you time to connect from your phone first.

---

## 3. Connect from your Phone

**Option A — QR Code (easiest):**
When the server starts, a **QR code** is printed directly in the terminal. Point your phone's camera at it — it opens the bridge UI in your browser. Done.

**Option B — Scan from the client:**
If you already have `client.html` open on your phone, tap the **📷 Scan** button to scan the QR code from the server console.

**Option C — Manual URL:**
Look at the server logs for the URL (e.g., `https://192.168.1.5:3939`) and type it into your phone's browser.

> **Note:** On first visit, your browser will show a "connection not private" warning because the TLS certificate is self-signed. Tap **Advanced → Proceed** once, and it's remembered.

Once the page loads, it **auto-connects** — no token to copy, no buttons to press.

---

## 4. Tailscale Support

If you use [Tailscale](https://tailscale.com), CLI Bridge works seamlessly over your tailnet — no need to be on the same WiFi.

- The server **auto-detects your Tailscale MagicDNS hostname** (via `tailscale status --json`) and includes it in the TLS certificate's SANs.
- Connect from anywhere using `https://your-machine.tailnet-name.ts.net:3939`.
- You can also manually add hostnames with `--host your.custom.hostname`.

> **Tip:** If the Tailscale hostname isn't working, delete the `.certs/` folder and restart the server to regenerate the certificate with current hostnames.

---

## Security

The bridge is designed for use on **trusted networks** (home WiFi, Tailscale). It includes several security measures:

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

-   **Tailscale: "This page isn't working"?**
    Make sure you're using `https://` (not `http://`). If the MagicDNS hostname still fails, delete `.certs/` and restart to regenerate the cert.

-   **Auth denied?**
    The token is auto-fetched when the page is served by the bridge. If you're opening `client.html` locally, use the **📷 Scan** button to scan the server's QR code.

---

## License

[MIT](LICENSE)