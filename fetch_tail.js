const path = require("path");
const { Client } = require("ssh2");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const conn = new Client();
conn.on("error", (e) => { 
    if (e.code === "ECONNRESET") return;
    console.error("SSH error:", e.message); 
    process.exit(1); 
});
conn.on("ready", () => {
    conn.exec("powershell -Command \"Get-Content C:\\Users\\Administrator\\Desktop\\muzik-botu\\muzik-botu\\bot.log -Tail 80\"", (err, stream) => {
        if (err) { console.error(err); process.exit(1); }
        stream.on("data", d => process.stdout.write(d.toString()));
        stream.on("close", () => { conn.end(); process.exit(0); });
    });
}).connect({ 
    host: process.env.SSH_HOST || "89.47.113.220", 
    port: parseInt(process.env.SSH_PORT) || 22, 
    username: process.env.SSH_USER || "Administrator", 
    password: process.env.SSH_PASSWORD || "" 
});
