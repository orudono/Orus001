@echo off
rem AURORA launcher for Windows: starts a tiny local web server and opens the player.
rem YouTube embeds need http://localhost (not file://), so use this instead of double-clicking index.html.
cd /d "%~dp0"
set PORT=8765
where py >nul 2>nul && ( start "" http://localhost:%PORT%/index.html & py -m http.server %PORT% & goto :eof )
where python >nul 2>nul && ( start "" http://localhost:%PORT%/index.html & python -m http.server %PORT% & goto :eof )
where npx >nul 2>nul && ( start "" http://localhost:%PORT%/index.html & npx --yes serve -l %PORT% . & goto :eof )
echo.
echo Neither Python nor Node.js was found.
echo Install Python from https://www.python.org/downloads/ (tick "Add python.exe to PATH") and run this file again.
pause
