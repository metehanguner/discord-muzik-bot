const fs = require("fs");
const path = require("path");
const { DB_FILE, CHANNELS_FILE } = require("./config");
const { logger } = require("./logger");

// ============================================================
//  GÜVENLİ ATOMİK DOSYA YAZMA & FELAKET KURTARMA (Disaster Recovery)
// ============================================================
function atomicWriteJson(filePath, data) {
    const tmpFile = `${filePath}.tmp_${Date.now()}`;
    const bakFile = `${filePath}.bak`;
    const jsonStr = JSON.stringify(data, null, 2);

    try {
        // 1) Önce geçici dosyaya yaz
        fs.writeFileSync(tmpFile, jsonStr, "utf8");

        // 2) Eğer mevcut ana dosya sağlamsa, .bak olarak yedekle
        if (fs.existsSync(filePath)) {
            try {
                fs.copyFileSync(filePath, bakFile);
            } catch (_) {}
        }

        // 3) Geçici dosyayı asıl dosyanın üzerine taşı (Atomic Rename)
        try {
            fs.renameSync(tmpFile, filePath);
        } catch (renameErr) {
            // Windows üzerinde hedef dosya kilitliyse copy + unlink fallback
            fs.copyFileSync(tmpFile, filePath);
            try { fs.unlinkSync(tmpFile); } catch (_) {}
        }
        return true;
    } catch (e) {
        logger(`[DB/ATOMIC] Dosya yazma hatasi: ${e.message} | Hedef: ${filePath}`, "ERROR");
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
        return false;
    }
}

// In-memory önbellek
let _dbCache = null;

