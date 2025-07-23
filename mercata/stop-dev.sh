#!/bin/bash

# Mercata Development Environment Shutdown Script
# This script stops all components of the local development environment

echo "🛑 Stopping Mercata Development Environment..."

# Stop Backend (find and kill node processes running on port 3001)
echo "📦 Stopping Backend API..."
if lsof -i :3001 > /dev/null 2>&1; then
    kill $(lsof -t -i:3001) 2>/dev/null
    echo "✅ Backend stopped"
else
    echo "ℹ️  Backend was not running"
fi

# Stop UI (find and kill node processes running on port 8080)
echo "🎨 Stopping Frontend UI..."
if lsof -i :8080 > /dev/null 2>&1; then
    kill $(lsof -t -i:8080) 2>/dev/null
    echo "✅ UI stopped"
else
    echo "ℹ️  UI was not running"
fi

# Stop Nginx container
echo "🔧 Stopping Nginx..."
cd nginx 2>/dev/null && docker compose -f docker-compose.nginx-standalone.yml down
echo "✅ Nginx stopped"

echo -e "\n✅ All services have been stopped."