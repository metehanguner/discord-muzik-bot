const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = 3333;
const SSH_CONFIG = {
    host: process.env.SSH_HOST || '89.47.113.220',
    port: parseInt(process.env.SSH_PORT) || 22,
    username: process.env.SSH_USER || 'Administrator',
    password: process.env.SSH_PASSWORD || '',
    readyTimeout: 15000,
    keepaliveInterval: 10000
};

let clients = [];
let sshClient = null;
let isConnected = false;

function connectSSH() {
    if (sshClient) {
        try { sshClient.end(); } catch (_) {}
    }

    sshClient = new Client();
    sshClient.on('ready', () => {
        isConnected = true;
        broadcast({ type: 'status', connected: true, server: SSH_CONFIG.host });

        // PowerShell UTF-8 cikti ve UTF-8 dosya okuma zorlamasi
        const cmd = 'powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -Encoding UTF8 -Wait -Tail 50 \'C:\\Users\\Administrator\\Desktop\\muzik-botu\\muzik-botu\\bot.log\'"';
        sshClient.exec(cmd, (err, stream) => {
            if (err) {
                console.error('[SSH] Exec hatasi:', err);
                return;
            }
            stream.setEncoding('utf8');
            let buffer = '';
            stream.on('data', (data) => {
                buffer += data;
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop(); // Tamamlanmamis parcayi tut
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed) {
                        console.log(trimmed);
                        broadcast({ type: 'log', line: trimmed });
                    }
                }
            });
            stream.on('close', () => {
                isConnected = false;
                broadcast({ type: 'status', connected: false });
                setTimeout(connectSSH, 3000);
            });
        });
    });

    sshClient.on('error', (err) => {
        if (!err.message.includes('ECONNRESET')) {
            console.error('[SSH] Hata:', err.message);
        }
        isConnected = false;
        broadcast({ type: 'status', connected: false, error: err.message });
    });

    sshClient.on('close', () => {
        isConnected = false;
        broadcast({ type: 'status', connected: false });
        setTimeout(connectSSH, 4000);
    });

    try {
        sshClient.connect(SSH_CONFIG);
    } catch (e) {
        console.error('[SSH] Baglanti cagrisi basarisiz:', e.message);
        setTimeout(connectSSH, 4000);
    }
}

function broadcast(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    clients.forEach(client => {
        try { client.res.write(data); } catch (_) {}
    });
}

connectSSH();

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = req.url.split('?')[0];

    // SSE Canli Akis
    if (url === '/api/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write('\n');

        const clientId = Date.now();
        const client = { id: clientId, res };
        clients.push(client);

        res.write(`data: ${JSON.stringify({ type: 'status', connected: isConnected, server: SSH_CONFIG.host })}\n\n`);

        req.on('close', () => {
            clients = clients.filter(c => c.id !== clientId);
        });
        return;
    }

    // Botu Yeniden Baslatma API
    if (url === '/api/restart' && req.method === 'POST') {
        if (!sshClient || !isConnected) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: 'Sunucuya bağlı değil!' }));
            return;
        }
        sshClient.exec('pm2 restart muzik-botu', (err, stream) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: err.message }));
                return;
            }
            let output = '';
            stream.on('data', d => output += d);
            stream.on('close', () => {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, output }));
            });
        });
        return;
    }

    // Static Dosyalar
    let filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, 'public', 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
    };
    const contentType = mimeTypes[ext] || 'text/plain; charset=utf-8';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`===========================================================`);
    console.log(`  AdMeliora Canli Log Paneli Aktif (UTF-8 Turkce Desteği Aktif)`);
    console.log(`  Adres: http://localhost:${PORT}`);
    console.log(`===========================================================`);
});
