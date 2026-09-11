const fs = require("fs");
const path = require("path");
const fetch = require("isomorphic-unfetch");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const {
    YTDLP_PATH,
    YTDLP_ASSET,
    COOKIES_PATH,
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_RE
} = require("./config");

const {
    logger,
    extractUserInfo,
    parseDurationSec,
    formatDurationSec
} = require("./logger");

// ============================================================
//  YT-DLP OTOMATİK KURULUM VE GÜNCELLEME
// ============================================================
async function ensureYtDlp() {
    if (fs.existsSync(YTDLP_PATH)) {
        logger(`[YT-DLP] Motor mevcut: ${YTDLP_PATH}`, "INFO");
        return;
    }
    logger("[YT-DLP] Motor bulunamadi, indiriliyor...", "SYSTEM");
    fs.mkdirSync(path.dirname(YTDLP_PATH), { recursive: true });
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}`;
    logger(`[YT-DLP] Indirme URL: ${url}`, "DEBUG");
    const res = await fetch(url);
    fs.writeFileSync(YTDLP_PATH, Buffer.from(await res.arrayBuffer()));
    if (process.platform !== "win32") fs.chmodSync(YTDLP_PATH, 0o755);
    logger("[YT-DLP] Motor basariyla kuruldu.", "SYSTEM");
}

// ============================================================
//  SPOTIFY ENTEGRASYONU  |  Client Credentials Flow
// ============================================================
let _spotifyToken    = null;
let _spotifyTokenExp = 0;

async function getSpotifyToken() {
    if (_spotifyToken && Date.now() < _spotifyTokenExp) return _spotifyToken;
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        throw new Error("SPOTIFY_CLIENT_ID veya SPOTIFY_CLIENT_SECRET .env dosyasinda tanimli degil.");
    }
    const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
    const res   = await fetch("https://accounts.spotify.com/api/token", {
        method:  "POST",
        headers: { "Authorization": `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
        body:    "grant_type=client_credentials"
    });
    if (!res.ok) throw new Error(`Spotify token alinamadi: ${res.status} ${res.statusText}`);
    const data       = await res.json();
    _spotifyToken    = data.access_token;
    _spotifyTokenExp = Date.now() + (data.expires_in - 60) * 1000;
    logger(`[SPOTIFY] Yeni access token alindi. Gecerlilik: ${data.expires_in}s`, "DEBUG");
    return _spotifyToken;
}

