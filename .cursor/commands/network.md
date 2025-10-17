# Network

Start or stop the STRATO network with optional modes.

## Command

```bash
set -e

# Navigate to project root
cd /Users/ariya/Documents/BlockApps/strato-platform

# Parse command line arguments
COMMAND=${1:-start}
MODE=${2:-}

# Handle stop command
if [ "$COMMAND" = "stop" ]; then
    echo "Stopping STRATO network..."
    
    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        echo "Docker is not running. Nothing to stop."
        exit 0
    fi
    
    if [ "$MODE" = "hard" ]; then
        echo "Performing hard cleanup (nuclear option)..."
        
        # Stop all running containers
        if docker ps -q | grep -q .; then
            docker stop $(docker ps -q) || true
        fi
        
        # Remove all containers
        if docker ps -aq | grep -q .; then
            docker rm $(docker ps -aq) || true
        fi
        
        # Remove STRATO-related images
        docker images --format "{{.Repository}}:{{.Tag}}" | \
            grep -E "(mercata-backend|mercata-ui|smd|apex|strato|postgrest|nginx|mercata-bridge|mercata-nginx|prometheus|swaggerapi|postgres|zookeeper|kafka|redis)" | \
            xargs -r docker rmi -f || true
        
        # Remove dangling images
        docker images -f "dangling=true" -q | xargs -r docker rmi -f || true
        
        # Remove STRATO-related volumes
        docker volume ls -q | grep -E "strato" | xargs -r docker volume rm -f || true
        
        # Remove STRATO-related networks
        docker network ls --format "{{.Name}}" | grep -E "strato" | xargs -r docker network rm || true
        
        # Complete system cleanup
        docker system prune --all --volumes --force || true
        docker builder prune -af || true
        docker buildx prune --all --force || true
        
        # Clean up build artifacts
        find . -maxdepth 3 -type d \( -name "dist*" -o -name ".stack-work" -o -name "node_modules" -o -name "build" \) -exec rm -rf {} + 2>/dev/null || true
        find . -name "*.o" -o -name "*.hi" -o -name "*.chi" -o -name "*.chs.h" | xargs -r rm -f || true
        find . -name "*.log" -o -name "*.tmp" | xargs -r rm -f || true
        
        # Remove generated files
        rm -f docker-compose*.yml bridge_image_tag* stripe_image_tag* || true
        rm -rf app || true
        
        echo "✅ Network stopped and cleaned up (hard mode)."
    else
        echo "Performing light cleanup..."
        # Stop only mercata/strato containers
        docker ps -a --format "{{.Names}}" | grep -E "(mercata|strato)" | xargs -r docker stop || true
        docker ps -a --format "{{.Names}}" | grep -E "(mercata|strato)" | xargs -r docker rm || true
        echo "✅ Mercata containers stopped."
    fi
    
    exit 0
fi

# Start the network
echo "Starting STRATO network..."

# Check for fresh mode
FRESH_MODE=false
if [ "$COMMAND" = "start" ] && [ "$MODE" = "fresh" ]; then
    FRESH_MODE=true
    echo "Fresh mode enabled - will apply Generator.hs changes and wipe data"
fi

# Check and start Docker if needed
if ! docker info >/dev/null 2>&1; then
    if command -v open >/dev/null 2>&1; then
        echo "Starting Docker Desktop..."
        open -a Docker
        sleep 10
        
        # Wait for Docker to be ready
        for i in {1..30}; do
            if docker info >/dev/null 2>&1; then
                break
            fi
            sleep 2
        done
    else
        echo "❌ Error: Docker is not running and cannot be started automatically."
        exit 1
    fi
fi

# Clean up existing containers
echo "Cleaning up existing containers..."
if docker ps -q | grep -q .; then
    docker stop $(docker ps -q) || true
fi
if docker ps -aq | grep -q .; then
    docker rm $(docker ps -aq) || true
fi

# Apply Generator.hs changes if in fresh mode
if [ "$FRESH_MODE" = true ]; then
    echo "Applying Generator.hs changes for fresh mode..."
    cd strato/core/strato-init/src/Blockchain/Init/
    sed -i '' 's/--network=helium/--network=helium_app/g' Generator.hs
    sed -i '' 's/--test_mode_bypass_blockstanbul=false/--test_mode_bypass_blockstanbul=true/g' Generator.hs
    cd /Users/ariya/Documents/BlockApps/strato-platform
fi

# Build the project
echo "Building STRATO network..."
make

# Wipe existing data
if [ -f "./forceWipe" ]; then
    echo "Wiping existing data..."
    ./forceWipe
fi

# Remove app directory if it exists
if [ -d "app" ]; then
    rm -rf app
fi

# Start the network
echo "Starting network services..."
make
./start app &

# Restore Generator.hs to original state if in fresh mode
if [ "$FRESH_MODE" = true ]; then
    echo "Restoring Generator.hs to original state..."
    cd strato/core/strato-init/src/Blockchain/Init/
    sed -i '' 's/--network=helium_app/--network=helium/g' Generator.hs
    sed -i '' 's/--test_mode_bypass_blockstanbul=true/--test_mode_bypass_blockstanbul=false/g' Generator.hs
fi

echo ""
echo "✅ STRATO network started successfully!"
echo ""
echo "📋 Check status with: docker ps"
echo "🛑 To stop: /network stop"
echo "💥 To stop hard: /network stop hard"
```

## Description

This command manages the STRATO network with multiple modes:

**Start Modes**:
- `/network` or `/network start`: Start network normally
- `/network start fresh`: Apply Generator.hs changes, wipe data, and start fresh

**Stop Modes**:
- `/network stop`: Light cleanup - only stop mercata/strato containers
- `/network stop hard`: Complete nuclear cleanup including images, volumes, build cache

**Start Features**:
- Checks and starts Docker Desktop if needed
- Stops and removes all running containers
- Builds the project with `make`
- Wipes existing data with `./forceWipe`
- Starts network services in background
- Fresh mode temporarily applies Generator.hs changes

**Stop Features**:
- **Light mode**: Only stops mercata/strato containers
- **Hard mode**: Complete cleanup of containers, images, volumes, build cache, and files

**Usage**:
- Start: `/network` or `/network start`
- Start fresh: `/network start fresh`
- Stop: `/network stop`
- Stop hard: `/network stop hard`