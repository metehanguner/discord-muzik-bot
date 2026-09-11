# 🎧 ADMELIORA DISCORD MÜZİK BOTU — MASTER MİMARİ VE GELİŞTİRİCİ REHBERİ
> **Bu belge; gelecekteki geliştirmelerde projeyi devralacak yapay zekalar (AI), bot yöneticileri ve yazılım geliştiricileri için tek ve nihai referans kaynağıdır.**  
> Projeyi analiz etmek için başka hiçbir dosyayı tek tek araştırmanıza gerek yoktur. Tüm mimari, sunucu erişimi, deploy adımları ve kod kuralları aşağıda detaylandırılmıştır.

---

## 1. PROJE ÖZETİ VE AMACI

* **Bot Adı:** AdMeliora Music (`AdMeliora Music#8487`)
* **Platform:** Node.js (v20+ / v26.x), Discord.js v14, `@discordjs/voice`
* **Çalışma Ortamı:** Windows Server (Uzak Sunucu) + PM2 Süreç Yöneticisi
* **Temel Yetenekler:**
  - YouTube (Arama, tekil video, çalma listeleri)
  - Spotify (Tek parça, albüm, kullanıcı listeleri ve **Spotify Editoryal 403 korumalı listeleri** [New Music Friday, Top 50 vb.])
  - 2 aşamalı sıfır gecikmeli ses akışı (yt-dlp -> ffmpeg -> PassThrough PCM s16le -> Discord Voice)
  - Pre-buffering (~160KB) ile seste sıfır takılma/gecikme
  - Bir hata olduğunda şarkıyı isteyen kullanıcıya son hata logunu **otomatik DM gönderme**
  - Çökme sonrası kendini onaran ve kanala bildiren kurtarma motoru (`crash_state.json`)

---

## 2. UZAK SUNUCU (DEPLOYMENT & SSH) BİLGİLERİ

Bot 7/24 kesintisiz olarak uzak bir Windows sunucusu üzerinde PM2 ile çalışmaktadır.

### 🌐 Sunucu Bağlantı Parametreleri
* **Sunucu IP:** `89.47.113.220`
* **SSH Port:** `22`
* **Parola:** `.env` dosyasında `SSH_PASSWORD` olarak saklanır.

