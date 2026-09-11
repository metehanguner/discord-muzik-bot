const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require("discord.js");

const { VoiceConnectionStatus } = require("@discordjs/voice");
const { getDB, saveActiveChannel } = require("./db");
const { logger, formatMarkdownTitle } = require("./logger");
const { getManager } = require("./player");

// ============================================================
//  KİŞİSEL FAVORİLER MENÜSÜ (.listem)
// ============================================================
async function showFavoritesMenu(channel, user, guild) {
    const db = getDB();
    const favs = (db.users && db.users[user.id]) || [];
    logger(`[FAV_MENU] Kullanici: ${user.tag} (${user.id}) | Favori sayisi: ${favs.length}`, "INFO");
    if (favs.length === 0) {
        return channel.send("⭐ Listen henüz boş.\n💡 Şarkı çalarken ⭐ butonuna basabilir veya `.favori ekle <şarkı>` yazarak ekleyebilirsin!")
            .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }

    const displayFavs = favs.slice(0, 20);
    const desc = displayFavs.map((s, i) => `**${i + 1}.** [${formatMarkdownTitle(s.title, 55)}](${s.url}) \`[${s.duration || "—"}]\``).join("\n");
    const totalNote = favs.length > 20 ? `\n\n📌 *Kütüphanende toplam **${favs.length}** şarkı var. İlk 20 şarkı gösteriliyor.*` : "";

    const embed = new EmbedBuilder()
        .setColor("#ff00ff")
        .setTitle("『 ⭐ ＦＡＶＯＲİＬＥＲİＭ  (ＴＯＰ  ２０) 』")
        .setDescription(desc + totalNote)
        .setFooter({ text: "💡 Parça seçip çalabilir veya 'Hepsini Oynat'a basabilirsiniz." });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("fav_select")
        .setPlaceholder("🎶 Favorilerinden parça seç...")
        .addOptions(displayFavs.map((s, i) => ({
            label: `${i + 1}. ${formatMarkdownTitle(s.title, 90)}`,
            value: i.toString(),
            emoji: "⭐"
        })));

    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("fav_play_all")
            .setLabel(`Hepsini Oynat (${favs.length} Parça)`)
            .setStyle(ButtonStyle.Success)
            .setEmoji("▶️")
    );
    const row = new ActionRowBuilder().addComponents(selectMenu);
    const sMsg = await channel.send({ embeds: [embed], components: [row, btnRow] });
    const manager = getManager(guild.id);
    const col  = sMsg.createMessageComponentCollector({ filter: i => i.user.id === user.id, time: 45000 });

    col.on("collect", async i => {
        const voiceChannel = i.member?.voice?.channel;
        if (!voiceChannel) {
            return i.reply({ content: "⚠️ Bir ses kanalında olmalısınız!", ephemeral: true }).catch(() => {});
        }
        manager.textChannel = channel;
        saveActiveChannel(guild.id, channel.id);
        if (!manager.connection || manager.connection.state.status === VoiceConnectionStatus.Destroyed) {
            await manager.join(voiceChannel);
        }
        if (i.customId === "fav_play_all") {
            logger(`[CMD] .listem -> Hepsini Oynat (${favs.length} parca) | Kullanici: ${i.user.tag}`, "INFO");
            await i.update({ content: `⭐ Tüm favori listen (**${favs.length}** parça) sıraya eklendi!`, embeds: [], components: [] }).catch(() => {});
            for (const s of favs) {
                s.requestedBy = i.user.username;
                s.requestedById = i.user.id;
                await manager.add(s, true);
            }
            if (manager.current) await manager.updateUI(manager.current, "new");
        } else {
            const idx = parseInt(i.values[0]);
            const selectedFav = displayFavs[idx];
            if (selectedFav) {
                selectedFav.requestedBy = i.user.username;
                selectedFav.requestedById = i.user.id;
                logger(`[CMD] .listem -> Secildi: "${selectedFav.title}" | Kullanici: ${i.user.tag}`, "INFO");
                await i.update({ content: `⏳ Seçildi: **${selectedFav.title}** • Ses akışı hazırlanıyor...`, embeds: [], components: [] }).catch(() => {});
                await manager.add(selectedFav);
                if (manager.current) await manager.updateUI(manager.current, "new");
            }
        }
        setTimeout(() => sMsg.delete().catch(() => {}), 4000);
        col.stop();
    });
    col.on("end", (collected, reason) => { if (reason === "time") sMsg.delete().catch(() => {}); });
}

