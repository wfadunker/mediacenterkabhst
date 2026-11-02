@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === PERBAIKAN HEADER DAN BANNER PUBLIK HST ===
echo Direktori: %cd%
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js tidak ditemukan. Jalankan dari Terminal Laragon.
  pause
  exit /b 1
)
node fix-public-layout-hst.js
echo.
echo Tekan tombol untuk selesai.
pause
