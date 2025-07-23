@echo off
REM Mercata Development Environment Startup Script for Windows
REM This script starts all components needed for local development

echo Starting Mercata Development Environment...

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running. Please start Docker Desktop and try again.
    pause
    exit /b 1
)

REM Check if .env file exists in backend
if not exist "backend\.env" (
    echo WARNING: No .env file found in backend directory.
    echo Creating .env from .env.example...
    if exist "backend\.env.example" (
        copy "backend\.env.example" "backend\.env"
        echo Created backend\.env - Please update it with your actual values!
    ) else (
        echo ERROR: No .env.example found in backend directory.
        pause
        exit /b 1
    )
)

REM Load environment variables from backend\.env
echo Loading environment variables...
for /f "usebackq tokens=1,2 delims==" %%a in ("backend\.env") do (
    if not "%%a"=="" if not "%%a:~0,1%"=="#" (
        set "%%a=%%b"
    )
)

REM Start Backend in new window
echo Starting Backend API...
start "Mercata Backend" /D backend cmd /k "npm install && npm run dev"
echo Backend starting on http://localhost:3001

REM Wait for backend to start
timeout /t 5 /nobreak >nul

REM Start UI in new window
echo Starting Frontend UI...
start "Mercata UI" /D ui cmd /k "npm install && npm run dev"
echo UI starting on http://localhost:8080

REM Wait for UI to start
timeout /t 5 /nobreak >nul

REM Start Nginx
echo Starting Nginx...
cd nginx
docker compose -f docker-compose.nginx-standalone.yml up -d --build
cd ..
echo Nginx started on http://localhost

echo.
echo Mercata Development Environment is running!
echo Access the application at: http://localhost
echo Backend API at: http://localhost:3001
echo Frontend UI at: http://localhost:8080
echo.
echo Close this window and run stop-dev.bat to stop all services
pause