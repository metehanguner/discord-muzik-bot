@echo off
chcp 65001 >nul
title AdMeliora Music - Canlı Kontrol Paneli
color 0B

echo ================================================================
echo   ADMELLORA MUSIC BOT - CANLI MONITOR VE KONTROL PANELI
echo   Uzak Sunucu (89.47.113.220) Canlı Log ve Akış İzleyici
echo ================================================================
echo.
echo   [1/2] Panel sunucusu başlatılıyor (Port: 3333)...
echo   [2/2] Tarayıcı açılıyor...
echo.

cd /d "%~dp0"

start "" http://localhost:3333

node monitor_server.js

pause
