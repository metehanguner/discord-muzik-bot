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
const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID     || null;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || null;
const SPOTIFY_RE            = /open\.spotify\.com\/(?:intl-[a-z0-9_-]+\/)?(track|playlist|album)\/([A-Za-z0-9]+)/i;

module.exports = {
    ROOT_DIR,
    DISCORD_TOKEN,
    YTDLP_ASSET,
    YTDLP_PATH,
    COOKIES_PATH,
    LOG_FILE,
    DB_FILE,
    CHANNELS_FILE,
    CRASH_FILE,
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_RE
};
