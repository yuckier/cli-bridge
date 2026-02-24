#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Gemini Bridge — Standalone Server
//
// Runs OUTSIDE of VS Code. Uses node-pty to create a real pseudo-terminal
// that can host ANY interactive CLI tool (Gemini, Claude Code, OpenCode, etc.)
// and mirrors it over WebSocket to your phone or browser.
//
// Usage:
//   node bridge-server.js                    # defaults to "gemini" on port 3939
//   node bridge-server.js claude             # run Claude Code
//   node bridge-server.js opencode           # run OpenCode
//   node bridge-server.js cmd                # generic shell
//   node bridge-server.js --port 4040 gemini # custom port
//
// Open http://<your-ip>:<port> in any browser to get the UI.
// ─────────────────────────────────────────────────────────────────────────────

const pty = require('node-pty');
const { WebSocketServer, WebSocket } = require('ws');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const selfsigned = require('selfsigned');
const qrcode = require('qrcode-terminal');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Parse CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let port = 3939;
let command = null; // null triggers the interactive menu
let customToken = null;
let noTls = false;
let extraHosts = [];  // additional DNS SANs for the cert

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
        port = parseInt(args[i + 1], 10);
        i++; // skip next
    } else if (args[i] === '--token' && args[i + 1]) {
        customToken = args[i + 1];
        i++;
    } else if (args[i] === '--no-tls') {
        noTls = true;
    } else if (args[i] === '--host' && args[i + 1]) {
        extraHosts.push(args[i + 1]);
        i++;
    } else {
        command = args[i];
    }
}

// ── Auth Token ──────────────────────────────────────────────────────────────
// Generate a fresh random token each launch, or use a pinned one via --token
const AUTH_TOKEN = customToken || crypto.randomBytes(24).toString('base64url');

// ── TLS Certificate ─────────────────────────────────────────────────────────
const CERTS_DIR = path.join(__dirname, '.certs');
const CERT_PATH = path.join(CERTS_DIR, 'cert.pem');
const KEY_PATH = path.join(CERTS_DIR, 'key.pem');

async function ensureSelfSignedCert() {
    if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
        console.log(`[${timestamp()}] 🔒 Reusing existing TLS cert from .certs/`);
        return {
            cert: fs.readFileSync(CERT_PATH),
            key: fs.readFileSync(KEY_PATH),
        };
    }

    console.log(`[${timestamp()}] 🔒 Generating self-signed TLS certificate...`);
    if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });

    // Build Subject Alternative Names: localhost + all local IPs + hostnames
    const altNames = [
        { type: 2, value: 'localhost' },   // DNS
        { type: 7, ip: '127.0.0.1' },     // IP
    ];
    const localIPs = getLocalIPs();
    for (const ip of localIPs) {
        if (ip !== 'localhost') altNames.push({ type: 7, ip });
    }

    // Add the machine's hostname
    altNames.push({ type: 2, value: os.hostname() });

    // Auto-detect Tailscale MagicDNS hostname if available
    try {
        const tsJson = execSync('tailscale status --json', { stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 });
        const tsStatus = JSON.parse(tsJson.toString());
        if (tsStatus.Self && tsStatus.Self.DNSName) {
            const tsHost = tsStatus.Self.DNSName.replace(/\.$/, ''); // strip trailing dot
            altNames.push({ type: 2, value: tsHost });
            console.log(`[${timestamp()}] 🔗 Tailscale hostname added to cert: ${tsHost}`);
        }
    } catch {
        // Tailscale CLI not available or not running — skip
    }

    // Add any extra --host values
    for (const host of extraHosts) {
        altNames.push({ type: 2, value: host });
    }

    try {
        const attrs = [{ name: 'commonName', value: 'gemini-bridge' }];
        const pems = await selfsigned.generate(attrs, {
            keySize: 2048,
            days: 365,
            algorithm: 'sha256',
            extensions: [
                { name: 'subjectAltName', altNames },
            ],
        });

        fs.writeFileSync(CERT_PATH, pems.cert);
        fs.writeFileSync(KEY_PATH, pems.private);

        console.log(`[${timestamp()}] ✅ TLS cert created (valid 365 days)`);
        return { cert: pems.cert, key: pems.private };
    } catch (err) {
        console.error(`[${timestamp()}] ⚠️  Could not generate TLS cert: ${err.message}`);
        console.error(`[${timestamp()}]    Falling back to plain HTTP. Use --no-tls to silence this.`);
        noTls = true;
        return null;
    }
}

const CLI_OPTIONS = [
    { name: 'Gemini CLI', cmd: 'gemini' },
    { name: 'Claude Code', cmd: 'claude' },
    { name: 'OpenCode', cmd: 'opencode' },
    { name: process.platform === 'win32' ? 'Command Prompt' : 'Git Bash', cmd: process.platform === 'win32' ? 'cmd' : 'bash' }
];
let selectedIndex = 0;

