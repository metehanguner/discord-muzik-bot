const { Client } = require('ssh2');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const conn = new Client();
const host = process.env.SSH_HOST || '89.47.113.220';
const port = parseInt(process.env.SSH_PORT) || 22;
const username = process.env.SSH_USER || 'Administrator';
const password = process.env.SSH_PASSWORD || '';

console.log(`Sunucuya bağlanılıyor (${host})...`);

conn.on('ready', () => {
    console.log('✅ SSH bağlantısı kuruldu. Canlı log akışı başlatılıyor...\n------------------------------------------------------------');
    const cmd = 'powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -Encoding UTF8 -Wait -Tail 25 \'C:\\Users\\Administrator\\Desktop\\muzik-botu\\muzik-botu\\bot.log\'"';
    
    conn.exec(cmd, (err, stream) => {
        if (err) {
            console.error('Exec hatası:', err);
            conn.end();
            return;
        }

        stream.setEncoding('utf8');
        stream.on('data', (data) => {
            process.stdout.write(data);
        });

        stream.stderr.on('data', (data) => {
            process.stderr.write(data);
        });

        stream.on('close', () => {
            console.log('\nLog akışı sonlandı.');
            conn.end();
        });
    });
}).on('error', (err) => {
    if (!err.message.includes('ECONNRESET')) {
        console.error('SSH Bağlantı Hatası:', err.message);
    }
}).connect({
    host,
    port,
    username,
    password,
    readyTimeout: 15000,
    keepaliveInterval: 10000
});
