const fs     = require("fs");
const os     = require("os");
const ffmpeg = require("ffmpeg-static");
const { spawn } = require("child_process");
const { PassThrough } = require("stream");

const {
    ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder
} = require("discord.js");

const {
    createAudioPlayer, joinVoiceChannel, createAudioResource,
    StreamType, AudioPlayerStatus, VoiceConnectionStatus, entersState
} = require("@discordjs/voice");

const {
    YTDLP_PATH, COOKIES_PATH
} = require("./config");

const {
    logger, notifyRequesterAboutError, formatTime, createProgressBar
} = require("./logger");

const {
    recordGuildPlay, getActiveChannels
} = require("./db");

let _discordClient = null;
function setDiscordClient(c) {
    _discordClient = c;
}

// ============================================================
//  MASTER MUSIC PLAYER  |  Kurumsal 7/24 Dayanıklı Oynatıcı
// ============================================================
class MusicPlayer {
    constructor(guildId) {
        this.guildId          = guildId;
        this.queue            = [];
        this.current          = null;
        this.player           = createAudioPlayer();
        this.connection       = null;
        this.resource         = null;
        this.processes        = { ytdlp: null, ffmpeg: null };
        this.activeStream     = null;
        this.state            = { loop: false, paused: false, isSkipping: false };
        this.isTransitioning  = false;
        this.volume           = 0.5;
        this.textChannel      = null;
        this.lastMessage      = null;
        this.uiLock           = false;
        this._pendingUI       = null;
        this.tempFooter       = null;
        this.idleTimer        = null;
        this.playSeq          = 0;
        this.progressInterval = null;
        this.watchdogTimer    = null;

        this.stallStartTime   = null;
        this.totalStallCount  = 0;
        this.totalStallMs     = 0;
        this.totalPcmBytesReceived = 0;

        logger(`[PLAYER] Yeni MusicPlayer olusturuldu -> Sunucu: ${guildId}`, "DEBUG");

        // Player durum gecis loglari ve takilma (stall) takibi
        this.player.on("stateChange", (oldState, newState) => {
            if (oldState.status !== newState.status) {
                logger(`[PLAYER] Durum Gecisi: ${oldState.status} -> ${newState.status} | Sunucu: ${this.guildId}`, "DEBUG");
                if (newState.status === AudioPlayerStatus.Buffering || newState.status === AudioPlayerStatus.AutoPaused) {
                    this.stallStartTime = Date.now();
                    this.totalStallCount++;
                    logger(`⚠️ [TAKILMA TESPIT EDILDI] Ses tamponu tükendi (${newState.status})! (Toplam: #${this.totalStallCount}) | Şarkı: "${this.current ? this.current.title : "?"}"`, "WARNING");
                } else if (oldState.status === AudioPlayerStatus.Buffering && newState.status === AudioPlayerStatus.Playing) {
                    if (this.stallStartTime) {
                        const duration = Date.now() - this.stallStartTime;
                        this.totalStallMs += duration;
                        this.stallStartTime = null;
                        logger(`✅ [TAKILMA SONA ERDI] ${duration}ms duraksamadan sonra ses akışı normale döndü.`, "INFO");
                    }
                }
            }
        });

        // Boşta kalma (Idle) olayı
        this.player.on(AudioPlayerStatus.Idle, () => {
            // Şarkı geçişi veya temizliği sürerken gelen Idle olaylarını yoksay
            if (this.isTransitioning) {
                logger(`[PLAYER] Idle tetiklendi ancak sarki degisimi/temizligi devrede, yoksayildi.`, "DEBUG");
                return;
            }
            if (this.state.paused) {
                logger(`[PLAYER] Idle tetiklendi ama PAUSED durumunda, yoksayildi.`, "DEBUG");
                return;
            }
            if (!this.current) {
                logger(`[PLAYER] Idle tetiklendi ama calan sarki yok, yoksayildi.`, "DEBUG");
                return;
            }
            if (this.current.isLive) {
                logger(`[CANLI] Baglanti kesildi, 3 sn sonra yeniden baglaniliyor -> "${this.current.title}"`, "WARNING");
                setTimeout(() => { if (this.current) this.play(this.current); }, 3000);
                return;
            }
            if (this.state.loop) {
                logger(`[PLAYER] Dongu aktif, "${this.current.title}" yeniden oynatiliyor.`, "DEBUG");
                this.play(this.current);
                return;
            }
            logger(`[PLAYER] Sarki bitti, siradakine geciliyor. Kuyruk: ${this.queue.length}`, "INFO");
            this.next();
        });

        // Player hatası
        this.player.on("error", (err) => {
            const failedSeq = err.resource?.metadata?.seq;
            const isStale = failedSeq && failedSeq !== this.playSeq;

            // 1) Eğer hata önceki bir şarkının atlanmasından/kapatılmasından kalmışsa tamamen yoksay
            if (isStale) {
                logger(`[PLAYER] Onceki sarki akis sonlanmasi yoksayildi (Seq: #${failedSeq} != #${this.playSeq}) | ${err.message}`, "DEBUG");
                return;
            }

            // 2) Eğer hata geçiş/atlama/temizlik sırasında oluşan bir "Premature close" ise
            const isPrematureClose = err.message && err.message.includes("Premature close");
            if (this.isTransitioning || isPrematureClose) {
                logger(`[PLAYER] Akis sonlanmasi (Premature close / Transition). Siradakine geciliyor... | Sarki: "${this.current ? this.current.title : "?"}"`, "DEBUG");
                if (!this.isTransitioning) {
                    this.next();
                }
                return;
            }

            // 3) Gerçek beklenmedik bir oynatıcı hatası ise kullanıcıya bildir ve sonraki şarkıya geç
            logger(`[PLAYER] Oynatici Hatasi: ${err.message} | Sarki: "${this.current ? this.current.title : "?"}" | Sunucu: ${this.guildId}`, "ERROR");
            if (this.current && _discordClient) {
                notifyRequesterAboutError(_discordClient, this.current, err, "AudioPlayer Oynatıcı Hatası");
            }
            this.next();
        });
    }

