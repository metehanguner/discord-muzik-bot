const fs   = require("fs");
const path = require("path");
const sodium = require("libsodium-wrappers");

const {
    Client, GatewayIntentBits, ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder, Events, MessageFlags
} = require("discord.js");

const { AudioPlayerStatus } = require("@discordjs/voice");

// ============================================================
//  MODÜL İTHALATLARI (Clean Architecture)
// ============================================================
const { DISCORD_TOKEN, COOKIES_PATH, CHANNELS_FILE, CRASH_FILE } = require("./src/config");
const { logger, extractUserInfo, notifyRequesterAboutError } = require("./src/logger");
const { getDB, saveToDB, removeFromDB, saveActiveChannel, getActiveChannels } = require("./src/db");
const { ensureYtDlp, resolve } = require("./src/resolver");
const { managers, getManager, setDiscordClient } = require("./src/player");
const { showFavoritesMenu, showPopularMenu, showQueueMenu, showHelpMenu } = require("./src/menus");

logger("═══════════════════════════════════════════════════════", "SYSTEM");
logger(`Bot sureci baslatildi | PID: ${process.pid} | Node: ${process.version}`, "SYSTEM");
logger(`Platform: ${process.platform} | Arch: ${process.arch} | CPU Onceligi: YUKSEK (ABOVE_NORMAL)`, "SYSTEM");
logger("═══════════════════════════════════════════════════════", "SYSTEM");

// ============================================================
//  DISCORD CLIENT
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Player modülüne client referansını bağla
setDiscordClient(client);