// Spotify Embed sayfasından şarkı listesini çeker (Editoryal 403 kısıtlamalarına takılmaz)
async function fetchSpotifyEmbed(type, id) {
    const url = `https://open.spotify.com/embed/${type}/${id}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
        }
    });
    if (!res.ok) throw new Error(`Spotify embed HTTP hatasi: ${res.status}`);
    const html = await res.text();
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!nextMatch) throw new Error("Spotify embed verisi alinamadi.");
    const json = JSON.parse(nextMatch[1]);
    const entity = json.props?.pageProps?.state?.data?.entity;
    if (!entity) throw new Error("Spotify entity verisi bulunamadi.");

    if (type === "track") {
        const title = entity.title || entity.name || "Spotify Track";
        const artist = entity.subtitle || (entity.artists ? entity.artists.map(a => a.name).join(", ") : "Bilinmiyor");
        const durationSec = Math.round((entity.duration || 0) / 1000);
        return {
            title,
            tracks: [{ title, artist, durationSec }]
        };
    }

    const title = entity.title || entity.name || (type === "album" ? "Spotify Albüm" : "Spotify Playlist");
    const trackList = entity.trackList || [];
    const tracks = trackList.map(t => {
        const tTitle = t.title || "Bilinmiyor";
        const tArtist = t.subtitle || (t.artists ? t.artists.map(a => a.name).join(", ") : "");
        const tDurationSec = Math.round((t.duration || 0) / 1000);
        return { title: tTitle, artist: tArtist, durationSec: tDurationSec };
    });

    return { title, tracks };
}

// Spotify'dan alınan şarkıyı YouTube'da 2 aşamalı (hızlı fetch + yt-dlp fallback) ara
async function searchYouTubeForTrack(title, artist, user, durationSec = 0) {
    const query = artist ? `${artist} - ${title}` : title;
    const userInfo = extractUserInfo(user);
    const hasCookies = fs.existsSync(COOKIES_PATH);

    // 1) Hizli deneme: YouTube HTML kazima (~200ms)
    try {
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const res = await fetch(searchUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
            }
        });
        if (res.ok) {
            const html = await res.text();
            const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            if (match && match[1]) {
                const videoId = match[1];
                const durStr = durationSec > 0 ? formatDurationSec(durationSec) : "Bilinmiyor";
                return {
                    title:         query,
                    url:           `https://youtube.com/watch?v=${videoId}`,
                    requestedBy:   userInfo.name,
                    requestedById: userInfo.id,
                    duration:      durStr,
                    durationSec:   durationSec || 0,
                    uploader:      artist || "YouTube",
                    isLive:        false
                };
            }
        }
    } catch (_) {}

    // 2) Fallback: yt-dlp ile arama (Cookies desteği ile)
    const args = [
        "--js-runtimes", "node",
        ...(hasCookies ? ["--cookies", COOKIES_PATH] : []),
        `ytsearch1:${query}`,
        "--dump-json",
        "--flat-playlist",
        "-q",
        "--no-warnings"
    ];

    try {
        const { stdout } = await execFileAsync(YTDLP_PATH, args, { maxBuffer: 10 * 1024 * 1024, timeout: 20000 });
        const line = stdout.trim().split("\n")[0];
        if (!line) return null;
        let v;
        try { v = JSON.parse(line); } catch (_) { return null; }
        if (!v || !v.id) return null;
        return {
            title:         query,
            url:           `https://youtube.com/watch?v=${v.id}`,
            requestedBy:   userInfo.name,
            requestedById: userInfo.id,
            duration:      v.duration_string || (durationSec > 0 ? formatDurationSec(durationSec) : "Bilinmiyor"),
            durationSec:   parseDurationSec(v.duration, v.duration_string) || durationSec || 0,
            uploader:      artist || v.uploader || "Bilinmiyor",
            isLive:        false
        };
    } catch (e) {
        logger(`[SPOTIFY] YouTube arama hatasi: ${e.message} | Sorgu: "${query}"`, "WARNING");
        return null;
    }
}