    startIdleTimer(delay = 60000, reason = "Oturum zaman asimina ugradi.") {
        this.clearIdleTimer();
        const delaySec = Math.round(delay / 1000);
        logger(`[IDLE_TIMER] Baslatildi: ${delaySec}s -> "${reason}" | Sunucu: ${this.guildId}`, "INFO");
        this.idleTimer = setTimeout(async () => {
            if (this.current) {
                logger(`[IDLE_TIMER] Sayac doldu ama sarki caliyor, iptal edildi. Sunucu: ${this.guildId}`, "DEBUG");
                this.clearIdleTimer();
                return;
            }
            logger(`[IDLE_TIMER] Sure doldu (${delaySec}s). Sebep: "${reason}" | Sunucu: ${this.guildId}`, "INFO");
            if (this.textChannel) {
                const embed = new EmbedBuilder()
                    .setColor("#2B2D31")
                    .setDescription(`⏳ **${reason}** Ses kanalından ayrıldı.`);
                const m = await this.textChannel.send({ embeds: [embed] }).catch(() => null);
                if (m) setTimeout(() => m.delete().catch(() => {}), 6000);
            }
            this.destroy();
        }, delay);
    }

    clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
            logger(`[IDLE_TIMER] Iptal edildi. Sunucu: ${this.guildId}`, "DEBUG");
        }
    }

    async join(channel) {
        this.clearIdleTimer();
        if (!this.connection || this.connection.state.status === VoiceConnectionStatus.Destroyed) {
            logger(`[VOICE] Ses kanalina baglaniliyor: ${channel.name} (ID: ${channel.id}) | Sunucu: ${this.guildId}`, "INFO");
            this.connection = joinVoiceChannel({
                channelId: channel.id,
                guildId:   this.guildId,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: true
            });

            // Ses durumu izleme ve otomatik yeniden bağlanma
            this.connection.on("stateChange", async (oldState, newState) => {
                logger(`[VOICE] Baglanti Durumu: ${oldState.status} -> ${newState.status} | Sunucu: ${this.guildId}`, "DEBUG");
                
                if (newState.status === VoiceConnectionStatus.Disconnected) {
                    logger(`[VOICE] Baglanti koptu (Disconnected), otomatik yeniden baglanma deneniyor...`, "WARNING");
                    try {
                        await Promise.race([
                            entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
                            entersState(this.connection, VoiceConnectionStatus.Connecting, 5000)
                        ]);
                        logger(`[VOICE] Yeniden baglanti basarili!`, "INFO");
                    } catch (_) {
                        logger(`[VOICE] Yeniden baglanilamadi, baglanti kapatiliyor.`, "WARNING");
                        this.destroy();
                    }
                }
            });

            this.connection.subscribe(this.player);
            try {
                await entersState(this.connection, VoiceConnectionStatus.Ready, 25000);
                logger(`[VOICE] Baglanti basarili (Ready). Kanal: ${channel.name} | Sunucu: ${this.guildId}`, "INFO");
            } catch (e) {
                logger(`[VOICE] Baglanti zaman asimina ugradi (25s). Yikiliyor. Sunucu: ${this.guildId}`, "ERROR");
                if (this.textChannel) {
                    this.textChannel.send("❌ Discord ses sunucusuna bağlanılamadı (Zaman aşımı). Lütfen tekrar deneyin.").catch(() => {});
                }
                this.destroy();
                throw new Error("Ses kanalina baglanilamadi.");
            }
        } else {
            logger(`[VOICE] Zaten bagli. Sunucu: ${this.guildId}`, "DEBUG");
        }
    }

    async add(song, silent = false) {
        managers.set(this.guildId, this);
        this.clearIdleTimer();
        this.queue.push(song);
        const queuePos = this.queue.length;
        const songType = song.isLive ? "CANLI" : "sarki";
        logger(`[QUEUE] Eklendi (${songType}): "${song.title}" | Kuyruk sirasi: ${queuePos} | Sunucu: ${this.guildId}`, "INFO");
        if (this.player.state.status === AudioPlayerStatus.Idle && !this.state.paused && !this.current) {
            logger(`[QUEUE] Player bosta, hemen baslatiliyor -> "${song.title}"`, "DEBUG");
            await this.next();
        } else {
            if (!silent) {
                const embed = new EmbedBuilder().setColor("#ff00ff").setDescription(`🟣 **${song.title}** kuyruğa eklendi. (Sira: ${queuePos})`);
                const sMsg = await this.textChannel.send({ embeds: [embed] }).catch(() => null);
                if (sMsg) setTimeout(() => sMsg.delete().catch(() => {}), 5000);
                if (this.current) await this.updateUI(this.current, "update");
            }
        }
    }

    shuffle() {
        if (this.queue.length <= 1) return false;
        for (let i = this.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
        }
        logger(`[QUEUE] Kuyruk karistirildi (${this.queue.length} parca) | Sunucu: ${this.guildId}`, "INFO");
        return true;
    }

    clearQueue() {
        const count = this.queue.length;
        this.queue = [];
        logger(`[QUEUE] Kuyruk temizlendi (${count} parca silindi) | Sunucu: ${this.guildId}`, "INFO");
        return count;
    }

    async next() {
        this.clearProgressInterval();
        if (this.queue.length === 0) {
            logger(`[QUEUE] Kuyruk bos, oturum tamamlandi. Sunucu: ${this.guildId}`, "INFO");
            this.current = null;
            await this.updateUI(null, "finished");
            this.startIdleTimer(120000, "Kuyrukta sarki kalmadigi icin");
            return;
        }
        this.clearIdleTimer();
        const prev = this.current ? this.current.title : "—";
        this.current = this.queue.shift();
        logger(`[QUEUE] Gecis: "${prev}" -> "${this.current.title}" | Kalan kuyruk: ${this.queue.length} | Sunucu: ${this.guildId}`, "INFO");
        await this.play(this.current);
    }

    async play(song) {
        managers.set(this.guildId, this);
        this.isTransitioning = true;
        this.clearIdleTimer();
        this.clearProgressInterval();
        this.cleanup();
        this.state.paused = false;
        this.songStartTime = null;
        this.totalPausedMs = 0;
        this.stallStartTime = null;
        this.totalStallCount = 0;
        this.totalStallMs = 0;
        this.totalPcmBytesReceived = 0;
        const currentSeq = ++this.playSeq;
        const hasCookies = fs.existsSync(COOKIES_PATH);
        logger(`[PLAY] Baslatiliyor: "${song.title}" (Seq: #${currentSeq}) | Tur: ${song.isLive ? "CANLI" : "Normal"} | Cookies: ${hasCookies ? "VAR" : "YOK"} | Sunucu: ${this.guildId}`, "INFO");

        try {
            const ytdlpArgs = [
                "--js-runtimes", "node",
                ...(hasCookies ? ["--cookies", COOKIES_PATH] : []),
                "-f", "bestaudio/best",
                "-o", "-",
                "-q",
                "--no-warnings",
                "--no-playlist",
                "--buffer-size", "64K",
                "--socket-timeout", "30",
                song.url
            ];
            logger(`[PROCESS] yt-dlp akış motoru başlatılıyor -> "${song.title}"`, "DEBUG");
            this.processes.ytdlp = spawn(YTDLP_PATH, ytdlpArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

            const ffmpegArgs = [
                "-analyzeduration", "0",
                "-probesize", "32768",
                "-i", "pipe:0",
                "-vn",
                "-sn",
                "-f", "s16le",
                "-ar", "48000",
                "-ac", "2",
                "pipe:1"
            ];
            this.processes.ffmpeg = spawn(ffmpeg, ffmpegArgs, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

            if (this.processes.ytdlp && this.processes.ytdlp.pid) {
                try {
                    if (os.constants && os.constants.priority && os.constants.priority.PRIORITY_ABOVE_NORMAL) {
                        os.setPriority(this.processes.ytdlp.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
                    }
                } catch (_) {}
            }
            if (this.processes.ffmpeg && this.processes.ffmpeg.pid) {
                try {
                    if (os.constants && os.constants.priority && os.constants.priority.PRIORITY_ABOVE_NORMAL) {
                        os.setPriority(this.processes.ffmpeg.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
                    }
                } catch (_) {}
            }

            this.processes.ytdlp.stdout.on("error", () => {});
            this.processes.ffmpeg.stdin.on("error", () => {});
            this.processes.ytdlp.stdout.pipe(this.processes.ffmpeg.stdin);

            logger(`[PROCESS] yt-dlp PID: ${this.processes.ytdlp.pid} | ffmpeg PID: ${this.processes.ffmpeg.pid} | CPU: YUKSEK`, "DEBUG");

            this.processes.ytdlp.stderr && this.processes.ytdlp.stderr.on("data", (d) => {
                const msg = d.toString().trim();
                if (msg && !msg.includes("WARNING:")) {
                    logger(`[yt-dlp/STDERR] ${msg.substring(0, 300)}`, "WARNING");
                }
            });

            this.processes.ffmpeg.stderr && this.processes.ffmpeg.stderr.on("data", (d) => {
                const msg = d.toString().trim();
                if (!msg) return;
                if (msg.startsWith("ffmpeg version") || msg.includes("configuration:") || msg.includes("libavutil") || msg.includes("Stream mapping:")) return;
                if (msg.includes("size=") || msg.includes("bitrate=") || msg.includes("speed=")) return;
                logger(`[ffmpeg/STDERR] ${msg.substring(0, 300)}`, "DEBUG");
            });

            let hasStartedPlayback = false;

            // ERKEN HATA / ÇIKIŞ YAKALAYICI (Erken exit durumunda sonsuz bekleme bug'ını çözer)
            const handleEarlyFailure = async (source, reason) => {
                if (hasStartedPlayback || this.playSeq !== currentSeq) return;
                hasStartedPlayback = true;
                this.clearWatchdog();
                logger(`[STREAM_FAIL] Akış başlatılamadı (${source}): ${reason} | "${song.title}"`, "WARNING");
                if (this.textChannel) {
                    const failEmbed = new EmbedBuilder()
                        .setColor("#ff3333")
                        .setDescription(`⚠️ **${song.title.substring(0, 80)}** çalınamadı (Telif/Erişim Kısıtlaması). Sıradaki parçaya geçiliyor...`);
                    this.textChannel.send({ embeds: [failEmbed] }).then(m => setTimeout(() => m.delete().catch(() => {}), 6000)).catch(() => {});
                }
                if (_discordClient) notifyRequesterAboutError(_discordClient, song, new Error(`${source}: ${reason}`), "Akış Başlatma");
                await this.next();
            };

            this.processes.ytdlp.on("exit", (code, signal) => {
                if (signal !== "SIGKILL" && code !== 0 && code !== null) {
                    logger(`[yt-dlp/EXIT] Kod: ${code}, Sinyal: ${signal} | "${song.title}"`, "WARNING");
                    if (!hasStartedPlayback) handleEarlyFailure("yt-dlp", `Çıkış kodu ${code}`);
                }
            });

            this.processes.ffmpeg.on("exit", (code, signal) => {
                if (signal !== "SIGKILL") {
                    logger(`[ffmpeg/EXIT] Kod: ${code}, Sinyal: ${signal} | "${song.title}"`, code === 0 ? "DEBUG" : "WARNING");
                    if (!hasStartedPlayback && code !== 0 && code !== null) {
                        handleEarlyFailure("ffmpeg", `Çıkış kodu ${code}`);
                    }
                }
            });

            const stream = new PassThrough({ highWaterMark: 1024 * 1024 * 4 });
            this.activeStream = stream;
            stream.on("error", (err) => {
                if (err.message && err.message.includes("Premature close")) return;
                logger(`[STREAM/ERR] PassThrough akış hatası: ${err.message}`, "DEBUG");
            });

            this.processes.ffmpeg.stdout.pipe(stream);

            const TARGET_PREBUFFER_BYTES = 160000; // ~0.85 saniye PCM ön arabellek

            const triggerPlay = () => {
                if (hasStartedPlayback || this.playSeq !== currentSeq) return;
                hasStartedPlayback = true;
                this.clearWatchdog();

                this.resource = createAudioResource(stream, {
                    inputType: StreamType.Raw,
                    inlineVolume: true,
                    metadata: { seq: currentSeq, song }
                });
                this.resource.volume.setVolume(this.volume);
                this.player.play(this.resource);
                this.isTransitioning = false; // Geçiş bitti, artık parça normal çalıyor!
                this.songStartTime = Date.now();
                this.startProgressInterval();
                recordGuildPlay(this.guildId, song);
                logger(`[PLAY] Tampon hazirlandi (${(this.totalPcmBytesReceived / 1024).toFixed(0)} KB), AudioPlayer baslatildi. "${song.title}" | Sunucu: ${this.guildId}`, "INFO");
                this.updateUI(song, "update");
            };

            // HIZLI ÖN ARABELLEK ZAMANLAYICISI
            let prebufferTimer = setTimeout(() => {
                if (!hasStartedPlayback && this.totalPcmBytesReceived > 0) {
                    triggerPlay();
                }
            }, 1800);

            // 15 SANİYELİK KORUMA (STREAM WATCHDOG) - Sonsuz takılmayı kesin olarak çözen mimari katman
            this.watchdogTimer = setTimeout(() => {
                if (!hasStartedPlayback && this.playSeq === currentSeq) {
                    logger(`[STREAM_WATCHDOG] 15 saniye doldu, ses akisi gelmedi. Zaman asimi devrede! "${song.title}"`, "ERROR");
                    handleEarlyFailure("Watchdog", "15 saniyelik zaman aşımı süresi doldu");
                }
            }, 15000);

            this.processes.ffmpeg.stdout.on("data", (chunk) => {
                this.totalPcmBytesReceived += chunk.length;
                if (!hasStartedPlayback && this.totalPcmBytesReceived >= TARGET_PREBUFFER_BYTES) {
                    if (prebufferTimer) { clearTimeout(prebufferTimer); prebufferTimer = null; }
                    triggerPlay();
                }
            });

            this.processes.ffmpeg.stdout.on("end", () => {
                if (!hasStartedPlayback && this.totalPcmBytesReceived > 0) {
                    triggerPlay();
                }
            });

            this.updateUI(song, "new");

        } catch (e) {
            this.isTransitioning = false;
            logger(`[PLAY] Oynatma baslatma hatasi: ${e.message} | Sarki: "${song.title}" | Sunucu: ${this.guildId}`, "ERROR");
            if (_discordClient) notifyRequesterAboutError(_discordClient, song, e, "Akış Başlatma");
            if (this.textChannel) {
                const failEmbed = new EmbedBuilder()
                    .setColor("#ff3333")
                    .setDescription(`⚠️ **${song.title.substring(0, 80)}** çalınamadı. Sıradaki parçaya geçiliyor...`);
                this.textChannel.send({ embeds: [failEmbed] }).then(m => setTimeout(() => m.delete().catch(() => {}), 6000)).catch(() => {});
            }
            await this.next();
        }
    }

    clearWatchdog() {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    startProgressInterval() {
        this.clearProgressInterval();
        let tickCount = 0;
        this._initTimeout = setTimeout(() => {
            this._initTimeout = null;
            if (this.current && !this.state.paused && this.player.state.status === AudioPlayerStatus.Playing) {
                this.updateUI(this.current, "update");
            }
        }, 2000);

        this.progressInterval = setInterval(async () => {
            if (this.current && !this.state.paused && this.player.state.status === AudioPlayerStatus.Playing) {
                await this.updateUI(this.current, "update");
                tickCount++;
                if (tickCount % 2 === 0) {
                    const decodedSec = this.totalPcmBytesReceived / (48000 * 4);
                    const playedSec  = this.songStartTime ? (Date.now() - this.songStartTime - (this.totalPausedMs || 0)) / 1000 : 0;
                    const bufferAhead = Math.max(0, decodedSec - playedSec);
                    logger(`[AKIS_SAGLIGI] Cozulen Ses: ${decodedSec.toFixed(1)}s | Calinan Sure: ${playedSec.toFixed(1)}s | Tampon Fazlasi: +${bufferAhead.toFixed(1)}s | Takilma: ${this.totalStallCount}`, bufferAhead < 2 ? "WARNING" : "DEBUG");
                }
            }
        }, 6000);
    }

    clearProgressInterval() {
        if (this._initTimeout) {
            clearTimeout(this._initTimeout);
            this._initTimeout = null;
        }
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    async updateUI(song, status) {
        if (!this.textChannel) {
            const chs = getActiveChannels();
            if (chs[this.guildId] && _discordClient) {
                const ch = _discordClient.channels.cache.get(chs[this.guildId]);
                if (ch) this.textChannel = ch;
            }
        }
        if (!this.textChannel) return;
        if (this.uiLock) {
            logger(`[UI] Kilit aktif, bekletiliyor -> status: ${status}, sarki: "${song ? song.title : "—"}"`, "DEBUG");
            this._pendingUI = { song, status };
            return;
        }
        this.uiLock = true;
        this._pendingUI = null;
        logger(`[UI] Guncelleniyor -> status: "${status}", sarki: "${song ? song.title : "—"}" | Sunucu: ${this.guildId}`, "DEBUG");
        try {
            if (status === "finished") {
                this.clearProgressInterval();
                const embed = new EmbedBuilder()
                    .setColor("#5865F2")
                    .setAuthor({ name: "🎶 ŞARKI TAMAMLANDI • BEKLEMEDE" })
                    .setTitle("Kuyruk Tamamlandı")
                    .setDescription("Yeni bir şarkı çalmak için `.çal <şarkı adı>` yazabilirsiniz.\n*Bot 2 dakika boyunca ses kanalında hazır bekleyecektir.*")
                    .setFooter({ text: "🎧 AdMeliora Music • Aktif Bekleme" });
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("m_fav_list").setLabel("Favorilerim").setEmoji("⭐").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("m_top_list").setLabel("Top 20 Popüler").setEmoji("🔥").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("m_stop").setLabel("Kanalı Terk Et").setEmoji("⏹️").setStyle(ButtonStyle.Danger)
                );
                if (this.lastMessage) {
                    await this.lastMessage.edit({ embeds: [embed], components: [row] }).catch(() => {});
                    logger(`[UI] "finished" mesaji bekleme paneliyle guncellendi.`, "DEBUG");
                }
            } else {
                const isBuffering = !this.songStartTime;
                let currentSec = 0;
                if (this.resource && typeof this.resource.playbackDuration === "number" && this.resource.playbackDuration > 0) {
                    currentSec = Math.floor(this.resource.playbackDuration / 1000);
                } else if (this.songStartTime) {
                    const pausedMs = (this.totalPausedMs || 0) + (this.state.paused && this.pauseStartTime ? (Date.now() - this.pauseStartTime) : 0);
                    currentSec = Math.max(0, Math.floor((Date.now() - this.songStartTime - pausedMs) / 1000));
                }
                const totalSec = (song && song.durationSec) ? song.durationSec : 0;
                let progressBar;
                if (song && song.isLive) {
                    progressBar = "🔴 `CANLI YAYIN`";
                } else if (isBuffering) {
                    progressBar = "⏳ `[Ses akışı indiriliyor ve arabelleğe alınıyor...]`\n`▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒` `[00:00 / " + formatTime(totalSec) + "]`";
                } else {
                    progressBar = createProgressBar(currentSec, totalSec);
                }

                const embed = new EmbedBuilder()
                    .setColor(song.isLive ? "#ff0000" : (this.state.paused ? "#ffcc00" : (isBuffering ? "#ffaa00" : "#00ffff")))
                    .setAuthor({ 
                        name: song.isLive ? "📡 CANLI YAYIN" : (this.state.paused ? "⏸️ DURAKLATILDI" : (isBuffering ? "⏳ SES AKIŞI HAZIRLANIYOR..." : "🎶 OYNATILIYOR")) 
                    })
                    .setTitle(`${song.title.substring(0, 100)}`)
                    .setURL(song.url)
                    .setDescription(progressBar)
                    .addFields(
                        { name: song.isLive ? "📡 DURUM" : "⏭️ SIRADAKİ", value: song.isLive ? "`🔴 CANLI`" : (isBuffering ? "`⏳ Hazırlanıyor...`" : `\`${this.queue[0] ? this.queue[0].title.substring(0, 36) : "Kuyruk Boş"}\``), inline: true },
                        { name: "🔊 SES",   value: `\`%${Math.round(this.volume * 100)}\``, inline: true },
                        { name: song.isLive ? "🔄 TEKRAR" : "🔁 DÖNGÜ", value: song.isLive ? "`Oto-Baglan`" : `\`${this.state.loop ? "Acik" : "Kapali"}\``, inline: true }
                    )
                    .setFooter({ text: this.tempFooter || `🎧 ${song.requestedBy} • ${song.isLive ? "📡 Canli Yayin" : (isBuffering ? "⚡ Arabellek dolduruluyor..." : `📦 Kuyruk: ${this.queue.length}`)}` });
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("m_pause").setEmoji(this.state.paused ? "▶️" : "⏸️").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("m_skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("m_loop").setEmoji("🔁").setStyle(this.state.loop ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("m_fav").setEmoji("⭐").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("m_stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger)
                );
                if (status === "new" || !this.lastMessage) {
                    if (this.lastMessage) await this.lastMessage.delete().catch(() => {});
                    this.lastMessage = await this.textChannel.send({ embeds: [embed], components: [row] }).catch(() => null);
                    logger(`[UI] Yeni mesaj gonderildi (ID: ${this.lastMessage ? this.lastMessage.id : "HATA"}).`, "DEBUG");
                } else {
                    await this.lastMessage.edit({ embeds: [embed], components: [row] }).catch(async () => {
                        logger(`[UI] edit() basarisiz, yeni mesaj gonderiliyor...`, "DEBUG");
                        this.lastMessage = await this.textChannel.send({ embeds: [embed], components: [row] }).catch(() => null);
                    });
                }
            }
        } finally {
            this.uiLock = false;
            if (this._pendingUI) {
                const pending = this._pendingUI;
                this._pendingUI = null;
                logger(`[UI] Bekleyen guncelleme isleniyor -> status: "${pending.status}"`, "DEBUG");
                setImmediate(() => this.updateUI(pending.song, pending.status));
            }
        }
    }

    async setTempFooter(text) {
        this.tempFooter = text;
        if (this.current) await this.updateUI(this.current, "update");
        setTimeout(async () => {
            this.tempFooter = null;
            if (this.current) await this.updateUI(this.current, "update");
        }, 3000);
    }

    setVolume(vol) {
        const oldVol = Math.round(this.volume * 100);
        this.volume = vol / 100;
        if (this.resource && this.resource.volume) this.resource.volume.setVolume(this.volume);
        logger(`[VOLUME] %${oldVol} -> %${vol} | Sunucu: ${this.guildId}`, "INFO");
    }

    async pause() {
        if (this.state.paused) {
            this.player.unpause();
            this.state.paused = false;
            if (this.pauseStartTime) {
                this.totalPausedMs = (this.totalPausedMs || 0) + (Date.now() - this.pauseStartTime);
                this.pauseStartTime = null;
            }
            logger(`[PLAYER] Devam ettirildi (Unpause). "${this.current ? this.current.title : "?"}" | Sunucu: ${this.guildId}`, "INFO");
        } else {
            this.player.pause();
            this.state.paused = true;
            this.pauseStartTime = Date.now();
            logger(`[PLAYER] Duraklatildi (Pause). "${this.current ? this.current.title : "?"}" | Sunucu: ${this.guildId}`, "INFO");
        }
        if (this.current) await this.updateUI(this.current, "update");
    }

    async skip() {
        logger(`[PLAYER] Skip tetiklendi. Gecerli: "${this.current ? this.current.title : "?"}" | Kuyruk: ${this.queue.length} | Sunucu: ${this.guildId}`, "INFO");
        if (this.queue.length === 0) {
            await this.setTempFooter("⚠️ Kuyrukta geçilecek başka parça yok!");
            return;
        }
        this.isTransitioning = true;
        this.clearProgressInterval();
        this.cleanup();
        if (this.lastMessage && this.queue.length > 0) {
            const nextSong = this.queue[0];
            const loadingEmbed = new EmbedBuilder()
                .setColor("#ffaa00")
                .setAuthor({ name: "⏭️ SIRADAKİ ŞARKIYA GEÇİLİYOR..." })
                .setTitle(`⏳ ${nextSong.title.substring(0, 85)}`)
                .setDescription("`Bağlantı kuruluyor ve akış hazırlanıyor...`")
                .setFooter({ text: "⚡ Hızlı geçiş devrede" });
            this.lastMessage.edit({ embeds: [loadingEmbed], components: [] }).catch(() => {});
        }
        await this.next();
    }

    cleanup() {
        this.clearProgressInterval();
        this.clearWatchdog();
        this.playSeq++;
        this.isTransitioning = true;
        let killed = false;

        // 1. Önce AudioPlayer'ı durdur (kaynak dinleyicilerini koparır)
        if (this.player) {
            try { this.player.stop(true); } catch (_) {}
        }

        // 2. Aktif PassThrough akışını güvenle sonlandır
        if (this.activeStream) {
            try {
                this.activeStream.removeAllListeners("error");
                this.activeStream.on("error", () => {});
                this.activeStream.destroy();
            } catch (_) {}
            this.activeStream = null;
        }

        // 3. Çocuk süreçleri (ffmpeg ve yt-dlp) temizle
        if (this.processes.ffmpeg) {
            try {
                this.processes.ffmpeg.stdout && this.processes.ffmpeg.stdout.removeAllListeners("error");
                this.processes.ffmpeg.stdout && this.processes.ffmpeg.stdout.on("error", () => {});
                this.processes.ffmpeg.stdout && this.processes.ffmpeg.stdout.unpipe();
                this.processes.ffmpeg.stdin && this.processes.ffmpeg.stdin.removeAllListeners("error");
                this.processes.ffmpeg.stdin && this.processes.ffmpeg.stdin.on("error", () => {});
                this.processes.ffmpeg.stdin && this.processes.ffmpeg.stdin.unpipe();
                this.processes.ffmpeg.kill("SIGKILL");
                this.processes.ffmpeg.kill();
                killed = true;
            } catch (_) {}
        }

        if (this.processes.ytdlp) {
            try {
                this.processes.ytdlp.stdout && this.processes.ytdlp.stdout.removeAllListeners("error");
                this.processes.ytdlp.stdout && this.processes.ytdlp.stdout.on("error", () => {});
                this.processes.ytdlp.stdout && this.processes.ytdlp.stdout.unpipe();
                this.processes.ytdlp.kill("SIGKILL");
                this.processes.ytdlp.kill();
                killed = true;
            } catch (_) {}
        }

        this.processes = { ytdlp: null, ffmpeg: null };
        if (killed) logger(`[CLEANUP] yt-dlp ve ffmpeg surecleri temizlendi. Sunucu: ${this.guildId}`, "DEBUG");
    }

    destroy() {
        logger(`[DESTROY] Oturum kapatiliyor. Sunucu: ${this.guildId} | Sarki: "${this.current ? this.current.title : "—"}" | Kalan kuyruk: ${this.queue.length}`, "INFO");
        this.clearIdleTimer();
        this.clearProgressInterval();
        this.clearWatchdog();
        this.cleanup();
        this.queue   = [];
        this.current = null;
        if (this.lastMessage) this.lastMessage.delete().catch(() => {});
        try { this.player.stop(true); } catch (_) {}
        try {
            if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
                this.connection.destroy();
                logger(`[DESTROY] Ses baglantisi kapatildi. Sunucu: ${this.guildId}`, "INFO");
            }
        } catch (_) {}
        this.connection = null;
        managers.delete(this.guildId);
        logger(`[DESTROY] MusicPlayer temizlendi. Sunucu: ${this.guildId}`, "INFO");
    }
}

// ============================================================
//  MANAGER YÖNETİCİSİ
// ============================================================
const managers = new Map();

function getManager(id) {
    if (!managers.has(id)) {
        logger(`[MANAGER] Yeni MusicPlayer olusturuluyor. Sunucu: ${id}`, "DEBUG");
        managers.set(id, new MusicPlayer(id));
    }
    return managers.get(id);
}

module.exports = {
    MusicPlayer,
    managers,
    getManager,
    setDiscordClient
};