// ============================================================
//  BAŞLANGIÇ OLAYI (ClientReady)
// ============================================================
client.once(Events.ClientReady, async () => {
    logger(`[GATEWAY] Discord Gateway baglantisi kuruldu.`, "SYSTEM");
    await sodium.ready;
    logger(`[SODIUM] libsodium hazir.`, "DEBUG");
    await ensureYtDlp();
    logger(`[STARTUP] ${client.user.tag} basariyla giris yapti ve aktif!`, "SYSTEM");
    logger(`[STARTUP] Sunucu sayisi: ${client.guilds.cache.size}`, "INFO");
    logger(`[STARTUP] Cookies: ${fs.existsSync(COOKIES_PATH) ? "VAR" : "YOK"}`, "INFO");

    // Otomatik Kurtarma Bildirimi Kontrolü
    if (fs.existsSync(CRASH_FILE)) {
        try {
            const crashInfo = JSON.parse(fs.readFileSync(CRASH_FILE, "utf8"));
            logger(`[RECOVERY] Beklenmedik çökme sonrası otomatik kurtarma devrede! Neden: ${crashInfo.reason || "Bilinmiyor"}`, "SYSTEM");
            fs.unlinkSync(CRASH_FILE);
            const chs = getActiveChannels();
            const shortReason = (crashInfo.reason || "").split("\n")[0].substring(0, 95);
            for (const [guildId, chId] of Object.entries(chs)) {
                const channel = client.channels.cache.get(chId);
                if (channel && channel.isTextBased()) {
                    const recoverEmbed = new EmbedBuilder()
                        .setColor("#00ffcc")
                        .setAuthor({ name: "🔄 OTOMATİK KURTARMA MOTORU AKTİF" })
                        .setTitle("⚡ Bot Beklenmedik Bir Hatadan Kurtarıldı ve Yeniden Başlatıldı")
                        .setDescription(`Sistem çökmeyi otomatik olarak algılayıp onardı ve oturumu kesintisiz şekilde yeniden başlattı.\n${shortReason ? `\n🔍 **Hata Özeti:** \`${shortReason}\`\n` : ""}\nMüzik dinlemeye devam etmek için **.çal** komutunu kullanabilirsiniz.`)
                        .setFooter({ text: "🛡️ 7/24 Kesintisiz Çökme Koruması Devrede" })
                        .setTimestamp();
                    channel.send({ embeds: [recoverEmbed] }).catch(() => {});
                }
            }
        } catch (e) {
            logger(`[RECOVERY] Kurtarma bildirimi gonderilirken hata: ${e.message}`, "ERROR");
        }
    }
});

// ============================================================
//  MESAJ KOMUTLARI (MessageCreate)
// ============================================================
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.guild) return;

    let content = msg.content.trim();
    let cmd, args;

    if (content.startsWith(".")) {
        const rawArgs = content.slice(1).trim().split(/\s+/);
        cmd = rawArgs[0].toLowerCase();
        args = rawArgs.slice(1);
    } else if (content.toLowerCase().startsWith("favori ekle") || content.toLowerCase().startsWith("favoriekle")) {
        cmd = "favori";
        args = ["ekle", ...content.split(/\s+/).slice(2)];
    } else {
        return;
    }

    const manager = getManager(msg.guild.id);
    manager.textChannel = msg.channel;
    saveActiveChannel(msg.guild.id, msg.channel.id);
    setTimeout(() => msg.delete().catch(() => {}), 2000);
    logger(`[CMD] .${cmd}${args.length ? " " + args.join(" ") : ""} | Kullanici: ${msg.author.tag} (${msg.author.id}) | Sunucu: ${msg.guild.name} (${msg.guild.id}) | Kanal: #${msg.channel.name}`, "INFO");

    // --- .yardım / .help / .komutlar ---
    if (cmd === "yardım" || cmd === "yardim" || cmd === "help" || cmd === "komutlar") {
        return showHelpMenu(msg.channel);
    }

    // --- .çal / .p ---
    if (cmd === "çal" || cmd === "cal" || cmd === "p" || cmd === "play") {
        const query = args.join(" ");
        if (!query) {
            logger(`[CMD] .cal cagirildi ama sorgu bos. Kullanici: ${msg.author.tag}`, "WARNING");
            return msg.channel.send("⚠️ Lütfen çalmak istediğiniz şarkının adını veya linkini belirtin! (Örn: `.çal Tarkan Geççek`)").then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
        }
        if (!msg.member.voice || !msg.member.voice.channel) {
            logger(`[CMD] Kullanici ses kanalinda degil: ${msg.author.tag}`, "WARNING");
            return msg.channel.send("❌ Ses kanalında değilsin! Lütfen önce bir ses kanalına katılın.").then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
        }
        logger(`[CMD] Arama baslatildi: "${query}" | Isteyen: ${msg.author.tag}`, "INFO");
        const status = await msg.channel.send("⏳ **Arama başlatıldı...**");
        try {
            const res = await resolve(query, msg.author);
            const activeManager = getManager(msg.guild.id);
            await activeManager.join(msg.member.voice.channel);
            activeManager.textChannel = msg.channel;
            saveActiveChannel(msg.guild.id, msg.channel.id);

            if (res.type === "playlist") {
                const wasIdle = activeManager.player.state.status === AudioPlayerStatus.Idle && !activeManager.state.paused && !activeManager.current;
                for (const t of res.tracks) activeManager.queue.push(t);
                activeManager.clearIdleTimer();
                logger(`[CMD] Playlist yuklendi (atomik): ${res.tracks.length} parca | wasIdle: ${wasIdle} | Sunucu: ${msg.guild.id}`, "INFO");
                if (wasIdle) {
                    await activeManager.next();
                } else if (activeManager.current) {
                    await activeManager.updateUI(activeManager.current, "update");
                }
                status.edit(`✅ **${res.title}** (${res.tracks.length} parça) eklendi.`).catch(() => {});
                setTimeout(() => status.delete().catch(() => {}), 7000);
            } else if (Array.isArray(res) && res.length > 1) {
                logger(`[CMD] Arama menusu gosteriliyor: ${res.length} sonuc | Kullanici: ${msg.author.tag}`, "INFO");
                const embed = new EmbedBuilder()
                    .setColor("#ff00ff")
                    .setTitle("『 🎵 AdMeliora Music Bot 』")
                    .setDescription(res.map((t, i) => `**${i + 1}.** [${t.title.substring(0, 75)}...](${t.url})\n└ 🕒 \`${t.duration}\``).join("\n\n"))
                    .setFooter({ text: "⏳ Kalan Süre: 40 sn  " + String.fromCodePoint(0x2588).repeat(10) + "  •  Alttaki butonlardan parçayı seçin" });
                const rows = [];
                const row1 = new ActionRowBuilder();
                res.slice(0, 5).forEach((t, i) => {
                    row1.addComponents(new ButtonBuilder().setCustomId(`search_btn_${i}`).setLabel(`${i + 1}`).setStyle(ButtonStyle.Primary));
                });
                rows.push(row1);
                if (res.length > 5) {
                    const row2 = new ActionRowBuilder();
                    res.slice(5, 10).forEach((t, i) => {
                        row2.addComponents(new ButtonBuilder().setCustomId(`search_btn_${i + 5}`).setLabel(`${i + 6}`).setStyle(ButtonStyle.Primary));
                    });
                    rows.push(row2);
                }
                const sMsg = await status.edit({ content: null, embeds: [embed], components: rows });
                const col  = sMsg.createMessageComponentCollector({ filter: i => i.user.id === msg.author.id, time: 40000 });
                let _secsLeft = 40;
                const _cdInterval = setInterval(() => {
                    _secsLeft -= 5;
                    if (_secsLeft <= 0) { clearInterval(_cdInterval); return; }
                    const filled = Math.round((_secsLeft / 40) * 10);
                    const bar = String.fromCodePoint(0x2588).repeat(filled) + String.fromCodePoint(0x2591).repeat(10 - filled);
                    embed.setFooter({ text: "⏳ Kalan Süre: " + _secsLeft + " sn  " + bar + "  •  Alttaki butonlardan parçayı seçin" });
                    sMsg.edit({ content: null, embeds: [embed], components: rows }).catch(() => {});
                }, 5000);
                col.on("collect", async i => {
                    clearInterval(_cdInterval);
                    const idx = parseInt(i.customId.replace("search_btn_", ""));
                    const selected = res[idx];
                    if (!selected) return;
                    selected.requestedBy = i.user.username;
                    selected.requestedById = i.user.id;
                    logger(`[CMD] Arama butonu secimi: "${selected.title}" (index: ${idx}) | Kullanici: ${i.user.tag}`, "INFO");
                    await i.update({ content: `⏳ Seçildi: **${selected.title}** • Ses akışı hazırlanıyor...`, embeds: [], components: [] }).catch(() => {});
                    await manager.add(selected);
                    setTimeout(() => sMsg.delete().catch(() => {}), 3000);
                    col.stop();
                });
                col.on("end", (collected, reason) => {
                    clearInterval(_cdInterval);
                    if (reason === "time") {
                        logger(`[CMD] Arama menusu zaman asimina ugradi. Kullanici: ${msg.author.tag}`, "DEBUG");
                        sMsg.delete().catch(() => {});
                    }
                });
            } else if (res[0]) {
                logger(`[CMD] Tek sonuc, dogrudan ekleniyor: "${res[0].title}"`, "INFO");
                const activeManager = getManager(msg.guild.id);
                await activeManager.add(res[0]);
                if (status) status.delete().catch(() => {});
            }
        } catch (e) {
            logger(`[CMD] .cal hatasi: ${e.message} | Sorgu: "${query}" | Kullanici: ${msg.author.tag}`, "ERROR");
            notifyRequesterAboutError(client, { title: query, requestedById: msg.author.id }, e, "Arama / Çözümleme Hatası");
            if (status) status.edit("❌ Hata: Şarkı bulunamadı veya oynatılamıyor.").then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        }
    }

    // --- .kuyruk / .queue / .q ---
    else if (cmd === "kuyruk" || cmd === "queue" || cmd === "q") {
        return showQueueMenu(msg.channel, msg.author, msg.guild);
    }

    // --- .karıştır / .shuffle ---
    else if (cmd === "karıştır" || cmd === "karistir" || cmd === "shuffle") {
        const ok = manager.shuffle();
        if (ok) {
            msg.channel.send(`🔀 Kuyruktaki **${manager.queue.length}** şarkı rastgele karıştırıldı.`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
            if (manager.current) await manager.updateUI(manager.current, "update");
        } else {
            msg.channel.send("⚠️ Karıştırmak için sırada en az 2 şarkı olmalı.").then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
        }
    }

    // --- .temizle / .clear ---
    else if (cmd === "temizle" || cmd === "clear") {
        const count = manager.clearQueue();
        msg.channel.send(`🗑️ Kuyruktaki **${count}** şarkı temizlendi.`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
        if (manager.current) await manager.updateUI(manager.current, "update");
    }

    // --- .şarkı / .np / .nowplaying ---
    else if (cmd === "şarkı" || cmd === "sarki" || cmd === "np" || cmd === "nowplaying") {
        if (!manager.current) {
            return msg.channel.send("📭 Şu anda çalan bir şarkı yok.").then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
        }
        await manager.updateUI(manager.current, "new");
    }

    // --- .favori / .fav / .favoriekle ---
    else if (cmd === "favori" || cmd === "fav" || cmd === "favoriekle" || cmd === "favekle") {
        const subCmd = (args[0] || "").toLowerCase();

        // 1) .favori sil <sıra_no>
        if (subCmd === "sil" || subCmd === "çıkar" || subCmd === "cikar" || subCmd === "remove") {
            const num = parseInt(args[1]);
            const targetIndex = num - 1;
            const db = getDB();
            const favs = (db.users && db.users[msg.author.id]) || [];
            if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= favs.length) {
                return msg.channel.send(`⚠️ Geçerli bir sıra numarası girmelisin! (Örn: \`.favori sil 1\`). Toplam şarkın: \`${favs.length}\``)
                    .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            }
            const removed = removeFromDB(msg.author.id, targetIndex);
            if (removed) {
                return msg.channel.send(`🗑️ **${removed.title}** favorilerinden silindi. Kalan şarkı sayın: \`${favs.length - 1}\``)
                    .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            }
        }

        // 2) .favori ekle <şarkı adı veya linki>
        else if (subCmd === "ekle" || subCmd === "add" || args.length > 0) {
            const query = (subCmd === "ekle" || subCmd === "add") ? args.slice(1).join(" ") : args.join(" ");
            let songToSave = null;

            if (query) {
                const sMsg = await msg.channel.send("🔍 Şarkı aranıyor...");
                try {
                    const res = await resolve(query, msg.author);
                    songToSave = Array.isArray(res) ? res[0] : (res.tracks ? res.tracks[0] : null);
                    sMsg.delete().catch(() => {});
                } catch (e) {
                    return sMsg.edit("❌ Şarkı bulunamadı.").then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
                }
            } else if (manager.current) {
                songToSave = manager.current;
            } else {
                return msg.channel.send("⚠️ Favoriye eklemek için çalan bir şarkı olmalı veya isim yazmalısın! (Örn: `.favori ekle Tarkan Kuzu Kuzu`)")
                    .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            }

            if (songToSave) {
                const success = saveToDB(msg.author.id, msg.guild.id, songToSave);
                if (success) {
                    const db = getDB();
                    const totalFavs = (db.users && db.users[msg.author.id] ? db.users[msg.author.id].length : 1);
                    return msg.channel.send(`⭐ **${songToSave.title}** favorilerine eklendi! Toplam favori şarkın: \`${totalFavs}\``)
                        .then(m => setTimeout(() => m.delete().catch(() => {}), 6000));
                } else {
                    return msg.channel.send(`ℹ️ Bu şarkı zaten favorilerinde ekli: **${songToSave.title}**`)
                        .then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
                }
            }
        }

        // 3) Parametresiz .favori -> Doğrudan favori listesini aç
        else {
            return showFavoritesMenu(msg.channel, msg.author, msg.guild);
        }
    }

    // --- .listem ---
    else if (cmd === "listem") {
        return showFavoritesMenu(msg.channel, msg.author, msg.guild);
    }

    // --- .popüler / .top ---
    else if (cmd === "popüler" || cmd === "populer" || cmd === "top") {
        return showPopularMenu(msg.channel, msg.author, msg.guild);
    }

    // --- .duraklat / .devam ---
    else if (cmd === "duraklat" || cmd === "devam") {
        if (!manager.current) {
            logger(`[CMD] .duraklat/.devam cagirildi ama calan sarki yok. Kullanici: ${msg.author.tag}`, "WARNING");
            return;
        }
        await manager.pause();
    }

    // --- .ses ---
    else if (cmd === "ses" || cmd === "volume") {
        const vol = parseInt(args[0]);
        if (isNaN(vol) || vol < 0 || vol > 200) {
            logger(`[CMD] .ses gecersiz deger: "${args[0]}" | Kullanici: ${msg.author.tag}`, "WARNING");
            return msg.channel.send("⚠️ Ses seviyesi 0 ile 200 arasında bir sayı olmalıdır. (Örn: `.ses 70`)").then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
        }
        manager.setVolume(vol);
        msg.channel.send(`🔊 Ses seviyesi **%${vol}** olarak ayarlandı.`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
        if (manager.current) await manager.updateUI(manager.current, "update");
    }

    // --- .geç ---
    else if (cmd === "geç" || cmd === "gec" || cmd === "skip") {
        if (!manager.current) {
            logger(`[CMD] .gec cagirildi ama calan sarki yok. Kullanici: ${msg.author.tag}`, "WARNING");
        } else {
            await manager.skip();
        }
    }

    // --- .durdur ---
    else if (cmd === "durdur" || cmd === "stop") {
        logger(`[CMD] .durdur -> Oturum sonlandiriliyor. Kullanici: ${msg.author.tag} | Sunucu: ${msg.guild.id}`, "INFO");
        manager.destroy();
        msg.channel.send("⏹️ Müzik durduruldu ve ses kanalından ayrıldı.").then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
    }
});

// ============================================================
//  BUTON ETKİLEŞİMLERİ (InteractionCreate)
// ============================================================
client.on(Events.InteractionCreate, async (i) => {
    if (!i.isButton()) return;
    // Sadece ana oynatıcı butonları ("m_" ile başlayanlar) burada işlenir.
    // Menü butonları (top_play_all, fav_play_all, search_btn_*, queue_*) kendi collector'larında işlenir.
    if (!i.customId.startsWith("m_")) return;

    logger(`[BUTTON] Tiklandi: "${i.customId}" | Kullanici: ${i.user.tag} (${i.user.id}) | Sunucu: ${i.guildId}`, "INFO");

    // 1) Favorilerim butonuna basıldıysa
    if (i.customId === "m_fav_list") {
        await i.deferUpdate().catch(() => {});
        return showFavoritesMenu(i.channel, i.user, i.guild);
    }

    // 2) Top 20 Popüler butonuna basıldıysa
    if (i.customId === "m_top_list") {
        await i.deferUpdate().catch(() => {});
        return showPopularMenu(i.channel, i.user, i.guild);
    }

    const m = managers.get(i.guildId);

    // 3) m_fav (Şarkı çalarken ⭐ butonu veya çalmadığında ⭐ butonu)
    if (i.customId === "m_fav") {
        if (!m || !m.current) {
            // Şarkı çalmıyorsa hata vermek yerine doğrudan favori listesini aç
            await i.deferUpdate().catch(() => {});
            return showFavoritesMenu(i.channel, i.user, i.guild);
        }
        const success = saveToDB(i.user.id, i.guildId, m.current);
        if (success) {
            const db        = getDB();
            const favCount  = (db.users && db.users[i.user.id] ? db.users[i.user.id].length : 1);
            const guildFavs = (db.guilds && db.guilds[i.guildId]) || {};
            const songVote  = guildFavs[m.current.url] ? guildFavs[m.current.url].count : 1;
            const notifyEmbed = new EmbedBuilder()
                .setColor("#ff00ff")
                .setDescription(`# ⭐ MÜZİK ARŞİVİNE EKLENDİ\n### 『 ${m.current.title.substring(0, 100)} 』\n\n✅ **Kütüphanendeki Toplam Parça:** \`${favCount}\`\n🔥 **Sunucuda Dinlenme:** \`${songVote}\`\n\n━━━━━━━━━━━━━━━━━━━━━━\n## 🚀 NASIL KULLANIRIM?\n🔹 **.listem** ➔ Kendi favori listeni açar.\n🔹 **.popüler** ➔ Sunucunun en iyilerini gösterir.\n━━━━━━━━━━━━━━━━━━━━━━`)
                .setTimestamp();
            const dmResult = await i.user.send({ embeds: [notifyEmbed] }).catch(() => null);
            if (!dmResult) logger(`[BUTTON] DM gonderilemedi: ${i.user.tag}`, "WARNING");
            await m.setTempFooter("⭐ Şarkı favorilerine eklendi!");
            return i.reply({ content: `⭐ **${m.current.title}** kütüphanene eklendi! Detaylı istatistikler DM kutuna gönderildi.`, flags: [MessageFlags.Ephemeral] });
        } else {
            return i.reply({ content: `⚠️ **${m.current.title}** zaten kütüphanende mevcut.`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // Diğer oturum butonları (m_pause, m_skip, m_stop, m_loop)
    if (!m || !m.current) {
        logger(`[BUTTON] Aktif oturum yok veya sarki calmiyor. Kullanici: ${i.user.tag} | Sunucu: ${i.guildId}`, "WARNING");
        return i.reply({ content: "❌ Şu an aktif bir müzik oturumu yok.", flags: [MessageFlags.Ephemeral] }).catch(() => {});
    }

    if (["m_pause", "m_skip", "m_stop", "m_loop"].includes(i.customId)) {
        await i.deferUpdate().catch(() => {});
    }
    if (i.customId === "m_pause") {
        await m.pause();
    } else if (i.customId === "m_skip") {
        await m.skip();
    } else if (i.customId === "m_stop") {
        logger(`[BUTTON] Stop -> Oturum sonlandiriliyor. Kullanici: ${i.user.tag} | Sunucu: ${i.guildId}`, "INFO");
        m.destroy();
    } else if (i.customId === "m_loop") {
        m.state.loop = !m.state.loop;
        logger(`[BUTTON] Loop -> ${m.state.loop ? "Acik" : "Kapali"} | Kullanici: ${i.user.tag} | Sunucu: ${i.guildId}`, "INFO");
        if (m.current) await m.updateUI(m.current, "update");
    }
});

// ============================================================
//  SES KANALI DURUM GÜNCELLEME (VoiceStateUpdate)
// ============================================================
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guild = oldState.guild || newState.guild;
    if (!guild) return;
    const manager = managers.get(guild.id);
    if (!manager || !manager.connection) return;
    const botVoiceChannelId = manager.connection.joinConfig && manager.connection.joinConfig.channelId;
    if (!botVoiceChannelId) return;
    const member     = oldState.member || newState.member;
    const memberName = member && member.user ? member.user.tag : "Bilinmeyen";
    const oldCh      = oldState.channel ? oldState.channel.name : "—";
    const newCh      = newState.channel ? newState.channel.name : "—";
    if (oldState.member && oldState.member.id === client.user.id && !newState.channelId) {
        logger(`[VOICE_UPDATE] Bot ses kanalından atıldı veya ayrildi! Sunucu: ${guild.id}`, "WARNING");
        manager.destroy();
        return;
    }
    if (member && member.id !== client.user.id) {
        logger(`[VOICE_UPDATE] Kullanici hareketi: ${memberName} | ${oldCh} -> ${newCh} | Sunucu: ${guild.name}`, "DEBUG");
    }
    const botChannel = guild.channels.cache.get(botVoiceChannelId);
    if (!botChannel || !botChannel.isVoiceBased()) return;
    const humanCount = botChannel.members.filter(m => !m.user.bot).size;
    logger(`[VOICE_UPDATE] Kanalda insan sayisi: ${humanCount} | Kanal: ${botChannel.name} | Sunucu: ${guild.id}`, "DEBUG");
    if (humanCount === 0) {
        if (!manager.idleTimer) {
            logger(`[VOICE_UPDATE] Kanalda kimse kalmadi, 30s bosta sayaci baslatildi. Sunucu: ${guild.id}`, "INFO");
            manager.startIdleTimer(30000, "Ses kanalında kimse kalmadığı için");
        }
    } else {
        if (manager.current || manager.queue.length > 0) {
            manager.clearIdleTimer();
        }
    }
});

// ============================================================
//  GÜVENLİ KAPATMA (SHUTDOWN)
// ============================================================
const shutdown = async () => {
    logger("[SHUTDOWN] Kapatma sinyali alindi. Temiz kapatma baslatiliyor...", "SYSTEM");
    const vedaPromises = [];
    for (const [guildId, manager] of managers) {
        logger(`[SHUTDOWN] Sunucu temizleniyor: ${guildId}`, "INFO");
        if (manager.textChannel) {
            const p = manager.textChannel
                .send("🛑 **Bot sunucu tarafından kapatıldı. Müzik durduruldu.**")
                .catch(() => null)
                .finally(() => { try { manager.destroy(); } catch (_) {} });
            vedaPromises.push(p);
        } else {
            try { manager.destroy(); } catch (_) {}
        }
    }
    await Promise.race([Promise.all(vedaPromises), new Promise(r => setTimeout(r, 2000))]);
    client.destroy();
    logger("[SHUTDOWN] Discord baglantisi kesildi. Bot guvenli sekilde kapatildi.", "SYSTEM");
    process.exit(0);
};

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);

// ============================================================
//  GLOBAL HATA YÖNETİMİ & ÇÖKME KORUMASI
// ============================================================
process.on("unhandledRejection", (reason) => {
    const errorDetails = reason && reason.stack ? reason.stack : String(reason);
    logger(`[CRITICAL] Yakalanmamis Promise Hatasi: ${errorDetails}`, "ERROR");
});

process.on("uncaughtException", (err) => {
    const errorDetails = err && err.stack ? err.stack : String(err);
    logger(`[FATAL] Beklenmedik Kritik Hata (Çökme): ${errorDetails}`, "FATAL");
    try {
        fs.writeFileSync(CRASH_FILE, JSON.stringify({
            reason: errorDetails,
            time: new Date().toISOString(),
            pid: process.pid
        }, null, 2), "utf8");
        fs.writeFileSync(path.join(__dirname, "crash_reason.txt"), errorDetails, "utf8");
    } catch (_) {}
    process.exit(1);
});

// ============================================================
//  BAŞLAT
// ============================================================
client.login(DISCORD_TOKEN);