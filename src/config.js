const path = require("path");
const os   = require("os");

const ROOT_DIR = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(ROOT_DIR, ".env") });

// CPU Onceligi: YUKSEK (Ses akisinda sifir jitter / gecikme)
try {
    if (os.constants && os.constants.priority && os.constants.priority.PRIORITY_ABOVE_NORMAL) {
        os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
    }
} catch (_) {}

const YTDLP_ASSET  = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const YTDLP_PATH   = path.join(ROOT_DIR, "bin", YTDLP_ASSET);
const COOKIES_PATH = path.join(ROOT_DIR, "cookies.txt");
const LOG_FILE     = path.join(ROOT_DIR, "bot.log");
const DB_FILE      = path.join(ROOT_DIR, "music_db.json");
const CHANNELS_FILE= path.join(ROOT_DIR, "active_channels.json");
const CRASH_FILE   = path.join(ROOT_DIR, "crash_state.json");

const DISCORD_TOKEN        = process.env.TOKEN || process.env.DISCORD_TOKEN || null;
const TEXT_CHANNEL_ID       = process.env.TEXT_CHANNEL_ID       || null;
const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID     || null;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || null;
const SPOTIFY_RE            = /open\.spotify\.com\/(?:intl-[a-z0-9_-]+\/)?(track|playlist|album)\/([A-Za-z0-9]+)/i;

// Kullanıcı Takip & Arama Konfigürasyonu
const TRACK_USER_ID            = process.env.TRACK_USER_ID || null;
const TRACK_USERNAME           = process.env.TRACK_USERNAME || "f6hako";
const CALLMEBOT_TELEGRAM_USER  = process.env.CALLMEBOT_TELEGRAM_USER || null;
const CALLMEBOT_WHATSAPP_PHONE = process.env.CALLMEBOT_WHATSAPP_PHONE || null;
const CALLMEBOT_WHATSAPP_APIKEY= process.env.CALLMEBOT_WHATSAPP_APIKEY || null;
const TRACK_COOLDOWN_MINUTES   = parseInt(process.env.TRACK_COOLDOWN_MINUTES, 10) || 10;

module.exports = {
    ROOT_DIR,
    DISCORD_TOKEN,
    TEXT_CHANNEL_ID,
    YTDLP_ASSET,
    YTDLP_PATH,
    COOKIES_PATH,
    LOG_FILE,
    DB_FILE,
    CHANNELS_FILE,
    CRASH_FILE,
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_RE,
    TRACK_USER_ID,
    TRACK_USERNAME,
    CALLMEBOT_TELEGRAM_USER,
    CALLMEBOT_WHATSAPP_PHONE,
    CALLMEBOT_WHATSAPP_APIKEY,
    TRACK_COOLDOWN_MINUTES
};

