#!/bin/bash

# Strato API OAuth Nginx Proxy - Quick Start Script

echo "🚀 Starting Strato API OAuth Nginx Proxy..."
echo ""

# Check if strato-api is running
echo "📡 Checking if strato-api is running on port 3000..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ strato-api is running on port 3000"
else
    echo "⚠️  WARNING: strato-api is not responding on port 3000"
    echo "   Please start strato-api first, then run this script again."
    echo ""
    echo "   You can start strato-api from the main strato-platform directory:"
    echo "   cd ../strato/api/strato-api"
    echo "   stack run"
    echo ""
    read -p "Do you want to continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "🔨 Building nginx proxy with OAuth support..."
docker-compose build

echo ""
echo "🚀 Starting nginx proxy..."
docker-compose up -d

echo ""
echo "⏳ Waiting for nginx to be ready..."
sleep 3

# Check if nginx is running
if docker ps | grep -q strato-api-nginx; then
    echo "✅ Nginx proxy is running!"
    echo ""
    echo "🎉 Setup complete!"
    echo ""
    echo "📝 Access your OAuth-protected Swagger UI at:"
    echo "   👉 http://localhost/swagger-ui/"
    echo ""
    echo "   You will be automatically redirected to Keycloak for login."
    echo ""
    echo "📊 Useful commands:"
    echo "   - View logs: docker logs -f strato-api-nginx"
    echo "   - Stop proxy: docker-compose down"
    echo "   - Restart proxy: docker-compose restart"
    echo ""
else
    echo "❌ Failed to start nginx proxy"
    echo "   Check logs with: docker logs strato-api-nginx"
    exit 1
fi
