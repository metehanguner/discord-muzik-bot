# 🎧 AdMeliora Discord Müzik Botu

> **7/24 Kesintisiz, Yüksek Çözünürlüklü ve Sıfır Takılma Garantili Profesyonel Discord Müzik Botu**

---

## 🌟 Öne Çıkan Özellikler

* 🚀 **Sıfır Gecikmeli Ses Motoru**: `yt-dlp` -> `ffmpeg` -> `PassThrough` PCM s16le stereo (48000Hz) akış mimarisi.
* 🛡️ **15 Saniyelik Stream Watchdog**: Ağ kısıtlaması, telif veya bölgesel engellerde bot hiçbir zaman *"Ses akışı hazırlanıyor..."* aşamasında takılmaz; kullanıcıya bilgi verip otomatik olarak sıradaki parçaya geçer.
* 🎵 **Kapsamlı Platform Desteği**:
  - **YouTube**: Arama, tekil video ve 200+ parçalık çalma listeleri.
  - **Spotify**: Şarkı, albüm, kullanıcı listeleri ve **403 Editoryal Korumalı Listeler** (New Music Friday, Top 50 vb.) için özel iframe scraper.
* 💾 **Atomik Veritabanı & Felaket Kurtarma**: Çökmelere karşı `.tmp` -> `atomic rename` ve otomatik `.bak` yedeği ile kullanıcı favorileri ve dinlenme sayıları asla silinmez.
* 📊 **Otomatik Dinlenme Sayımı & Top 20 Popüler Listesi**: Sunucuda çalınan her parça anlık olarak sayılır ve `.popüler` komutuyla sunucunun en iyileri listelenir.
* ⭐ **Kişisel Müzik Arşivi (`.listem`)**: Kullanıcıların kendi favorilerini oluşturup tek tıkla (`Hepsini Oynat`) dinlemesini sağlayan interaktif menü.
* 📋 **Kuyruk Yönetimi (`.kuyruk`)**: Sırada bekleyen parçaları listeleme, Fisher-Yates rastgele karıştırma (`.karıştır`) ve temizleme (`.temizle`).
* 📡 **Discord Ses Otomatik Yeniden Bağlanma**: Ağ kopmalarında ses bağlantısını kaybetmeden 5 saniye içinde otomatik onarım.
* 🖥️ **Canlı Web Dashboard**: `http://localhost:3333` üzerinden uzak sunucu loglarını ve bot durumunu anlık izleme arayüzü.

---

## 📂 Proje Mimarisi

```
muzik-botu/
├── index.js                   # Bot giriş noktası ve Gateway olay orkestrasyonu
├── src/
│   ├── config.js              # Ortam değişkenleri, CPU önceliği ve dosya yolları
│   ├── db.js                  # Atomik JSON veritabanı ve felaket kurtarma
│   ├── logger.js              # Renkli konsol & dosya loglayıcı, DM hata bildirimi
│   ├── menus.js               # .listem, .popüler, .kuyruk ve .yardım arayüz menüleri
│   ├── player.js              # Master MusicPlayer, 15s Watchdog ve ses boru hattı
│   └── resolver.js            # Spotify API/Embed scraper ve YouTube çözümleme
├── deploy.js                  # Canlı Windows Server SFTP & PM2 tek-tık deployer
├── ecosystem.config.js        # PM2 üretim yapılandırması
├── monitor_server.js          # Canlı web log sunucusu (Port: 3333)
├── public/                    # Web panel arayüz dosyaları
└── PROJE_REHBERI_VE_MIMARI.md # Kapsamlı geliştirici mimari rehberi
```

---

## 🛠️ Komutlar

| Komut | Alternatif | Açıklama |
| :--- | :--- | :--- |
| `.çal <şarkı / link>` | `.p`, `.play` | YouTube/Spotify parçası, albümü veya listesini çalar. |
| `.listem` | — | Kişisel favori arşivini açar ve tek tıkla oynatır. |
| `.popüler` | `.top` | Sunucuda en çok dinlenen Top 20 şarkıyı sıralar. |
| `.favori ekle <şarkı>` | `.fav ekle` | Şarkıyı kişisel kütüphanene ekler. |
| `.favori sil <sıra_no>` | `.fav sil` | Kütüphanenden şarkıyı çıkarır. |
| `.kuyruk` | `.q`, `.queue` | Sırada bekleyen tüm parçaları listeler. |
| `.karıştır` | `.shuffle` | Kuyruktaki parçaları rastgele karıştırır. |
| `.temizle` | `.clear` | Kuyruktaki parçaları temizler (çalan şarkı devam eder). |
| `.şarkı` | `.np` | Çalan şarkının kontrol panelini sohbete getirir. |
| `.duraklat` / `.devam` | — | Şarkıyı duraklatır veya devam ettirir. |
| `.geç` | `.skip` | Sıradaki parçaya hızlı geçiş yapar. |
| `.ses <0-200>` | `.volume` | Ses düzeyini ayarlar. |
| `.durdur` | `.stop` | Müziği durdurur ve kanaldan ayrılır. |
| `.yardım` | `.help` | İnteraktif komut ve buton rehberini açar. |

---

## 🚀 Kurulum ve Çalıştırma

### 1. Depoyu Klonlayın
```bash
git clone https://github.com/metehanguner/discord-muzik-bot.git
cd discord-muzik-bot
```

### 2. Bağımlılıkları Yükleyin
```bash
npm install
```

### 3. Çevre Değişkenlerini Tanımlayın
`.env.example` dosyasını `.env` olarak kopyalayın ve bilgilerinizi girin:
```env
TOKEN=your_discord_bot_token_here
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
```

### 4. Başlatın
```bash
node index.js
```
*(Veya PM2 ile: `pm2 start ecosystem.config.js`)*

---

## 🛡️ Lisans
Bu proje özel lisans altındadır. Tüm hakları saklıdır.
