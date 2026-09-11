const fs = require("fs");
const { EmbedBuilder } = require("discord.js");
const { LOG_FILE } = require("./config");

// ============================================================
//  LOGGING SiSTEMi  |  Seviyeler: SYSTEM | INFO | DEBUG | WARNING | ERROR | FATAL
// ============================================================
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a", encoding: "utf8" });
let lastErrorLog = "";
const recentLogs = [];

function logger(msg, level = "INFO") {
    const time = new Date().toLocaleString("tr-TR");
    const logText = `[${time}] [${level.padEnd(7)}] ${msg}\n`;
    process.stdout.write(logText);
    try { logStream.write(logText); } catch (_) {}

    recentLogs.push(logText.trim());
    if (recentLogs.length > 20) recentLogs.shift();
    if (level === "ERROR" || level === "FATAL" || level === "WARNING") {
        lastErrorLog = logText.trim();
    }
}

// Kullanıcı bilgi ayıklayıcı
function extractUserInfo(user) {
    if (!user) return { name: "Bilinmiyor", id: null };
    if (typeof user === "object") {
        return {
            name: user.username || user.tag || user.name || "Bilinmiyor",
            id:   user.id || null
        };
    }
    return { name: String(user), id: null };
}

// Bir hata durumunda şarkıyı talep eden kullanıcıya hata özetini DM olarak ilet
async function notifyRequesterAboutError(client, songOrUser, error, context = "") {
    const userId = (songOrUser && songOrUser.requestedById) ? songOrUser.requestedById : (songOrUser && songOrUser.id ? songOrUser.id : null);
    if (!userId || !client) return;

    try {
        const targetUser = await client.users.fetch(userId).catch(() => null);
        if (!targetUser) return;

        const errText = error && error.stack ? error.stack : String(error || "Bilinmeyen hata");
        const songTitle = (songOrUser && songOrUser.title) ? songOrUser.title : "Talep Edilen Parça";
        const songUrl = (songOrUser && songOrUser.url && songOrUser.url.startsWith("http")) ? songOrUser.url : null;
        const errorSnippet = lastErrorLog ? `${lastErrorLog}\n\n🔍 Hata Detayı: ${errText.substring(0, 400)}` : errText.substring(0, 600);

        const embed = new EmbedBuilder()
            .setColor("#ED4245")
            .setAuthor({ name: "⚠️ OYNATMA HATASI BİLDİRİMİ" })
            .setTitle(`❌ ${songTitle.substring(0, 95)}`)
            .setDescription(`Çalınması istenen parçada bir sorun meydana geldi ve sistem tarafından işlenemedi.\n\n📌 **Aşama:** \`${context || "Ses Akışı / Oynatma"}\`\n\n📋 **Bottaki Son Hata Logu:**\n\`\`\`txt\n${errorSnippet.substring(0, 900)}\n\`\`\``)
            .setFooter({ text: "🛡️ AdMeliora Music • Otomatik Hata Raporlama" })
            .setTimestamp();

        if (songUrl) embed.setURL(songUrl);

        await targetUser.send({ embeds: [embed] }).catch((dmErr) => {
            logger(`[NOTIFY] Kullaniciya DM gonderilemedi (DM kapali olabilir): ${targetUser.tag} | ${dmErr.message}`, "WARNING");
        });
        logger(`[NOTIFY] Hata logu sarkiyi isteyen kullaniciya iletildi: ${targetUser.tag} (${targetUser.id}) | Sarki: "${songTitle}"`, "INFO");
    } catch (notifyErr) {
        logger(`[NOTIFY] Bildirim gonderme sirasinda hata: ${notifyErr.message}`, "ERROR");
    }
}

// Zaman biçimlendiriciler
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const hrs  = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs > 0) {
        return `${hrs}:${String(remMins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseDurationSec(duration, str) {
    if (typeof duration === "number" && !isNaN(duration) && duration > 0) return duration;
    if (typeof str === "string" && str.includes(":")) {
        const parts = str.split(":").map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return parts[0] * 60 + parts[1];
        if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
}

function formatDurationSec(sec) {
    if (!sec || isNaN(sec) || sec <= 0) return "Bilinmiyor";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

// İlerleme çubuğu
function createProgressBar(currentSec, totalSec, size = 14) {
    if (!totalSec || totalSec <= 0) return `\`🔘${"▬".repeat(size - 1)}\` \`[${formatTime(currentSec)} / 00:00]\``;
    const progress = Math.min(Math.max(currentSec / totalSec, 0), 1);
    const progressChars = Math.round(size * progress);
    const emptyChars = Math.max(size - progressChars, 0);
    const filled = "▬".repeat(Math.max(progressChars - 1, 0));
    const empty  = "▬".repeat(emptyChars);
    return `\`${filled}🔘${empty}\` \`[${formatTime(currentSec)} / ${formatTime(totalSec)}]\``;
}

// Discord markdown link syntax koruyucu (köşeli parantezleri temizler)
function formatMarkdownTitle(title, maxLen = 60) {
    if (!title) return "Bilinmeyen Şarkı";
    const clean = title.replace(/[\[\]]/g, "").replace(/[\*`_~]/g, "").replace(/\s+/g, " ").trim();
    return clean.length > maxLen ? clean.substring(0, maxLen - 3) + "..." : clean;
}

module.exports = {
    logger,
    extractUserInfo,
    notifyRequesterAboutError,
    formatTime,
    parseDurationSec,
    formatDurationSec,
    createProgressBar,
    formatMarkdownTitle
};
