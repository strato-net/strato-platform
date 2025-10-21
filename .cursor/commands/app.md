# App

Start or stop the Mercata application in development mode.

## Command

```bash
set -e

# Navigate to project root
cd /Users/ariya/Documents/BlockApps/strato-platform

# Parse command line arguments
COMMAND=${1:-start}

# Handle stop command
if [ "$COMMAND" = "stop" ]; then
    echo "Stopping Mercata application..."
    
    # Stop nginx container
    echo "Stopping nginx container..."
    cd mercata/nginx
    docker compose -f docker-compose.nginx-standalone.yml stop 2>/dev/null || true
    cd ../..
    
    # Kill backend and UI processes
    echo "Stopping backend and UI processes..."
    pkill -f "ts-node-dev.*src/app.ts" 2>/dev/null || true
    pkill -f "vite.*dev" 2>/dev/null || true
    
    # Force kill processes on ports if still running
    echo "Cleaning up ports..."
    lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    lsof -ti:8080 | xargs kill -9 2>/dev/null || true
    lsof -ti:5173 | xargs kill -9 2>/dev/null || true
    
    echo "✅ App stopped successfully!"
    exit 0
fi

# Start the application
echo "Starting Mercata application..."

# Build shared types package
echo "Building shared types..."
cd mercata/packages/shared-types
npm install --silent
npm run build
cd ../../..

# Setup backend environment
echo "Setting up backend environment..."
cd mercata/backend

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file..."
    cat > .env << 'EOF'
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration
OAUTH_CLIENT_ID=localhost
OAUTH_CLIENT_SECRET=client-secret-here
NODE_URL=https://node5.mercata-testnet.blockapps.net
BASE_URL=http://localhost
POOL_FACTORY=0x100a
LENDING_REGISTRY=0x1007
TOKEN_FACTORY=0x100b
ADMIN_REGISTRY=0x100c
EOF
    echo "Created .env file. Update OAUTH_CLIENT_SECRET with your actual value."
fi

# Start backend service
echo "Starting backend..."
npm install --silent
npm run dev &
BACKEND_PID=$!

# Start UI service
echo "Starting UI..."
cd ../ui
npm install --silent
npm run dev &
UI_PID=$!

# Wait for services to initialize
echo "Waiting for services to start..."
sleep 5

# Start nginx service
echo "Starting nginx..."
cd ../nginx

# Load OAuth configuration from backend .env file
if [ -f "../backend/.env" ]; then
    source ../backend/.env
    echo "Loaded OAuth configuration from backend .env"
else
    echo "Warning: Backend .env not found, using defaults"
    OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration
    OAUTH_CLIENT_ID=localhost
    OAUTH_CLIENT_SECRET=client-secret-here
fi

# Determine nginx container state and start accordingly
CONTAINER_STATUS=$(docker compose -f docker-compose.nginx-standalone.yml ps nginx 2>/dev/null | grep nginx || echo "")

if echo "$CONTAINER_STATUS" | grep -q "Up"; then
    echo "Nginx container already running"
elif echo "$CONTAINER_STATUS" | grep -qE "(Exited|Created)"; then
    echo "Starting existing nginx container..."
    OAUTH_DISCOVERY_URL="$OAUTH_DISCOVERY_URL" \
      OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID" \
      OAUTH_CLIENT_SECRET="$OAUTH_CLIENT_SECRET" \
      ssl=false \
      docker compose -f docker-compose.nginx-standalone.yml start
else
    echo "Building and starting nginx container..."
    OAUTH_DISCOVERY_URL="$OAUTH_DISCOVERY_URL" \
      OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID" \
      OAUTH_CLIENT_SECRET="$OAUTH_CLIENT_SECRET" \
      ssl=false \
      docker compose -f docker-compose.nginx-standalone.yml up -d
fi

# Wait for nginx to initialize
echo "Waiting for nginx to start..."
sleep 3

echo ""
echo "✅ Mercata application started successfully!"
echo ""
echo "🌐 Access the application at: http://localhost"
echo ""
echo "📋 Services running:"
echo "   • Nginx (OAuth): http://localhost (ports 80/443)"
echo "   • Backend API: http://localhost:3001"
echo "   • UI Dev Server: http://localhost:8080"
echo ""
echo "🛑 To stop: /app stop"
```

## Description

This command manages the Mercata application with two modes:

**Start Mode** (`/app` or `/app start`):
- Builds shared types package
- Creates .env file for backend if it doesn't exist
- Starts backend service (Express.js API on port 3001)
- Starts UI service (Vite React dev server on port 8080)
- Starts nginx container with OAuth authentication (ports 80/443)
- Smart container management (reuses existing containers when possible)

**Stop Mode** (`/app stop`):
- Stops nginx Docker container
- Kills backend and UI processes
- Cleans up all ports (3001, 8080, 5173)
- Ensures complete shutdown

**Services**:
- **Backend**: Express.js API server on port 3001
- **UI**: Vite React development server on port 8080
- **Nginx**: OAuth authentication and reverse proxy on port 80/443

**Environment Variables**:
- Backend uses `.env` file in the backend directory
- Nginx reads OAuth credentials from the backend's `.env` file
- Default values are provided if `.env` doesn't exist

**Usage**:
- Start: `/app` or `/app start`
- Stop: `/app stop`