const http  = require("http");
const https = require("https");
const { logger } = require("./logger");
const {
    TRACK_USER_ID,
    TRACK_USERNAME,
    CALLMEBOT_TELEGRAM_USER,
    CALLMEBOT_WHATSAPP_PHONE,
    CALLMEBOT_WHATSAPP_APIKEY,
    TRACK_COOLDOWN_MINUTES
} = require("./config");

let lastTriggerTime = 0;
const COOLDOWN_MS = (TRACK_COOLDOWN_MINUTES || 10) * 60 * 1000;

// HTTP / HTTPS GET yardımcı fonksiyonu (güvenli, redirect ve zaman aşımı destekli)
function httpGet(urlStr) {
    return new Promise((resolve, reject) => {
        try {
            const parsed = new URL(urlStr);
            const client = parsed.protocol === "https:" ? https : http;
            const req = client.get(urlStr, { timeout: 15000 }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return resolve(httpGet(res.headers.location));
                }
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => resolve({ statusCode: res.statusCode, data }));
            });
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Zaman aşımı (15s)"));
            });
            req.on("error", err => reject(err));
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Arama / bildirim isteği gönderir
 * @param {string} reason Tetiklenme nedeni (örn: "f6hako Çevrimiçi Oldu")
 */
async function sendCallNotification(reason = "Hedef kullanıcı Discord üzerinde çevrimiçi oldu!") {
    const results = [];
    const messageText = `Dikkat! ${reason}`;

    // 1. Telegram Sesli Telefon Araması (CallMeBot Telegram Phone Call)
    if (CALLMEBOT_TELEGRAM_USER && CALLMEBOT_TELEGRAM_USER.trim() !== "@") {
        try {
            let tgUser = CALLMEBOT_TELEGRAM_USER.trim();
            // Telefon numarası girilmişse (+905...) @ ekleme, düz numara olarak gönder
            if (tgUser.startsWith("+") || /^\d+$/.test(tgUser.replace(/[\s-]/g, ""))) {
                tgUser = tgUser.replace(/[\s-]/g, "");
            } else if (!tgUser.startsWith("@")) {
                tgUser = `@${tgUser}`;
            }

            const encodedText = encodeURIComponent(messageText).replace(/%20/g, "+");
            const url = `https://api.callmebot.com/start.php?user=${encodeURIComponent(tgUser)}&text=${encodedText}&lang=tr-TR-Standard-A&rpt=2`;
            logger(`[TRACKER] Telegram araması başlatılıyor -> ${tgUser}`, "SYSTEM");
            const res = await httpGet(url);
            logger(`[TRACKER] Telegram arama yanıtı (${res.statusCode}): ${res.data.substring(0, 150)}`, "INFO");
            results.push({ service: "Telegram Arama", success: res.statusCode === 200, detail: res.data.substring(0, 150) });
        } catch (err) {
            logger(`[TRACKER] Telegram arama hatası: ${err.message}`, "ERROR");
            results.push({ service: "Telegram Arama", success: false, error: err.message });
        }
    }

    // 2. WhatsApp Bildirimi / Araması
    if (CALLMEBOT_WHATSAPP_PHONE && CALLMEBOT_WHATSAPP_APIKEY) {
        try {
            const cleanPhone = CALLMEBOT_WHATSAPP_PHONE.replace(/[^\d+]/g, "");
            const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(cleanPhone)}&text=${encodeURIComponent(messageText)}&apikey=${encodeURIComponent(CALLMEBOT_WHATSAPP_APIKEY)}`;
            logger(`[TRACKER] WhatsApp uyarısı gönderiliyor -> ${cleanPhone}`, "SYSTEM");
            const res = await httpGet(url);
            logger(`[TRACKER] WhatsApp yanıtı (${res.statusCode}): ${res.data.substring(0, 100)}`, "INFO");
            results.push({ service: "WhatsApp", success: res.statusCode === 200, detail: res.data.substring(0, 100) });
        } catch (err) {
            logger(`[TRACKER] WhatsApp bildirim hatası: ${err.message}`, "ERROR");
            results.push({ service: "WhatsApp", success: false, error: err.message });
        }
    }

    if (!CALLMEBOT_TELEGRAM_USER && (!CALLMEBOT_WHATSAPP_PHONE || !CALLMEBOT_WHATSAPP_APIKEY)) {
        logger(`[TRACKER] UYARI: .env içinde ne CALLMEBOT_TELEGRAM_USER ne de WhatsApp parametreleri tanımlanmış!`, "WARNING");
        return { success: false, message: "Telefon arama servisi yapılandırılmamış. Lütfen .env dosyasını kontrol edin." };
    }

    return { success: true, results };
}

/**
 * Kullanıcının hedef takip listesinde olup olmadığını kontrol eder
 */
function isTargetUser(presence) {
    if (!presence) return false;
    if (TRACK_USER_ID && presence.userId === TRACK_USER_ID) return true;

    const user = presence.user || (presence.member && presence.member.user);
    const targetName = (TRACK_USERNAME || "f6hako").toLowerCase();

    if (user && user.username && user.username.toLowerCase() === targetName) {
        return true;
    }
    return false;
}

/**
 * Takip modülünü Discord Client'a bağlar
 */
function initTracker(client) {
    const targetDesc = TRACK_USER_ID ? `ID: ${TRACK_USER_ID}` : `Kullanıcı Adı: ${TRACK_USERNAME || "f6hako"}`;
    logger(`[TRACKER] Takip Motoru Başlatıldı. Hedef: ${targetDesc}`, "SYSTEM");
    logger(`[TRACKER] Bekleme Süresi (Cooldown): ${TRACK_COOLDOWN_MINUTES || 10} dakika`, "INFO");

    // PresenceUpdate Olayı Dinleyicisi
    client.on("presenceUpdate", async (oldPresence, newPresence) => {
        try {
            if (!isTargetUser(newPresence)) return;

            const oldStatus = oldPresence ? oldPresence.status : "offline";
            const newStatus = newPresence ? newPresence.status : "offline";

            const user = newPresence.user || (newPresence.member && newPresence.member.user);
            const tag = user ? user.tag || user.username : (TRACK_USERNAME || "f6hako");

            logger(`[TRACKER] Durum değişikliği algılandı | ${tag} | Eski: ${oldStatus} -> Yeni: ${newStatus}`, "DEBUG");

            // Kullanıcı çevrimdışından çevrimiçiye (veya dnd/idle) geçtiyse
            const wasOffline = oldStatus === "offline";
            const isNowOnline = newStatus === "online" || newStatus === "dnd" || newStatus === "idle";

            if (wasOffline && isNowOnline) {
                const now = Date.now();
                if (now - lastTriggerTime < COOLDOWN_MS) {
                    const remainingMin = Math.ceil((COOLDOWN_MS - (now - lastTriggerTime)) / 60000);
                    logger(`[TRACKER] ${tag} ONLINE oldu fakat bekleme süresi aktif! Kalan: ${remainingMin} dk.`, "WARNING");
                    return;
                }

                lastTriggerTime = now;
                logger(`[TRACKER] 🚨 ALARM! ${tag} ONLINE OLDU! Telefon araması tetikleniyor...`, "SYSTEM");

                await sendCallNotification(`${tag} şu anda Discord'da çevrimiçi oldu!`);
            }
        } catch (err) {
            logger(`[TRACKER] PresenceUpdate işlenirken hata: ${err.message}`, "ERROR");
        }
    });
}