let ptyProcess = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLocalIPs() {
    const ifaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                // Ignore Automatic Private IP Addressing (APIPA)
                if (!iface.address.startsWith('169.254.')) {
                    ips.push(iface.address);
                }
            }
        }
    }
    return ips.length > 0 ? ips : ['localhost'];
}

function timestamp() {
    return new Date().toLocaleTimeString();
}

// ── Top-level server variables (set during async init) ──────────────────────
let httpServer = null;
let wss = null;
const clients = new Set();

function renderMenu() {
    process.stdout.write('\x1B[?25l'); // hide cursor
    console.log(`[${timestamp()}] ⏳ Connect your phone, then select a terminal to start:`);
    for (let i = 0; i < CLI_OPTIONS.length; i++) {
        const prefix = i === selectedIndex ? '  > \x1b[36m' : '    \x1b[0m';
        console.log(`${prefix}${CLI_OPTIONS[i].name} (${CLI_OPTIONS[i].cmd})\x1b[0m`);
    }
    // Move cursor back up to redraw next time
    process.stdout.write(`\x1b[${CLI_OPTIONS.length + 1}A`);
}

// ── HTTP(S) Server (serves client.html + /api/token) ────────────────────────
const CLIENT_HTML = path.join(__dirname, 'client.html');

function requestHandler(req, res) {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        fs.readFile(CLIENT_HTML, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('client.html not found next to bridge-server.js');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            }
        });
    } else if (req.method === 'GET' && req.url === '/api/token') {
        // Serve the session token dynamically — encrypted in transit via TLS
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ token: AUTH_TOKEN }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
}

