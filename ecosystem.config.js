module.exports = {
  apps: [{
    name: "muzik-botu",
    script: "index.js",
    cwd: "C:\\Users\\Administrator\\Desktop\\muzik-botu\\muzik-botu",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "600M",
    restart_delay: 3000,
    windowsHide: true,
    env: {
      NODE_ENV: "production"
    }
  }]
};