// ============================================================
//  SUNUCU EN ÇOK ÇALINANLAR MENÜSÜ (.popüler)
// ============================================================
async function showPopularMenu(channel, user, guild) {
    const db      = getDB();
    const gFavs   = (db.guilds && db.guilds[guild.id]) || {};
    const sorted  = Object.values(gFavs).sort((a, b) => b.count - a.count).slice(0, 20);
    logger(`[POPULAR_MENU] Sunucu: ${guild.id} | Sirali parca sayisi: ${sorted.length}`, "INFO");
    if (sorted.length === 0) {
        return channel.send("📈 Sunucuda henüz dinlenmiş popüler şarkı kaydı yok.").then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
    }

    const embed = new EmbedBuilder()
        .setColor("#00ffff")
        .setTitle("『 🔥 ＳＵＮＵＣＵ  ＴＯＰ  ２０ 』")
        .setDescription(
            sorted.map((s, i) => {
                const badge = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
                return `${badge} [${formatMarkdownTitle(s.title, 50)}](${s.url}) \`(${s.count} ▶ Çalındı)\``;
            }).join("\n")
        )
        .setFooter({ text: "💡 Çalmak için aşağıdaki menüden parça seçin veya 'Top 20 Oynat'a basın." });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("top_select")
        .setPlaceholder("🔥 Popülerlerden birini çal...")
        .addOptions(sorted.map((s, i) => ({
            label: `${i + 1}. ${formatMarkdownTitle(s.title, 90)}`,
            description: `${s.count} kez çalındı`,
            value: i.toString(),
            emoji: "🔥"
        })));

    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("top_play_all")
            .setLabel(`Top ${sorted.length} Oynat`)
            .setStyle(ButtonStyle.Success)
            .setEmoji("🔥")
    );
    const row = new ActionRowBuilder().addComponents(selectMenu);
    const sMsg = await channel.send({ embeds: [embed], components: [row, btnRow] });
    const manager = getManager(guild.id);
    const col  = sMsg.createMessageComponentCollector({ filter: i => i.user.id === user.id, time: 45000 });

    col.on("collect", async i => {
        const voiceChannel = i.member?.voice?.channel;
        if (!voiceChannel) {
            return i.reply({ content: "⚠️ Bir ses kanalında olmalısınız!", ephemeral: true }).catch(() => {});
        }
        manager.textChannel = channel;
        saveActiveChannel(guild.id, channel.id);
        if (!manager.connection || manager.connection.state.status === VoiceConnectionStatus.Destroyed) {
            await manager.join(voiceChannel);
        }
        if (i.customId === "top_play_all") {
            logger(`[CMD] .populer -> Top ${sorted.length} Oynat | Kullanici: ${i.user.tag}`, "INFO");
            await i.update({ content: `🔥 Top ${sorted.length} parça sıraya eklendi!`, embeds: [], components: [] }).catch(() => {});
            for (const s of sorted) {
                s.requestedBy = i.user.username;
                s.requestedById = i.user.id;
                await manager.add(s, true);
            }
            if (manager.current) await manager.updateUI(manager.current, "new");
        } else {
            const idx = parseInt(i.values[0]);
            const selectedTop = sorted[idx];
            if (selectedTop) {
                selectedTop.requestedBy = i.user.username;
                selectedTop.requestedById = i.user.id;
                logger(`[CMD] .populer -> Secildi: "${selectedTop.title}" | Kullanici: ${i.user.tag}`, "INFO");
                await i.update({ content: `⏳ Seçildi: **${selectedTop.title}** • Ses akışı hazırlanıyor...`, embeds: [], components: [] }).catch(() => {});
                await manager.add(selectedTop);
                if (manager.current) await manager.updateUI(manager.current, "new");
            }
        }
        setTimeout(() => sMsg.delete().catch(() => {}), 4000);
        col.stop();
    });
    col.on("end", (collected, reason) => { if (reason === "time") sMsg.delete().catch(() => {}); });
}

