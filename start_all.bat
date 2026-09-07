@echo off
echo Starting DocDesk servers...

start "DocDesk Server" cmd /k "cd server && npm run dev"
timeout /t 3 /nobreak >nul
start "DocDesk Client" cmd /k "cd client && npm run dev"

echo.
echo Both servers starting in separate windows
echo Server: http://localhost:5000
echo Client: http://localhost:5173
