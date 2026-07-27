@echo off
REM Bonumech Uzak Destek - Host (kontrol edilecek makine) baslatici
REM Node.js kurulu olmalidir (https://nodejs.org)

REM Sunucu ayni makinede degilse asagidaki satirin basindaki REM'i kaldirip adresi yazin:
REM set BONUMECH_SERVER=ws://SUNUCU_ADRESI:8080

cd /d "%~dp0host"
if not exist node_modules (
  echo Bagimliliklar yukleniyor... ^(nut.js derlenebilir, biraz surebilir^)
  call npm install
)
echo.
echo Host baslatiliyor... ID ve sifre pencerede gorunecek.
echo.
call npm start
pause
