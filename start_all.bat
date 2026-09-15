@echo off
echo Starting DocDesk...
echo.

echo [1/3] Checking server dependencies...
cd server
if not exist "node_modules\" (
    echo   Installing server packages, this may take a minute...
    call npm install
)

echo [2/3] Preparing database...
call npm run migrate
if errorlevel 1 (
    echo.
    echo   Database setup failed. Nothing was started.
    cd ..
    pause
    exit /b 1
)
cd ..

echo [3/3] Checking web app dependencies...
cd client
if not exist "node_modules\" (
    echo   Installing web app packages, this may take a minute...
    call npm install
)
cd ..

start "DocDesk Server" cmd /k "cd server && npm run dev"
timeout /t 3 /nobreak >nul
start "DocDesk Web App" cmd /k "cd client && npm run dev"

echo.
echo DocDesk is starting in two new windows.
echo   Open this in your browser:  http://localhost:5173
echo.
echo Closing those two windows stops DocDesk.