// ── Async startup (TLS cert generation is async) ────────────────────────────
(async () => {
    let tlsOptions = null;
    if (!noTls) {
        tlsOptions = await ensureSelfSignedCert();
    }
    const protocol = tlsOptions ? 'https' : 'http';

    console.log(`[${timestamp()}] ──────────────────────────────────────────────────────────────`);
    console.log(`[${timestamp()}] ✅ Gemini Standalone Bridge Starting...`);

    const ips = getLocalIPs();
    console.log(`[${timestamp()}] 📡 Open in browser (any device on your network):`);
    ips.forEach(ip => {
        console.log(`[${timestamp()}]       - ${protocol}://${ip}:${port}`);
    });
    console.log(`[${timestamp()}]       - ${protocol}://localhost:${port}  (this machine)`);

    console.log(`[${timestamp()}] 🔑 Auth Token:   ${AUTH_TOKEN}`);
    if (tlsOptions) {
        console.log(`[${timestamp()}] 🔒 TLS:           Enabled (self-signed)`);
    } else {
        console.log(`[${timestamp()}] ⚠️  TLS:           Disabled (plain HTTP)`);
    }
    if (command) {
        console.log(`[${timestamp()}] 🚀 Command:       ${command}`);
    }
    console.log(`[${timestamp()}] ──────────────────────────────────────────────────────────────`);

    // ── QR Code for mobile connection ─────────────────────────────────────────
    const primaryIP = ips[0] === 'localhost' ? 'localhost' : ips[0];
    const connectURL = `${protocol}://${primaryIP}:${port}`;
    console.log(`\n[${timestamp()}] 📱 Scan to connect from your phone:\n`);
    qrcode.generate(connectURL, { small: true }, (code) => {
        console.log(code);
        if (command) {
            console.log(`[${timestamp()}] ⏳ Press ANY KEY when you are ready to start the terminal (${command})...`);
        } else {
            renderMenu();
        }
    });

    httpServer = tlsOptions
        ? https.createServer(tlsOptions, requestHandler)
        : http.createServer(requestHandler);

    httpServer.listen(port, '0.0.0.0');

    // When TLS is enabled, also start a plain HTTP redirect server on port+1
    // so that http:// URLs land somewhere helpful instead of hanging.
    if (tlsOptions) {
        const redirectServer = http.createServer((req, res) => {
            const host = (req.headers.host || '').replace(/:.*$/, ''); // strip old port
            res.writeHead(301, { Location: `https://${host}:${port}${req.url}` });
            res.end();
        });
        redirectServer.listen(port + 1, '0.0.0.0');
        console.log(`[${timestamp()}] 🔀 HTTP redirect: http://*:${port + 1} → https://*:${port}`);
    }

    // ── WebSocket Server (shares HTTP port) ──────────────────────────────────────
    wss = new WebSocketServer({ server: httpServer });

    // Buffer recent output so newly-connected clients can see context
    const recentLines = [];
    const MAX_RECENT = 50;

    function addRecent(text) {
        recentLines.push(text);
        while (recentLines.length > MAX_RECENT) { recentLines.shift(); }
    }

    function broadcast(data) {
        const payload = JSON.stringify(data);
        for (const ws of clients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        }
    }

    wss.on('listening', () => {
        // Already logged IP info above
    });

    wss.on('connection', (ws, req) => {
        const clientIP = req.socket.remoteAddress;
        console.log(`[${timestamp()}] 📱 Client connected: ${clientIP}`);
        let authenticated = false;

        ws.on('message', (rawData) => {
            try {
                const msg = JSON.parse(rawData.toString());

                // Auth handshake
                if (!authenticated) {
                    if (msg.type === 'auth' && msg.token === AUTH_TOKEN) {
                        authenticated = true;
                        clients.add(ws);
                        ws.send(JSON.stringify({ type: 'auth', status: 'ok' }));
                        console.log(`[${timestamp()}] ✅ Authenticated: ${clientIP}`);

                        // Send recent output so they see context
                        if (recentLines.length > 0) {
                            ws.send(JSON.stringify({
                                type: 'output',
                                text: recentLines.join(''), // Raw binary stream
                            }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'auth', status: 'denied' }));
                        ws.close();
                        console.log(`[${timestamp()}] ❌ Rejected: ${clientIP}`);
                    }
                    return;
                }

                // Commands
                switch (msg.type) {
                    case 'prompt':
                        if (typeof msg.text === 'string' && ptyProcess) {
                            ptyProcess.write(msg.text);
                        }
                        break;

                    case 'interrupt':
                        if (ptyProcess) ptyProcess.write('\x03'); // Ctrl+C
                        console.log(`[${timestamp()}] ⚠️ Ctrl+C sent`);
                        break;

                    case 'ping':
                        ws.send(JSON.stringify({ type: 'pong' }));
                        break;

                    case 'resize':
                        if (msg.cols && msg.rows && ptyProcess) {
                            ptyProcess.resize(msg.cols, msg.rows);
                        }
                        break;

                    default:
                        console.log(`[${timestamp()}] Unknown: ${msg.type}`);
                }
            } catch {
                console.log(`[${timestamp()}] ⚠️ Bad message from ${clientIP}`);
            }
        });

        ws.on('close', () => {
            clients.delete(ws);
            console.log(`[${timestamp()}] 📱 Disconnected: ${clientIP}`);
        });
    });

    wss.on('error', (err) => {
        console.error(`[${timestamp()}] ❌ Server error: ${err.message}`);
    });

    // ── Wait for first keypress to launch PTY ────────────────────────────────────

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    let hasStartedPty = false;

    process.stdin.on('data', (data) => {
        // Forward all subsequent local keystrokes to the PTY
        if (hasStartedPty && ptyProcess) {
            if (data.toString() === '\x03' && process.platform !== 'win32') {
                // Let SIGINT/PTY handle it if started
            }
            ptyProcess.write(data);
            return;
        }

        if (!hasStartedPty) {
            const str = data.toString();

            // Handle Ctrl+C to exit safely before PTY starts
            if (str === '\x03') {
                process.stdout.write('\x1B[?25h'); // restore cursor
                process.stdout.write(`\x1b[${CLI_OPTIONS.length + 2}B\n`); // move down below menu
                process.exit(0);
            }

            if (!command) {
                // Arrow key menu navigation
                if (str === '\x1b[A' || str === 'w') { // up
                    selectedIndex = Math.max(0, selectedIndex - 1);
                    renderMenu();
                    return;
                } else if (str === '\x1b[B' || str === 's') { // down
                    selectedIndex = Math.min(CLI_OPTIONS.length - 1, selectedIndex + 1);
                    renderMenu();
                    return;
                } else if (str === '\r' || str === '\n') { // enter
                    command = CLI_OPTIONS[selectedIndex].cmd;
                    process.stdout.write('\x1B[?25h'); // restore cursor
                    process.stdout.write(`\x1b[${CLI_OPTIONS.length + 1}B\n`); // move below menu
                    startPty();
                }
                return;
            } else {
                // Command provided via CLI args, wait for any key
                startPty();
                return;
            }
        }
    });

    function startPty() {
        hasStartedPty = true;
        console.log(`\n[${timestamp()}] Starting PTY: ${command}`);

        const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
        const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

        ptyProcess = pty.spawn(shell, shellArgs, {
            name: 'xterm-256color',
            cols: 120,
            rows: 30,
            cwd: process.env.USERPROFILE || process.env.HOME || '.',
            env: process.env,
        });

        console.log(`[${timestamp()}] ✅ PTY running (PID ${ptyProcess.pid})`);

        ptyProcess.onData((raw) => {
            addRecent(raw);
            broadcast({ type: 'output', text: raw });
            process.stdout.write(raw);
        });

        ptyProcess.onExit(({ exitCode }) => {
            console.log(`\n[${timestamp()}] PTY exited with code ${exitCode}.`);
            broadcast({ type: 'status', message: `Process exited (code ${exitCode}).` });
            setTimeout(() => process.exit(exitCode || 0), 2000);
        });
    }

    // ── Graceful shutdown ────────────────────────────────────────────────────────
    process.on('SIGINT', () => {
        console.log(`\n[${timestamp()}] Shutting down…`);
        if (ptyProcess) ptyProcess.kill();
        for (const ws of clients) { ws.close(); }
        wss.close();
        process.exit(0);
    });

})(); // end async startup
