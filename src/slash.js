const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const { logger } = require("./logger");

// ============================================================
//  SLASH KOMUT TANIMLARI  (Discord'da "/" yazınca çıkan liste)
//  Not: Discord komut adları küçük harf olmalı; kolay yazılsın diye ASCII seçildi.
// ============================================================
const STRING = ApplicationCommandOptionType.String;
const INTEGER = ApplicationCommandOptionType.Integer;
const SUB = ApplicationCommandOptionType.Subcommand;

const slashCommands = [
    {
        name: "cal",
        description: "Şarkı adı veya YouTube / Spotify linkiyle müzik çalar.",
        options: [{ type: STRING, name: "sorgu", description: "Şarkı adı veya link (YouTube / Spotify)", required: true }]
    },
    { name: "kuyruk",   description: "Çalma kuyruğunu gösterir." },
    { name: "sarki",    description: "Şu an çalan şarkıyı gösterir." },
    { name: "duraklat", description: "Çalan şarkıyı duraklatır veya devam ettirir." },
    { name: "gec",      description: "Sıradaki şarkıya geçer." },
    { name: "durdur",   description: "Müziği durdurur ve ses kanalından ayrılır." },
    {
        name: "ses",
        description: "Ses seviyesini ayarlar (0-200).",
        options: [{ type: INTEGER, name: "seviye", description: "Ses seviyesi (0-200)", required: true, min_value: 0, max_value: 200 }]
    },
    { name: "karistir", description: "Kuyruktaki şarkıları rastgele karıştırır." },
    { name: "temizle",  description: "Kuyruktaki tüm şarkıları temizler." },
    { name: "listem",   description: "Favori şarkı listeni açar." },
    { name: "populer",  description: "Sunucunun en çok dinlenen şarkılarını gösterir." },
    {
        name: "favori",
        description: "Favori şarkılarını yönet.",
        options: [
            { type: SUB, name: "liste", description: "Favori listeni açar." },
            {
                type: SUB, name: "ekle", description: "Şarkıyı favorilerine ekler (boşsa çalan şarkıyı ekler).",
                options: [{ type: STRING, name: "sarki", description: "Şarkı adı veya link (boş bırakırsan çalan şarkı)", required: false }]
            },
            {
                type: SUB, name: "sil", description: "Favorilerinden şarkı siler.",
                options: [{ type: INTEGER, name: "numara", description: "Silinecek şarkının sıra numarası", required: true, min_value: 1 }]
            }
        ]
    },
    { name: "yardim", description: "Bot komutlarını ve kullanımını gösterir." }
].map(c => ({ ...c, dm_permission: false }));

// Slash etkileşimini mevcut komut işleyicisinin anladığı (cmd, args) biçimine çevirir
function interactionToCommand(i) {
    const cmd = i.commandName;
    let args = [];
    if (cmd === "cal") {
        args = (i.options.getString("sorgu") || "").split(/\s+/).filter(Boolean);
    } else if (cmd === "ses") {
        args = [String(i.options.getInteger("seviye"))];
    } else if (cmd === "favori") {
        const sub = i.options.getSubcommand();
        if (sub === "ekle") {
            const q = (i.options.getString("sarki") || "").split(/\s+/).filter(Boolean);
            args = ["ekle", ...q];
        } else if (sub === "sil") {
            args = ["sil", String(i.options.getInteger("numara"))];
        }
    }
    return { cmd, args };
}

// Sunucu bazlı kayıt (anında görünür). Çift görünmesin diye global komutlar temizlenir.
async function registerSlashCommands(client) {
    try { await client.application.commands.set([]); } catch (e) {
        logger(`[SLASH] Global komutlar temizlenemedi: ${e.message}`, "WARNING");
    }
    for (const guild of client.guilds.cache.values()) {
        await registerForGuild(guild);
    }
}

async function registerForGuild(guild) {
    try {
        await guild.commands.set(slashCommands);
        logger(`[SLASH] ${slashCommands.length} komut kaydedildi -> ${guild.name} (${guild.id})`, "INFO");
    } catch (e) {
        logger(`[SLASH] Kayit hatasi (${guild.name}): ${e.message}`, "ERROR");
    }
}