### 📂 Sunucu Dizinleri
* **Uzak Bot Klasörü:** `C:\Users\Administrator\Desktop\muzik-botu\muzik-botu\`
* **Yerel Bot Klasörü:** `c:\Users\METEHAN\Desktop\Apps\muzik-botu\muzik-botu\`

### 🚀 Tek Komutla Deploy (Otomatik Dağıtım)
Yerel dizinde `deploy.js` scripti hazırdır. Yerelde yapılan değişiklikleri uzak sunucuya göndermek ve botu yeniden başlatmak için terminalden tek komut çalıştırmak yeterlidir:
```bash
node deploy.js
```
**`deploy.js` Arkada Ne Yapar?**
1. SSH2 ile `89.47.113.220` sunucusuna bağlanır.
2. SFTP ile `index.js` ve `.env` dosyalarını sunucuya aktarır.
3. Sunucuda asılı kalmış olabilecek `yt-dlp.exe` ve `ffmpeg.exe` süreçlerini sonlandırır (`taskkill /F`).
4. PM2 üzerinden botu ortam değişkenlerini güncelleyerek yeniden başlatır (`pm2 restart muzik-botu --update-env`).
5. Sunucunun güncel süreç durum tablosunu (`pm2 list`) ekrana basar.

### 📊 PM2 Süreç Bilgileri (Sunucu Tarafı)
* **App Name:** `muzik-botu`
* **App ID:** `4`
* **Yapılandırma Dosyası:** `ecosystem.config.js`
* Sunucuda çalışan diğer servisler: `deprem-sunucu` (id: 0), `deprem-bot-manager` (id: 1). **Bu servislere ASLA dokunulmamalıdır!**

### 📜 Canlı Log Takibi
Sunucudaki logları izlemek için SSH üzerinden şu PowerShell komutu çalıştırılır:
```powershell
Get-Content C:\Users\Administrator\Desktop\muzik-botu\muzik-botu\bot.log -Tail 30 -Wait
```

---

## 3. DOSYA PLANI VE MODÜLER GÖREV DAĞILIMI (Clean Architecture)

Bot, kurumsal seviyede sürdürülebilirlik sağlamak için **modüler mimariye (`src/`)** ayrılmıştır:

| Dosya / Klasör | Görevi |
| :--- | :--- |
| [`index.js`](file:///c:/Users/METEHAN/Desktop/Apps/muzik-botu/muzik-botu/index.js) | **Giriş ve Olay Yöneticisi (~470 satır).** Discord Client, Gateway olayları (`ClientReady`, `MessageCreate`, `InteractionCreate`, `VoiceStateUpdate`), güvenli kapatma (`shutdown`) ve çökme koruması. |
| [`src/config.js`](file:///c:/Users/METEHAN/Desktop/Apps/muzik-botu/muzik-botu/src/config.js) | **Sistem Konfigürasyonu:** `.env` yükleyici, CPU öncelik ayarı (`ABOVE_NORMAL`), dosya yolları (`YTDLP_PATH`, `DB_FILE` vb.) ve Spotify regex/anahtarları. |
| [`src/logger.js`](file:///c:/Users/METEHAN/Desktop/Apps/muzik-botu/muzik-botu/src/logger.js) | **Loglama & Yardımcılar:** Dosya ve konsol loglayıcı, `notifyRequesterAboutError` (kullanıcıya DM hata iletimi), süre ve ilerleme çubuğu, `formatMarkdownTitle` (Markdown link bozulma koruması). |
| [`src/db.js`](file:///c:/Users/METEHAN/Desktop/Apps/muzik-botu/muzik-botu/src/db.js) | **Veritabanı Katmanı:** `music_db.json` erişimi, `saveToDB` (favori ekleme), `recordGuildPlay` (gerçek çalma sayacı), `removeFromDB`, aktif kanal kaydı. |
| [`src/resolver.js`](file:///c:/Users/METEHAN/Desktop/Apps/muzik-botu/muzik-botu/src/resolver.js) | **Ses Çözümleme Katmanı:** Spotify API + Embed scraper, YouTube arama, yt-dlp otomatik kurulumu (`ensureYtDlp`) ve `resolve()` fonksiyonu. |
| [`src/player.js`](file:///c:/Users/METEHAN/Desktop/Apps/muzik-botu/muzik-botu/src/player.js) | **Ses & Oynatıcı Motoru:** `MusicPlayer` sınıfı, yt-dlp -> ffmpeg PCM akışı, prebuffering (~160KB), takılma koruması, UI güncelleme ve ses kontrolleri. |
| [`src/menus.js`](file:///c:/Users/METEHAN/Desktop/Apps/muzik-botu/muzik-botu/src/menus.js) | **Arayüz Menüleri:** `showFavoritesMenu` (.listem) ve `showPopularMenu` (.popüler) için 20 şarkılık Embed listesi, açılır menü ve toplu çalma butonları. |
| [`deploy.js`](file:///c:/Users/METEHAN/Desktop/Apps/muzik-botu/muzik-botu/deploy.js) | **Otomatik Dağıtım Motoru:** `src/` klasörü dahil tüm kaynak kodları uzaktaki Windows sunucusuna SFTP ile aktarıp PM2 servisini yeniden başlatan script. |
| `.env` | Gizli anahtarlar: `TOKEN`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`. |
| `music_db.json` | Kullanıcı favori şarkıları ve sunucu gerçek çalınma istatistikleri. |
| `active_channels.json` | Çökme sonrası kurtarma bildirimleri için en son müzik çalınan metin kanalları. |
| `bin/yt-dlp.exe` | YouTube ve ses çıkarma ikili motoru (yoksa otomatik indirilir). |
| `yedek/` | Çalışan kararlı sürümlerin tam yedekleri. |

---

## 4. SES VE AKIŞ MOTORU (AUDIO PIPELINE)

Botun pürüzsüz ve sıfır takılmayla çalmasını sağlayan özel mimari:

```
[yt-dlp spawn] (stdout pipe)
       │
       ▼
[ffmpeg spawn] (-i pipe:0 -f s16le -ar 48000 -ac 2 pipe:1)
       │
       ▼
[PassThrough Stream] (highWaterMark: 4MB)
       │
       ▼ (Pre-buffer Kontrolü: 160.000 Byte ~0.85 sn)
[createAudioResource] (StreamType.Raw, inlineVolume: true)
       │
       ▼
[AudioPlayer] ──► [VoiceConnection] (Discord Ses Kanalı)
```

### Kritik Ses Kuralları:
1. **Windows CPU Önceliği:** `index.js` ve alt süreçler (`yt-dlp`, `ffmpeg`) `os.setPriority(PRIORITY_ABOVE_NORMAL)` ile yüksek öncelikle çalışır.
2. **Pre-Buffering:** Ses boru hattından ilk byte geldiği an ses başlatılmaz; ~160 KB PCM verisi dolana kadar beklenir. Beklenmeyen gecikmelerde `prebufferTimer` (1800ms) devreye girerek akışı başlatır.
3. **Süreç Temizliği (`cleanup`):** Şarkı atlandığında veya durdurulduğunda `yt-dlp` ve `ffmpeg` SIGKILL ile yok edilir; yetim/asılı kalan süreç oluşmaz.
4. **playSeq Sıra Sayacı:** Çok hızlı şarkı geçişlerinde eski şarkının tamponundan kalan gecikmiş event'lerin yeni şarkıyı ezmesini engeller.