// ============================================================
//  KUYRUK LİSTESİ MENÜSÜ (.kuyruk / .queue)
// ============================================================
async function showQueueMenu(channel, user, guild) {
    const manager = getManager(guild.id);
    if (!manager.current && manager.queue.length === 0) {
        return channel.send("📭 Şu anda çalınan bir şarkı veya sırada bekleyen parça yok.")
            .then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
    }

    const currentTitle = manager.current ? `▶️ **Şu An Çalıyor:** [${formatMarkdownTitle(manager.current.title, 55)}](${manager.current.url}) \`[${manager.current.duration}]\` *(İsteyen: ${manager.current.requestedBy})*\n\n` : "";
    const queueList = manager.queue.slice(0, 15);
    const queueDesc = queueList.length > 0
        ? queueList.map((s, i) => `\`${i + 1}.\` [${formatMarkdownTitle(s.title, 48)}](${s.url}) \`[${s.duration}]\` *(İsteyen: ${s.requestedBy})*`).join("\n")
        : "*Sırada bekleyen başka şarkı yok.*";

    const moreText = manager.queue.length > 15 ? `\n\n📌 *Ve **${manager.queue.length - 15}** parça daha sırada bekliyor...*` : "";

    const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("『 📋 ＯＹＮＡＴＭＡ  ＫＵＹＲＵĞＵ 』")
        .setDescription(currentTitle + `**Sıradaki Parçalar (${manager.queue.length}):**\n` + queueDesc + moreText)
        .setFooter({ text: `🎧 Toplam ${manager.queue.length + (manager.current ? 1 : 0)} parça • AdMeliora Music` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("queue_shuffle").setLabel("Karıştır").setEmoji("🔀").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("queue_clear").setLabel("Kuyruğu Temizle").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("queue_close").setLabel("Kapat").setEmoji("✖️").setStyle(ButtonStyle.Secondary)
    );

    const qMsg = await channel.send({ embeds: [embed], components: [row] });
    const col = qMsg.createMessageComponentCollector({ filter: i => i.user.id === user.id, time: 30000 });

    col.on("collect", async i => {
        if (i.customId === "queue_shuffle") {
            const ok = manager.shuffle();
            if (ok) {
                await i.reply({ content: "🔀 Sıradaki şarkılar rastgele karıştırıldı!", ephemeral: true });
                if (manager.current) await manager.updateUI(manager.current, "update");
            } else {
                await i.reply({ content: "⚠️ Karıştırmak için sırada en az 2 şarkı olmalı.", ephemeral: true });
            }
        } else if (i.customId === "queue_clear") {
            const count = manager.clearQueue();
            await i.reply({ content: `🗑️ Kuyruktaki **${count}** parça temizlendi.`, ephemeral: true });
            if (manager.current) await manager.updateUI(manager.current, "update");
        } else if (i.customId === "queue_close") {
            await i.deferUpdate().catch(() => {});
            qMsg.delete().catch(() => {});
            col.stop();
            return;
        }
        setTimeout(() => qMsg.delete().catch(() => {}), 4000);
        col.stop();
    });

    col.on("end", (c, reason) => { if (reason === "time") qMsg.delete().catch(() => {}); });
}

// ============================================================
//  YARDIM VE KOMUTLAR MENÜSÜ (.yardım / .help)
// ============================================================
async function showHelpMenu(channel) {
    const embed = new EmbedBuilder()
        .setColor("#ff00ff")
        .setTitle("『 🎶 AdMeliora Music Bot • Komut Rehberi 』")
        .setDescription("7/24 Kesintisiz Yüksek Çözünürlüklü Müzik Deneyimi!\nAşağıdaki komutları kullanarak botu kolayca yönetebilirsiniz:\n\n" +
            "### 🎵 Müzik Çalma ve Sıra\n" +
            "• **`.çal <şarkı / link>`** (veya `.p`): YouTube & Spotify parçası, albümü veya playlist çalar.\n" +
            "• **`.kuyruk`** (veya `.q`): Sırada bekleyen tüm parçaları listeler.\n" +
            "• **`.geç`** (veya `.skip`): Sıradaki parçaya hızlı geçiş yapar.\n" +
            "• **`.duraklat`** / **`.devam`**: Şarkıyı geçici duraklatır veya sürdürür.\n" +
            "• **`.karıştır`**: Kuyruktaki parçaları rastgele karıştırır.\n" +
            "• **`.temizle`**: Çalan parçayı kesmeden kuyruğu sıfırlar.\n" +
            "• **`.şarkı`** (veya `.np`): Çalmakta olan şarkının panelini sohbete getirir.\n" +
            "• **`.durdur`**: Müziği sonlandırır ve ses kanalından ayrılır.\n\n" +
            "### ⭐ Favoriler ve Sunucu İstatistikleri\n" +
            "• **`.listem`**: Kişisel favori arşivini açar ve tek tıkla oynatır.\n" +
            "• **`.popüler`**: Sunucunun en çok dinlenen Top 20 parçasını listeler.\n" +
            "• **`.favori ekle <şarkı>`**: Kütüphanene yeni parça kaydeder.\n" +
            "• **`.favori sil <sıra_no>`**: Kütüphanenden parça çıkarır.\n\n" +
            "### ⚙️ Ayarlar\n" +
            "• **`.ses <0-100>`**: Ses düzeyini ayarlar.\n" +
            "• **`.yardım`**: Bu yardım rehberini gösterir."
        )
        .setFooter({ text: "🛡️ AdMeliora Music • Kurumsal Ses Mimarisi" });

    const m = await channel.send({ embeds: [embed] });
    setTimeout(() => m.delete().catch(() => {}), 30000);
}

module.exports = {
    showFavoritesMenu,
    showPopularMenu,
    showQueueMenu,
    showHelpMenu
};
