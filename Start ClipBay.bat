@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist node_modules (
  echo Installiere Abhaengigkeiten...
  call npm install
)
call npm start