// Aktif metin kanalını hatırla
function saveActiveChannel(guildId, channelId) {
    try {
        let chs = {};
        if (fs.existsSync(CHANNELS_FILE)) {
            try { chs = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8")); } catch (_) {}
        }
        chs[guildId] = channelId;
        atomicWriteJson(CHANNELS_FILE, chs);
    } catch (_) {}
}

function getActiveChannels() {
    try {
        if (!fs.existsSync(CHANNELS_FILE)) return {};
        return JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
    } catch (_) {
        return {};
    }
}

// Veritabanını oku (Otomatik .bak kurtarmalı)
const getDB = (forceReload = false) => {
    if (_dbCache && !forceReload) return _dbCache;

    const bakFile = `${DB_FILE}.bak`;
    if (!fs.existsSync(DB_FILE)) {
        // Eğer DB_FILE yok ama .bak varsa hemen kurtar
        if (fs.existsSync(bakFile)) {
            try {
                const recovered = JSON.parse(fs.readFileSync(bakFile, "utf8"));
                logger(`[DB/RECOVERY] music_db.json bulunamadi, .bak dosyasindan kurtarildi!`, "WARNING");
                atomicWriteJson(DB_FILE, recovered);
                _dbCache = recovered;
                return _dbCache;
            } catch (_) {}
        }
        _dbCache = { users: {}, guilds: {} };
        return _dbCache;
    }

    try {
        const content = fs.readFileSync(DB_FILE, "utf8");
        _dbCache = JSON.parse(content);
        if (!_dbCache.users) _dbCache.users = {};
        if (!_dbCache.guilds) _dbCache.guilds = {};
        return _dbCache;
    } catch (parseErr) {
        logger(`[DB/CRITICAL] music_db.json bozuk! .bak dosyasindan otomatik onarim deneniyor... (${parseErr.message})`, "FATAL");
        if (fs.existsSync(bakFile)) {
            try {
                const recovered = JSON.parse(fs.readFileSync(bakFile, "utf8"));
                logger(`[DB/RECOVERY] music_db.json .bak dosyasindan basariyla kurtarildi!`, "SYSTEM");
                atomicWriteJson(DB_FILE, recovered);
                _dbCache = recovered;
                return _dbCache;
            } catch (bakErr) {
                logger(`[DB/FATAL] .bak dosyasi da okunamadi: ${bakErr.message}`, "FATAL");
            }
        }
        _dbCache = { users: {}, guilds: {} };
        return _dbCache;
    }
};

// Kullanıcı favorilerine şarkı ekle (Tekilleştirme korumalı)
const saveToDB = (userId, guildId, song) => {
    if (!userId || !song || !song.title) return false;
    const db = getDB();
    if (!db.users) db.users = {};
    if (!db.users[userId]) db.users[userId] = [];

    const isAlreadySaved = db.users[userId].some(s =>
        (s.url && song.url && s.url === song.url) ||
        (s.title && song.title && s.title.toLowerCase().trim() === song.title.toLowerCase().trim())
    );

    if (isAlreadySaved) {
        logger(`[DB] Zaten kayitli -> "${song.title}" (kullanici: ${userId})`, "DEBUG");
        return false;
    }

    db.users[userId].push({
        title:    song.title,
        url:      song.url,
        duration: song.duration || "Bilinmiyor",
        uploader: song.uploader || "Bilinmiyor"
    });

    // Sunucu kaydı yoksa sıfır sayacıyla oluştur (oynatma sayacı şişirilmez)
    if (guildId) {
        if (!db.guilds) db.guilds = {};
        if (!db.guilds[guildId]) db.guilds[guildId] = {};
        const key = song.url || song.title;
        if (!db.guilds[guildId][key]) {
            db.guilds[guildId][key] = {
                title:    song.title,
                url:      song.url,
                count:    0,
                duration: song.duration || "Bilinmiyor",
                uploader: song.uploader || "Bilinmiyor"
            };
        }
    }

    _dbCache = db;
    atomicWriteJson(DB_FILE, db);
    const totalFavs = db.users[userId].length;
    logger(`[DB] Kaydedildi -> "${song.title}" | Kullanici toplam: ${totalFavs}`, "INFO");
    return true;
};

// Sunucuda gerçek çalınma sayısını kaydet (+1 artır)
const recordGuildPlay = (guildId, song) => {
    try {
        if (!guildId || !song || !song.title) return;
        const db = getDB();
        if (!db.guilds) db.guilds = {};
        if (!db.guilds[guildId]) db.guilds[guildId] = {};

        // Video ID veya başlığa göre mevcut kaydı bul (URL varyasyonlarında çift kayıt oluşmasın)
        let foundKey = null;
        const videoIdMatch = (song.url || "").match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        const songVideoId = videoIdMatch ? videoIdMatch[1] : null;

        for (const [k, item] of Object.entries(db.guilds[guildId])) {
            if (songVideoId && (k.includes(songVideoId) || (item.url && item.url.includes(songVideoId)))) {
                foundKey = k;
                break;
            }
            if (item.title && song.title && item.title.toLowerCase().trim() === song.title.toLowerCase().trim()) {
                foundKey = k;
                break;
            }
        }

        const key = foundKey || (songVideoId ? `https://youtube.com/watch?v=${songVideoId}` : (song.url || song.title));

        if (!db.guilds[guildId][key]) {
            db.guilds[guildId][key] = {
                title:    song.title,
                url:      song.url || (songVideoId ? `https://youtube.com/watch?v=${songVideoId}` : ""),
                count:    0,
                duration: song.duration || "Bilinmiyor",
                uploader: song.uploader || "Bilinmiyor"
            };
        }
        db.guilds[guildId][key].count += 1;
        _dbCache = db;
        atomicWriteJson(DB_FILE, db);
        logger(`[DB] Sunucu oynatma sayildi -> "${song.title}" (Sunucu: ${guildId}, Toplam: ${db.guilds[guildId][key].count})`, "DEBUG");
    } catch (e) {
        logger(`[DB] recordGuildPlay hatasi: ${e.message}`, "WARNING");
    }
};

// Favorilerden sil
const removeFromDB = (userId, index) => {
    try {
        const db = getDB();
        if (!db.users || !db.users[userId] || !db.users[userId][index]) return null;
        const removed = db.users[userId].splice(index, 1)[0];
        _dbCache = db;
        atomicWriteJson(DB_FILE, db);
        logger(`[DB] Favorilerden silindi -> "${removed.title}" (Kullanici: ${userId}, Kalan: ${db.users[userId].length})`, "INFO");
        return removed;
    } catch (e) {
        logger(`[DB] removeFromDB hatasi: ${e.message}`, "WARNING");
        return null;
    }
};

module.exports = {
    saveActiveChannel,
    getActiveChannels,
    getDB,
    saveToDB,
    recordGuildPlay,
    removeFromDB
};