// ============================================================
//  NOKTA (.) ÖNEK KOMUT ÖNERİLERİ
//  Discord, "." için canlı açılır liste desteklemez; bu yüzden kullanıcı
//  "." veya ".ç" gibi yarım komut gönderince eşleşen komutlar embed olarak listelenir.
// ============================================================
const dotCommands = [
    { name: "çal",      aliases: ["cal", "p", "play"],                 usage: "<şarkı adı / link>", description: "Şarkı adı veya YouTube / Spotify linkiyle müzik çalar." },
    { name: "kuyruk",   aliases: ["queue", "q"],                       usage: "",                   description: "Çalma kuyruğunu gösterir." },
    { name: "şarkı",    aliases: ["sarki", "np", "nowplaying"],        usage: "",                   description: "Şu an çalan şarkıyı gösterir." },
    { name: "duraklat", aliases: ["devam"],                            usage: "",                   description: "Çalan şarkıyı duraklatır veya devam ettirir." },
    { name: "geç",      aliases: ["gec", "skip"],                      usage: "",                   description: "Sıradaki şarkıya geçer." },
    { name: "durdur",   aliases: ["stop"],                             usage: "",                   description: "Müziği durdurur ve ses kanalından ayrılır." },
    { name: "ses",      aliases: ["volume"],                           usage: "<0-200>",            description: "Ses seviyesini ayarlar." },
    { name: "karıştır", aliases: ["karistir", "shuffle"],              usage: "",                   description: "Kuyruktaki şarkıları rastgele karıştırır." },
    { name: "temizle",  aliases: ["clear"],                            usage: "",                   description: "Kuyruktaki tüm şarkıları temizler." },
    { name: "listem",   aliases: [],                                    usage: "",                   description: "Favori şarkı listeni açar." },
    { name: "favori",   aliases: ["fav", "favoriekle", "favekle"],     usage: "[ekle <şarkı> | sil <no>]", description: "Favori şarkılarını yönetir." },
    { name: "popüler",  aliases: ["populer", "top"],                   usage: "",                   description: "Sunucunun en çok dinlenen şarkılarını gösterir." },
    { name: "yardım",   aliases: ["yardim", "help", "komutlar"],       usage: "",                   description: "Bot komutlarını ve kullanımını gösterir." },
    { name: "ara-test", aliases: ["aratest", "calltest"],              usage: "",                   description: "Telefon arama / bildirim servisini test eder." },
    { name: "takip",    aliases: ["takip-durum"],                      usage: "",                   description: "Kullanıcı takip ve telefon arama durumunu gösterir." }
];

// Türkçe karakterleri ve büyük/küçük harf farkını yok sayarak karşılaştırma için
function normalizeTr(s) {
    return String(s || "")
        .toLocaleLowerCase("tr")
        .replace(/ç/g, "c").replace(/ş/g, "s").replace(/ğ/g, "g")
        .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ü/g, "u");
}

// Yazılan kelime tam bir komut/takma ad mı? (".çal", ".cal", ".p" ...)
function isKnownDotCommand(token) {
    const t = normalizeTr(token);
    if (!t) return false;
    return dotCommands.some(c => normalizeTr(c.name) === t || c.aliases.some(a => normalizeTr(a) === t));
}

// Sadece harf/rakam içeren ("..." gibi olmayan) kelimeler için ön ek eşleşmesi. Boş kelime = hepsi.
function matchDotCommands(token) {
    if (!/^[\p{L}\p{N}_-]*$/u.test(token || "")) return null;
    const t = normalizeTr(token);
    if (!t) return dotCommands;
    const found = dotCommands.filter(c =>
        normalizeTr(c.name).startsWith(t) ||
        (t.length >= 2 && c.aliases.some(a => normalizeTr(a).startsWith(t)))
    );
    return found.length ? found : null;
}

// Resimdeki "/. İLE EŞLEŞEN KOMUTLAR" tasarımına benzer embed
function buildDotSuggestionEmbed(token, matches) {
    const lines = matches.map(c => {
        const usage = c.usage ? ` \`${c.usage}\`` : "";
        return `**.${c.name}**${usage}\n${c.description}`;
    });
    return new EmbedBuilder()
        .setColor("#2B2D31")
        .setAuthor({ name: `.${token || ""} İLE EŞLEŞEN KOMUTLAR`.toLocaleUpperCase("tr") })
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: "Komutu yazıp göndermen yeterli • Canlı liste için / yaz" });
}

module.exports = {
    slashCommands, interactionToCommand, registerSlashCommands, registerForGuild,
    dotCommands, isKnownDotCommand, matchDotCommands, buildDotSuggestionEmbed
};