async function resolveSpotify(url, user) {
    const match = url.match(SPOTIFY_RE);
    if (!match) throw new Error("Gecersiz Spotify URL'si.");
    const [, type, id] = match;
    logger(`[SPOTIFY] Tur: ${type} | ID: ${id} | Kullanici: ${user}`, "INFO");

    // 1) Tek Parca (track)
    if (type === "track") {
        let title = null;
        let artist = null;
        let durationSec = 0;

        try {
            const token = await getSpotifyToken();
            const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                title = data.name;
                artist = (data.artists || []).map(a => a.name).join(", ");
                durationSec = Math.round((data.duration_ms || 0) / 1000);
            }
        } catch (_) {}

        if (!title) {
            const embedData = await fetchSpotifyEmbed("track", id);
            title = embedData.title;
            artist = embedData.tracks[0]?.artist || "Bilinmiyor";
            durationSec = embedData.tracks[0]?.durationSec || 0;
        }

        logger(`[SPOTIFY] Track: "${artist} - ${title}" (${durationSec}s)`, "INFO");
        const song = await searchYouTubeForTrack(title, artist, user, durationSec);
        if (!song) throw new Error(`YouTube'da bulunamadi: "${artist} - ${title}"`);
        return [song];
    }

    // 2) Playlist veya Album
    let playlistTitle = type === "album" ? "Spotify Albüm" : "Spotify Playlist";
    let rawTracks = [];
    let apiSuccess = false;

    try {
        const token = await getSpotifyToken();
        const headers = { "Authorization": `Bearer ${token}` };

        if (type === "playlist") {
            try {
                const plRes = await fetch(`https://api.spotify.com/v1/playlists/${id}?fields=name`, { headers });
                if (plRes.ok) { const d = await plRes.json(); playlistTitle = d.name || playlistTitle; }
            } catch (_) {}

            let nextUrl = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=50&fields=next,items(track(name,artists,duration_ms))`;
            while (nextUrl && rawTracks.length < 100) {
                const res = await fetch(nextUrl, { headers });
                if (!res.ok) {
                    if (res.status === 403) {
                        logger(`[SPOTIFY] 403 alindi (editoryal playlist), embed scraper'a geciliyor...`, "INFO");
                        break;
                    }
                    throw new Error(`Spotify API hatasi: ${res.status}`);
                }
                const data = await res.json();
                for (const item of (data.items || [])) {
                    const t = item && item.track;
                    if (!t || !t.name) continue;
                    rawTracks.push({
                        title: t.name,
                        artist: (t.artists || []).map(a => a.name).join(", "),
                        durationSec: Math.round((t.duration_ms || 0) / 1000)
                    });
                }
                nextUrl = data.next || null;
            }
            if (rawTracks.length > 0) apiSuccess = true;

        } else if (type === "album") {
            try {
                const aRes = await fetch(`https://api.spotify.com/v1/albums/${id}`, { headers });
                if (aRes.ok) { const d = await aRes.json(); playlistTitle = d.name || playlistTitle; }
            } catch (_) {}
            const res = await fetch(`https://api.spotify.com/v1/albums/${id}/tracks?limit=50`, { headers });
            if (res.ok) {
                const data = await res.json();
                rawTracks = (data.items || []).map(t => ({
                    title: t.name,
                    artist: (t.artists || []).map(a => a.name).join(", "),
                    durationSec: Math.round((t.duration_ms || 0) / 1000)
                }));
                if (rawTracks.length > 0) apiSuccess = true;
            }
        }
    } catch (e) {
        logger(`[SPOTIFY] API denemesi basarisiz (${e.message}), embed scraper kullanilacak...`, "WARNING");
    }

    if (!apiSuccess || rawTracks.length === 0) {
        logger(`[SPOTIFY] Embed Scraper ile sarki listesi cekiliyor: ${type}/${id}`, "INFO");
        const embedData = await fetchSpotifyEmbed(type, id);
        playlistTitle = embedData.title || playlistTitle;
        rawTracks = embedData.tracks;
    }

    if (!rawTracks || rawTracks.length === 0) {
        throw new Error(`Spotify listesinden sarki alinamadi: ${url}`);
    }

    logger(`[SPOTIFY] "${playlistTitle}" icin ${rawTracks.length} parca bulundu. YouTube'da eslestiriliyor...`, "INFO");

    const targets = rawTracks.slice(0, 50);
    const songs = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const chunk = targets.slice(i, i + BATCH_SIZE);
        const chunkResults = await Promise.all(
            chunk.map(t => searchYouTubeForTrack(t.title, t.artist, user, t.durationSec))
        );
        for (const s of chunkResults) {
            if (s) songs.push(s);
        }
    }

    logger(`[SPOTIFY] "${playlistTitle}" tamamlandi: ${songs.length}/${targets.length} sarki YouTube'da eslestirildi.`, "INFO");

    if (songs.length === 0) {
        throw new Error(`"${playlistTitle}" listesindeki sarkilar YouTube'da bulunamadi.`);
    }

    return { type: "playlist", title: playlistTitle, tracks: songs };
}