/**
 * Manuel Test Tetikleyici (.ara-test)
 */
async function triggerTestCall() {
    logger(`[TRACKER] Manuel test araması tetiklendi.`, "INFO");
    const res = await sendCallNotification("Bu bir test arama uyarısıdır! AdMeliora Takip Botu başarıyla çalışıyor.");
    if (!res.success) {
        return { message: `⚠️ **Arama Yapılamadı:** ${res.message}` };
    }
    return { message: "📞 **Test araması / bildirimi gönderildi!** Telefonunuzu kontrol edin." };
}

/**
 * Takip modülü durum özeti (.takip)
 */
function getTrackerStatus(client) {
    const targetDesc = TRACK_USER_ID ? `ID: \`${TRACK_USER_ID}\`` : `Kullanıcı Adı: \`${TRACK_USERNAME || "f6hako"}\``;
    const tgConfig = CALLMEBOT_TELEGRAM_USER ? `✅ \`${CALLMEBOT_TELEGRAM_USER}\`` : "❌ Tanımlı Değil";
    const waConfig = CALLMEBOT_WHATSAPP_PHONE ? `✅ \`${CALLMEBOT_WHATSAPP_PHONE}\`` : "❌ Tanımlı Değil";

    let lastSeen = "Henüz tetiklenmedi";
    if (lastTriggerTime > 0) {
        const passedMin = Math.floor((Date.now() - lastTriggerTime) / 60000);
        lastSeen = `${passedMin} dakika önce tetiklendi`;
    }

    return `📡 **Discord Kullanıcı Takip ve Arama Durumu**\n` +
           `🎯 **Hedef:** ${targetDesc}\n` +
           `📞 **Telegram Arama:** ${tgConfig}\n` +
           `💬 **WhatsApp Bildirim:** ${waConfig}\n` +
           `⏳ **Bekleme Süresi (Cooldown):** ${TRACK_COOLDOWN_MINUTES || 10} dk\n` +
           `🕒 **Son Alarm:** ${lastSeen}\n\n` +
           `_Test etmek için **.ara-test** komutunu kullanabilirsiniz._`;
}

module.exports = {
    initTracker,
    sendCallNotification,
    triggerTestCall,
    getTrackerStatus,
    isTargetUser
};
