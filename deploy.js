const fs   = require("fs");
const path = require("path");
const { Client } = require("ssh2");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const LOCAL  = path.resolve(__dirname);
const REMOTE = "C:/Users/Administrator/Desktop/muzik-botu/muzik-botu";

const SSH_HOST     = process.env.SSH_HOST || "89.47.113.220";
const SSH_PORT     = parseInt(process.env.SSH_PORT) || 22;
const SSH_USER     = process.env.SSH_USER || "Administrator";
const SSH_PASSWORD = process.env.SSH_PASSWORD;

if (!SSH_PASSWORD) {
    console.error("[DEPLOY] HATA: .env dosyasinda SSH_PASSWORD tanimli degil!");
    process.exit(1);
}

// Kod ve konfigürasyon dosyaları (Her zaman güncellenir)
const CODE_FILES = ["index.js", ".env", "PROJE_REHBERI_VE_MIMARI.md", "ecosystem.config.js"];
const SRC_DIR    = path.join(LOCAL, "src");
const SRC_FILES  = fs.existsSync(SRC_DIR) ? fs.readdirSync(SRC_DIR).map(f => `src/${f}`) : [];
const FILES      = [...CODE_FILES, ...SRC_FILES];

const conn = new Client();
conn.on("error", (err) => { 
    if (err.code === "ECONNRESET") return;
    console.error("[SSH] HATA:", err.message); 
    process.exit(1); 
});
conn.on("ready", () => {
    console.log(`[SSH] Baglandi -> ${SSH_HOST}`);
    conn.sftp((err, sftp) => {
        if (err) { console.error("[SFTP] HATA:", err.message); conn.end(); return; }

        // Uzak sunucuda src klasörünün varlığını garantiye al
        sftp.mkdir(REMOTE + "/src", () => {
            let idx = 0;
            function uploadNext() {
                if (idx >= FILES.length) {
                    console.log("[SSH] Kod dosyalari aktarildi. Veritabani kontrol ediliyor...");

                    // Canlı sunucuda music_db.json var mı kontrol et; yoksa ilk kopyayı yükle (üzerine yazma KESİNLİKLE YAPILMAZ)
                    sftp.stat(REMOTE + "/music_db.json", (statErr) => {
                        if (statErr) {
                            console.log("[SFTP] Uzak sunucuda music_db.json bulunamadi, baslangic sablonu yukleniyor...");
                            sftp.fastPut(path.join(LOCAL, "music_db.json"), REMOTE + "/music_db.json", () => restartPM2());
                        } else {
                            console.log("[SFTP] Uzak sunucudaki canli veritabani (music_db.json) korundu (ezilmedi).");
                            restartPM2();
                        }
                    });
                    return;
                }

                const file   = FILES[idx++];
                const local  = path.join(LOCAL, file);
                const remote = REMOTE + "/" + file.replace(/\\/g, "/");
                if (!fs.existsSync(local)) { console.log("[SKIP] " + file); uploadNext(); return; }
                console.log("[SFTP] " + file + " yukleniyor...");
                sftp.fastPut(local, remote, (err) => {
                    if (err) { console.error("[SFTP] " + file + " HATA:", err.message); conn.end(); return; }
                    console.log("[SFTP] " + file + " OK");
                    uploadNext();
                });
            }

            function restartPM2() {
                console.log("[SSH] PM2 servisi guvenli sekilde yeniden baslatiliyor...");
                const cmd = "powershell -Command \"taskkill /IM yt-dlp.exe /F 2>$null; taskkill /IM ffmpeg.exe /F 2>$null; pm2 restart muzik-botu --update-env; pm2 list\"";
                conn.exec(cmd, (err, stream) => {
                    if (err) { console.error("[CMD] HATA:", err.message); conn.end(); return; }
                    stream.on("data", d => process.stdout.write(d.toString()));
                    stream.stderr.on("data", d => process.stderr.write(d.toString()));
                    stream.on("close", () => { console.log("\n[DEPLOY] Basariyla tamamlandi!"); conn.end(); });
                });
            }

            uploadNext();
        });
    });
}).connect({ host: SSH_HOST, port: SSH_PORT, username: SSH_USER, password: SSH_PASSWORD, readyTimeout: 20000 });