// ============================================================
//  ANA ÇÖZÜMLEME FONKSİYONU (YouTube / Spotify / Playlist)
// ============================================================
async function resolve(query, user) {
    const userInfo = extractUserInfo(user);
    const isUrl = query.startsWith("http");
    const hasCookies = fs.existsSync(COOKIES_PATH);

    // --- Spotify URL tespiti ---
    if (isUrl && SPOTIFY_RE.test(query)) {
        logger(`[RESOLVE] Spotify URL tespit edildi: "${query}" | Isteyen: ${userInfo.name} (${userInfo.id || "—"})`, "INFO");
        return resolveSpotify(query, user);
    }

    const isPlaylistUrl = isUrl && (query.includes("playlist?list=") || query.includes("&list=") || query.includes("?list="));
    const queryType = isPlaylistUrl ? "PLAYLIST_URL" : isUrl ? "DIRECT_URL" : "SEARCH";
    logger(`[RESOLVE] Tur: ${queryType} | Sorgu: "${query}" | Cookies: ${hasCookies ? "VAR" : "YOK"} | Isteyen: ${userInfo.name}`, "INFO");

    const baseFlags = [
        "--js-runtimes", "node",
        ...(hasCookies ? ["--cookies", COOKIES_PATH] : []),
        "--no-check-certificates",
        "--socket-timeout", "20"
    ];

    let args;
    if (isPlaylistUrl) {
        args = [...baseFlags, query, "--dump-single-json", "--flat-playlist", "--yes-playlist", "--playlist-end", "50"];
    } else if (isUrl) {
        args = [...baseFlags, query, "--dump-single-json", "--no-playlist"];
    } else {
        args = [...baseFlags, `ytsearch10:${query}`, "--dump-json", "--flat-playlist"];
    }

    logger(`[RESOLVE] yt-dlp calistiriliyor...`, "DEBUG");
    const startTime = Date.now();
    const { stdout } = await execFileAsync(YTDLP_PATH, args, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30000
    });
    const elapsed = Date.now() - startTime;
    logger(`[RESOLVE] yt-dlp yanit suresi: ${elapsed}ms | Veri boyutu: ${(stdout.length / 1024).toFixed(1)}KB`, "DEBUG");

    if (!isUrl) {
        const results = stdout.trim().split("\n").filter(Boolean).map(l => {
            try {
                const v = JSON.parse(l);
                if (!v || !v.id) return null;
                return {
                    title:         v.title || "Bilinmiyor",
                    url:           `https://youtube.com/watch?v=${v.id}`,
                    requestedBy:   userInfo.name,
                    requestedById: userInfo.id,
                    duration:      v.is_live ? "🔴 CANLI" : (v.duration_string || "Bilinmiyor"),
                    durationSec:   v.is_live ? 0 : parseDurationSec(v.duration, v.duration_string),
                    uploader:      v.uploader || "Bilinmiyor",
                    isLive:        !!v.is_live
                };
            } catch (parseErr) {
                logger(`[RESOLVE] JSON parse hatasi, satir atlandi: ${parseErr.message}`, "WARNING");
                return null;
            }
        }).filter(Boolean);
        logger(`[RESOLVE] Arama sonuclari: ${results.length} video bulundu. Ilk: "${results[0] ? results[0].title : "—"}"`, "INFO");
        return results;
    }

    let data;
    try {
        data = JSON.parse(stdout);
    } catch (parseErr) {
        logger(`[RESOLVE] Ana JSON parse hatasi: ${parseErr.message} | stdout baslangici: ${stdout.substring(0, 200)}`, "ERROR");
        throw new Error("yt-dlp gecersiz JSON donurdu. Lutfen tekrar deneyin.");
    }
    if (data.entries && Array.isArray(data.entries) && data.entries.length > 0) {
        const tracks = data.entries
            .filter(e => e && (e.id || e.url))
            .map(e => {
                const trackUrl = e.url && e.url.startsWith("http") ? e.url : (e.id ? `https://youtube.com/watch?v=${e.id}` : query);
                return {
                    title:         e.title || "Bilinmeyen Sarki",
                    url:           trackUrl,
                    requestedBy:   userInfo.name,
                    requestedById: userInfo.id,
                    duration:      e.is_live ? "🔴 CANLI" : (e.duration_string || (e.duration ? `${Math.floor(e.duration / 60)}:${String(Math.floor(e.duration % 60)).padStart(2, "0")}` : "00:00")),
                    durationSec:   e.is_live ? 0 : parseDurationSec(e.duration, e.duration_string),
                    uploader:      e.uploader || e.channel || "Bilinmiyor",
                    isLive:        !!e.is_live
                };
            });
        const final = tracks.slice(0, 200);
        logger(`[RESOLVE] Playlist: "${data.title}" -> ${data.entries.length} toplam, ${final.length} yuklendi`, "INFO");
        return { type: "playlist", title: data.title || "YouTube Calma Listesi", tracks: final };
    }

    const song = {
        title:         data.title || "Bilinmeyen Sarki",
        url:           query,
        requestedBy:   userInfo.name,
        requestedById: userInfo.id,
        duration:      data.is_live ? "🔴 CANLI" : (data.duration_string || "00:00"),
        durationSec:   data.is_live ? 0 : parseDurationSec(data.duration, data.duration_string),
        uploader:      data.uploader || "Bilinmiyor",
        isLive:        !!data.is_live
    };
    logger(`[RESOLVE] Tekil parca cozumlendi: "${song.title}" | Sure: ${song.duration}`, "INFO");
    return [song];
}

module.exports = {
    ensureYtDlp,
    getSpotifyToken,
    fetchSpotifyEmbed,
    resolveSpotify,
    resolve
};
