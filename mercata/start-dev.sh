#!/bin/bash

# Mercata Development Environment Startup Script
# This script starts all components needed for local development

echo "🚀 Starting Mercata Development Environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

# Check if .env file exists in backend
if [ ! -f "backend/.env" ]; then
    echo "⚠️  No .env file found in backend directory."
    echo "📝 Creating .env from .env.example..."
    if [ -f "backend/.env.example" ]; then
        cp backend/.env.example backend/.env
        echo "✅ Created backend/.env - Please update it with your actual values!"
    else
        echo "❌ No .env.example found in backend directory."
        exit 1
    fi
fi

# Load environment variables from backend/.env for Nginx
echo "📋 Loading environment variables..."
# Read .env file line by line to handle special characters and spaces properly
if [ -f backend/.env ]; then
    while IFS='=' read -r key value; do
        # Skip empty lines and comments
        if [[ ! -z "$key" && ! "$key" =~ ^[[:space:]]*# ]]; then
            # Remove leading/trailing whitespace
            key=$(echo "$key" | xargs)
            value=$(echo "$value" | xargs)
            # Export the variable
            export "$key=$value"
        fi
    done < backend/.env
else
    echo "❌ Error: backend/.env file not found!"
    exit 1
fi

# Check for required environment variables
echo "🔍 Checking required environment variables..."
MISSING_VARS=""

# Check critical variables for OAuth
if [ -z "$OAUTH_DISCOVERY_URL" ]; then
    MISSING_VARS="$MISSING_VARS OAUTH_DISCOVERY_URL"
fi
if [ -z "$OAUTH_CLIENT_ID" ]; then
    MISSING_VARS="$MISSING_VARS OAUTH_CLIENT_ID"
fi
if [ -z "$OAUTH_CLIENT_SECRET" ]; then
    MISSING_VARS="$MISSING_VARS OAUTH_CLIENT_SECRET"
fi
if [ -z "$LENDING_REGISTRY" ]; then
    MISSING_VARS="$MISSING_VARS LENDING_REGISTRY"
fi

if [ ! -z "$MISSING_VARS" ]; then
    echo "⚠️  Warning: The following environment variables are missing:$MISSING_VARS"
    echo "📝 Please update your backend/.env file with all required values."
    echo "   You may need to contact your team for the correct values."
fi

# Debug: Show loaded OAuth variables (without secrets)
echo "✅ Loaded OAuth configuration:"
echo "   OAUTH_DISCOVERY_URL: ${OAUTH_DISCOVERY_URL:-NOT SET}"
echo "   OAUTH_CLIENT_ID: ${OAUTH_CLIENT_ID:-NOT SET}"
echo "   OAUTH_CLIENT_SECRET: ${OAUTH_CLIENT_SECRET:+[HIDDEN]}"

# Function to cleanup on exit
cleanup() {
    echo -e "\n🛑 Shutting down services..."
    # Kill backend process
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    # Kill UI process
    if [ ! -z "$UI_PID" ]; then
        kill $UI_PID 2>/dev/null
    fi
    # Stop Nginx container
    cd nginx && docker compose -f docker-compose.nginx-standalone.yml down
    echo "✅ All services stopped."
    exit 0
}

# Set trap for cleanup on script exit
trap cleanup EXIT INT TERM

# Start Backend
echo "📦 Starting Backend API..."
cd backend
npm install
npm run dev &
BACKEND_PID=$!
cd ..
echo "✅ Backend starting on http://localhost:3001"

# Give backend time to start
sleep 5

# Start UI
echo "🎨 Starting Frontend UI..."
cd ui
npm install
npm run dev &
UI_PID=$!
cd ..
echo "✅ UI starting on http://localhost:8080"

# Give UI time to start
sleep 5

# Start Nginx
echo "🔧 Starting Nginx..."
cd nginx

# Detect if running in WSL and set HOST_IP accordingly
if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "🐧 WSL detected - configuring network settings..."
    
    # Fix line endings for shell scripts in WSL
    echo "🔄 Converting line endings for Docker compatibility..."
    for script in *.sh; do
        if [ -f "$script" ]; then
            # Convert CRLF to LF
            sed -i 's/\r$//' "$script" 2>/dev/null || true
        fi
    done
    
    # Get WSL IP address
    WSL_IP=$(ip addr show eth0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
    if [ -z "$WSL_IP" ]; then
        # Fallback method
        WSL_IP=$(hostname -I | awk '{print $1}')
    fi
    echo "📡 Using WSL IP: $WSL_IP"
    
    # Start nginx with all required environment variables
    OAUTH_DISCOVERY_URL="$OAUTH_DISCOVERY_URL" \
    OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID" \
    OAUTH_CLIENT_SECRET="$OAUTH_CLIENT_SECRET" \
    HOST_IP=$WSL_IP \
    docker compose -f docker-compose.nginx-standalone.yml up -d --build
else
    # For native Linux/Mac, use default
    OAUTH_DISCOVERY_URL="$OAUTH_DISCOVERY_URL" \
    OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID" \
    OAUTH_CLIENT_SECRET="$OAUTH_CLIENT_SECRET" \
    docker compose -f docker-compose.nginx-standalone.yml up -d --build
fi

cd ..

# Verify nginx started successfully
echo "🔍 Verifying nginx startup..."
sleep 3
if docker ps | grep -q nginx-nginx-1; then
    # Check if container is actually running (not restarting)
    CONTAINER_STATUS=$(docker ps --filter "name=nginx-nginx-1" --format "{{.Status}}")
    if [[ "$CONTAINER_STATUS" == *"Up"* ]]; then
        echo "✅ Nginx started successfully on http://localhost"
    else
        echo "⚠️  Warning: Nginx container is not stable. Status: $CONTAINER_STATUS"
        echo "📋 Checking nginx logs for errors:"
        docker logs nginx-nginx-1 --tail 10
        echo ""
        echo "💡 Tip: Make sure all OAuth environment variables are set in backend/.env"
    fi
else
    echo "❌ Error: Nginx container failed to start!"
    echo "📋 Checking logs:"
    docker logs nginx-nginx-1 --tail 20 2>&1 || echo "No logs available"
    echo ""
    echo "💡 Common issues:"
    echo "   - Missing OAuth environment variables (OAUTH_CLIENT_SECRET, etc.)"
    echo "   - Port 80 already in use"
    echo "   - Docker networking issues in WSL"
fi

echo -e "\n✨ Mercata Development Environment is running!"
echo "📍 Access the application at: http://localhost"
echo "📍 Backend API at: http://localhost:3001"
echo "📍 Frontend UI at: http://localhost:8080"
echo -e "\n⌨️  Press Ctrl+C to stop all services\n"

# Keep script running
wait