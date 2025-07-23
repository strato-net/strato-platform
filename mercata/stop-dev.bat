@echo off
REM Mercata Development Environment Shutdown Script for Windows
REM This script stops all components of the local development environment

echo Stopping Mercata Development Environment...

REM Stop Backend (kill node processes on port 3001)
echo Stopping Backend API...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo Backend stopped

REM Stop UI (kill node processes on port 8080)
echo Stopping Frontend UI...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo UI stopped

REM Stop Nginx container
echo Stopping Nginx...
cd nginx
docker compose -f docker-compose.nginx-standalone.yml down
cd ..
echo Nginx stopped

echo.
echo All services have been stopped.
pause