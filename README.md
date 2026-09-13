# 🎧 AdMeliora Discord Müzik Botu

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20Server-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![PM2](https://img.shields.io/badge/PM2-Managed-2B037A?style=for-the-badge&logo=pm2&logoColor=white)
![License](https://img.shields.io/badge/Lisans-%C3%96zel-red?style=for-the-badge)

**7/24 Kesintisiz • Sıfır Takılma • Yüksek Çözünürlüklü Ses**

</div>

---

## ✨ Öne Çıkan Özellikler

| Özellik | Açıklama |
| :--- | :--- |
| 🚀 **Sıfır Gecikmeli Ses** | `yt-dlp → ffmpeg → PassThrough PCM s16le 48kHz stereo` boru hattı + ~160KB prebuffer |
| 🛡️ **15s Stream Watchdog** | Ağ/telif engellerinde sonsuz beklemez; kullanıcıya bilgi verip sıradaki parçaya geçer |
| 🎵 **YouTube & Spotify** | Tekil parça, albüm, playlist + 403 korumalı editoryal listeler (New Music Friday, Top 50) |
| 🔁 **Otomatik Kurtarma** | Çökme sonrası PM2 ile anında yeniden başlatma ve son aktif kanala bildirim |
| 💾 **Felaket Kurtarma DB** | Atomik `.tmp → rename` yazım + `.bak` otoyedeği ile favori ve istatistikler asla kaybolmaz |
| 📊 **Top 20 & Favoriler** | Sunucuya özel anlık dinlenme istatistiği ve kişisel müzik arşivi |
| 🖥️ **Canlı Web Dashboard** | SSH üzerinden uzak sunucu loglarını tarayıcıda gerçek zamanlı izleme (port 3333) |
| 📬 **DM Hata Bildirimi** | Şarkı oynatılamazsa, şarkıyı isteyen kullanıcıya Discord DM ile hata özeti gönderilir |
| 📝 **Akıllı Loglama** | `DEBUG` yalnızca konsola gider; `bot.log` sadece anlamlı olayları içerir (5MB rotation) |

---

## 📂 Mimari

```
muzik-botu/
├── index.js                    # Bot giriş noktası — Gateway olayları ve orkestrasyon
├── src/
│   ├── config.js               # .env yükleyici, CPU önceliği, dosya yolları
│   ├── logger.js               # Loglama (DEBUG → konsol, INFO+ → dosya), session tracker
│   ├── db.js                   # Atomik JSON veritabanı ve felaket kurtarma
│   ├── player.js               # MusicPlayer — ses akışı, prebuffer, watchdog
│   ├── resolver.js             # Spotify Embed scraper + YouTube çözümleme
│   └── menus.js                # .listem, .popüler, .kuyruk, .yardım arayüzleri
├── deploy.js                   # SFTP + PM2 tek-komut deployer
├── monitor_server.js           # Canlı SSH log sunucusu (port 3333)
├── ecosystem.config.js         # PM2 üretim yapılandırması
└── PROJE_REHBERI_VE_MIMARI.md  # Kapsamlı mimari ve geliştirici rehberi
```

### Ses Akış Mimarisi

```
yt-dlp (spawn)
    │
    ▼
ffmpeg (-i pipe:0 -f s16le -ar 48000 -ac 2 pipe:1)
    │
    ▼
PassThrough (4MB buffer)
    │
    ▼ Pre-buffer: ~160KB (~0.85s)
AudioPlayer ──► VoiceConnection (Discord)
```

---

## 🛠️ Komutlar

| Komut | Alternatif | Açıklama |
| :--- | :--- | :--- |
| `.çal <şarkı / link>` | `.p`, `.play` | YouTube/Spotify parçası, albüm veya listesini çalar |
| `.geç` | `.skip` | Sıradaki parçaya geçer |
| `.duraklat` / `.devam` | — | Duraklatır / devam ettirir |
| `.durdur` | `.stop` | Müziği durdurur ve kanaldan ayrılır |
| `.ses <0-200>` | `.volume` | Ses seviyesini ayarlar |
| `.şarkı` | `.np` | Çalan şarkının kontrol panelini getirir |
| `.kuyruk` | `.q` | Sıradaki parçaları listeler |
| `.karıştır` | `.shuffle` | Kuyruğu Fisher-Yates ile karıştırır |
| `.temizle` | `.clear` | Kuyruğu temizler (çalan devam eder) |
| `.listem` | — | Kişisel favori arşivini açar |
| `.favori ekle <şarkı>` | `.fav ekle` | Şarkıyı kütüphaneye ekler |
| `.favori sil <no>` | `.fav sil` | Kütüphaneden şarkıyı siler |
| `.popüler` | `.top` | Sunucunun Top 20 listesini gösterir |
| `.yardım` | `.help` | Komut rehberini açar |

---

## 🚀 Kurulum

### Gereksinimler
- Node.js v20+
- `ffmpeg` (sistem PATH'inde)
- Discord Bot Token
- Spotify API Key (Client ID + Secret)

### Adımlar

```bash
# 1. Klonla
git clone https://github.com/metehanguner/discord-muzik-bot.git
cd discord-muzik-bot

# 2. Bağımlılıkları yükle
npm install

# 3. .env dosyasını oluştur
cp .env.example .env
# .env içine TOKEN, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET gir

# 4. Çalıştır
node index.js

# — veya PM2 ile üretim modunda —
pm2 start ecosystem.config.js
```

### Canlı Sunucuya Deploy
```bash
# Değişiklikleri uzak Windows Server'a gönder ve PM2'yi yeniden başlat
node deploy.js
```

---

## 📊 Loglama Sistemi

| Seviye | Konsol | bot.log | Kullanım |
| :--- | :---: | :---: | :--- |
| `SYSTEM` | ✅ | ✅ | Başlatma, Gateway bağlantısı |
| `INFO` | ✅ | ✅ | Şarkı geçişi, kullanıcı işlemleri |
| `WARNING` | ✅ | ✅ | Takılma, DM gönderilemedi |
| `ERROR` | ✅ | ✅ | Hata, API reddi |
| `FATAL` | ✅ | ✅ | Kritik çökme |
| `DEBUG` | ✅ | ❌ | UI güncellemeleri, periyodik ölçümler |

- `bot.log` → 5MB limitinde otomatik arşivlenir (`bot_arsiv_<tarih>.log`)
- `bot.sessions.log` → Her restart'ta oturum numarası ve PID kaydı

---

## 🛡️ Lisans

Bu proje özel lisans altındadır. İzinsiz kullanım, kopyalama veya dağıtım yasaktır.  
© 2026 AdMeliora — Tüm hakları saklıdır.


