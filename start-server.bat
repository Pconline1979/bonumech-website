@echo off
REM Bonumech Uzak Destek - Sunucu baslatici
REM Node.js kurulu olmalidir (https://nodejs.org)
cd /d "%~dp0server"
if not exist node_modules (
  echo Bagimliliklar yukleniyor...
  call npm install
)
echo.
echo Sunucu baslatiliyor -^> http://localhost:8080
echo Tarayicida bu adresi acip ID + sifre ile baglanin.
echo.
call npm start
pause