---

## 5. SPOTIFY ENTEGRASYONU VE 403 BYPASS MEKANİZMASI

Spotify çalma listelerinde iki temel kısıtlama vardır:
1. **Client Credentials API 403 Kısıtlaması:** Spotify, editoryal listelerine (`New Music Friday`, `Top 50`, `Daily Mix`) API üzerinden token ile erişilmesini engeller (403 Forbidden).
2. **yt-dlp DRM Koruması:** `yt-dlp` doğrudan Spotify linki verildiğinde `DRM protection` hatası vererek çöker.

### Çözüm Mimarisi (`fetchSpotifyEmbed`):
* Bot, `https://open.spotify.com/embed/{type}/{id}` iframe sayfasını HTTP fetch ile çeker.
* Sayfa içindeki `<script id="__NEXT_DATA__">` JSON verisini parse eder.
* **Sonuç:** Token gerektirmeden, 403 kısıtlamasına takılmadan listenin içindeki **97 şarkının tamamının gerçek adı, sanatçısı ve süresi** doğru sırayla elde edilir.

### İki Aşamalı Hızlı YouTube Eşleme (`searchYouTubeForTrack`):
* **Aşama 1 (Hafif HTTP Arama):** `https://www.youtube.com/results?search_query=...` sayfasına hafif fetch atıp `"videoId":"..."` regex'i ile videoyu **300-500ms** içinde bulur.
* **Aşama 2 (Fallback):** Regex bulamazsa `yt-dlp` (`ytsearch1:`) devreye girer.
* **Bölgesel URL Desteği:** `SPOTIFY_RE`, `open.spotify.com/intl-tr/...`, `intl-en/...` formatlarını sorunsuz destekler.

---

## 6. HATA YÖNETİMİ VE KULLANICIYA OTOMATİK DM BİLDİRİMİ

Kullanıcılar müzik dinlerken bir problem oluştuğunda bot bunu sessizce geçiştirmez:

1. **`requestedById` Takibi:** Şarkıyı kuyruğa kim eklediyse (arama, playlist, favoriler veya popüler listesi), kullanıcının Discord ID'si şarkı nesnesinde tutulur.
2. **`lastErrorLog` Hafızası:** `logger()` fonksiyonu sistemde oluşan son `ERROR` veya `WARNING` logunu daima canlı hafızada tutar.
3. **`notifyRequesterAboutError(song, error, context)`:**
   - Şarkı indirilemediğinde, telife takıldığında veya oynatıcı çöktüğünde bot doğrudan **o şarkıyı isteyen kişinin Discord DM kutusuna** şık bir Embed gönderir.
   - Embed içeriğinde: Şarkı adı, linki, hatanın oluştuğu aşama ve **bottaki son sistem hata logu (`bot.log` çıktısı)** yer alır.
   - Kullanıcının DM'i kapalıysa bot çökmez; loga uyarı düşüp sıradaki parçaya geçer.

---

## 7. OTOMATİK KURTARMA VE ÇÖKME KORUMASI (SELF-HEALING)

* **`uncaughtException` Yakalayıcısı:** Beklenmedik kritik bir hata olduğunda çökme nedeni `crash_state.json` içine yazılır ve süreç kontrollü kapatılır (`process.exit(1)`).
* **PM2 Watchdog:** Süreç kapanır kapanmaz PM2 botu 1 saniyede yeniden başlatır.
* **Kurtarma Bildirimi:** Bot açıldığında `crash_state.json` görürse, `active_channels.json` dosyasındaki son aktif metin kanallarına **"🔄 Otomatik Kurtarma Motoru Aktif: Bot beklenmedik bir hatadan kurtarıldı"** embed'i gönderir ve dosyayı siler.

---

## 8. FAVORİ, POPÜLERLİK VE YÖNETİM SİSTEMİ (.kuyruk, .yardım vb.)

Kullanıcıların kendi müzik arşivlerini oluşturması, kuyruğu yönetmesi ve sunucu istatistiklerini izlemesi için optimize edilmiş sistem:

1. **Genişletilmiş Komut Seti:**
   - **`.yardım` / `.help`**: Şık, kategorize edilmiş komut rehberi embed'i.
   - **`.kuyruk` / `.q`**: Sırada bekleyen parçaları, toplam süre ve butonlarla (`Karıştır`, `Kuyruğu Temizle`) listeler.
   - **`.karıştır` / `.shuffle`**: Kuyruktaki parçaları Fisher-Yates algoritmasıyla rastgele karıştırır.
   - **`.temizle` / `.clear`**: Çalan parçayı kesmeden yalnızca sıradaki şarkıları temizler.
   - **`.şarkı` / `.np`**: Çalmakta olan şarkının arayüz panelini sohbete yeniden çağırır.

2. **Otomatik Dinleme Sayımı (`recordGuildPlay`):**
   - Sunucuda herhangi bir parça çalmaya başladığı anda (`triggerPlay`), `music_db.json` içindeki `guilds[guildId]` nesnesinde o parçanın dinlenme sayısı (`count`) otomatik olarak 1 artırılır.
   - Böylece `.popüler` listesi sürekli yaşayan ve dinlenen şarkılarla güncel kalan bir listeye dönüşür.

3. **Top 20 Popüler Listesi (`.popüler` / `.top`):**
   - Sunucunun en çok dinlenen ilk **20 şarkısı** şık bir Embed ile listelenir (1, 2 ve 3. sıralar için 🥇, 🥈, 🥉 madalyaları).
   - Menüden tek tıkla parça seçilebilir veya `Top 20 Oynat` butonuyla tüm liste sıraya eklenebilir.

4. **Favori Komutları (`.favori` / `.fav` / `.listem`):**
   - **`.favori` veya `.fav`:** O an çalan şarkıyı doğrudan kullanıcının kütüphanesine ekler.
   - **`.favori ekle <şarkı / link>`:** Çalan şarkı olmasa bile belirtilen şarkıyı arayıp kütüphaneye ekler.
   - **`.favori sil <sıra no>`:** Kütüphanedeki numaraya göre şarkıyı siler (Örn: `.favori sil 2`).
   - **`.listem`:** Kullanıcının kütüphanesindeki en güncel 20 şarkıyı interaktif seçim menüsü ve `Hepsini Oynat` butonuyla sunar.
   - Kullanıcılar nokta koymadan doğrudan `favori ekle` yazdığında da komut akıllıca algılanır.

5. **Atomik Veritabanı ve Felaket Kurtarma (`atomicWriteJson`):**
   - Veritabanı yazımları önce `.tmp` dosyasına yazılıp atomik olarak taşınır (rename).
   - Her başarılı yazımda `.bak` dosyası güncellenir.
   - Olası bir JSON bozulmasında sistem sıfırlanmak yerine otomatik olarak `.bak` yedeğinden kurtarılır; kullanıcı favorileri ve dinlenme sayıları ASLA kaybolmaz.

6. **15 Saniyelik Stream Watchdog:**
   - Ağ gecikmesi veya telif engelleri sebebiyle `yt-dlp` veya `ffmpeg` ses akışı üretemezse sistem 15 saniye içinde duruma müdahale eder ve bot "Ses akışı hazırlanıyor..." aşamasında sonsuza kadar kilitli kalmaz; kullanıcıya bilgi verip sıradaki parçaya geçer.

---

## 9. BAŞKA BİR AI VEYA GELİŞTİRİCİ İÇİN KURAL VE TALİMATLAR

Gelecekte bu projede bir geliştirme veya hata ayıklama yapacak bir AI şunlara kesinlikle uymalıdır:

1. **Syntax Doğrulaması:** Kod üzerinde yapılan her değişiklikten sonra sunucuya göndermeden önce mutlaka:
   ```bash
   node --check index.js
   ```
   çalıştırılmalı ve syntax hatası olmadığından emin olunmalıdır.
2. **Dağıtım (Deploy):** Değişiklikler yapıldıktan sonra sunucuya yüklemek için mutlaka:
   ```bash
   node deploy.js
   ```
   komutu kullanılmalıdır. Uzak sunucuya manuel FTP/RDP ile dosya atmaya gerek yoktur.
3. **Yedekleme:** Büyük bir özellik eklenmeden veya mimari değiştirilmeden önce `yedek/` klasörü altına tarihli temiz bir kopya alınmalıdır.
4. **Ecosystem ve Dizinler:** `ecosystem.config.js` içindeki `C:\Users\Administrator\...` yolunu değiştirmeyin; o yol uzak sunucu içindir.
5. **Senkron Fonksiyonlardan Kaçının:** Ses boru hattını (`playNext`, `PassThrough`) etkileyecek döngülerde senkron ağır işlemler (blocking I/O) yapmayın.
