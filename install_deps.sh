#!/usr/bin/env sh

#------------------------------------------------------------------------------
# Bash script for installing pre-requisite packages for building the full
# STRATO Mercata platform on Linux, macOS and other UNIX-derived platforms.
#
# This is an "infrastucture-as-code" alternative to the manual build
# instructions pages which we previously maintained at the public website:
#
# https://docs.stratomercata.com/
#
# ... and for instructions within the strato-platform repository while it was
# still a private repository, and the public strato-getting-started repository
# was still necessary.
#
# See "How can I reliably get the operating system's name?"
# http://unix.stackexchange.com/questions/92199/how-can-i-reliably-get-the-operating-systems-name
#------------------------------------------------------------------------------

set -e

# Function to handle unsupported platforms
unsupported_platform() {
    echo "STRATO Mercata is not supported on $1."
    exit 1
}

# Function to get package version for the current distro
# Usage: get_package_version "package_name"
get_package_version() {
    local package_name="$1"
    local version=""
    
    case $(uname -s) in
        Darwin)
            # macOS - use Homebrew
            if command -v brew > /dev/null 2>&1; then
                version=$(brew list --versions "$package_name" 2>/dev/null | awk '{print $2}' | head -1)
            fi
            ;;
        Linux)
            if [ -f "/etc/os-release" ]; then
                DISTRO_NAME=$(. /etc/os-release; echo $NAME)
                case $DISTRO_NAME in
                    "Amazon Linux"*)
                        # Amazon Linux - use dnf/rpm
                        version=$(rpm -q --queryformat '%{VERSION}-%{RELEASE}' "$package_name" 2>/dev/null | head -1)
                        if [ "$?" -ne 0 ]; then
                            version=""
                        fi
                        ;;
                    Ubuntu|"Linux Mint")
                        # Ubuntu/Mint - use dpkg
                        version=$(dpkg-query -W -f='${Version}' "$package_name" 2>/dev/null)
                        if [ "$?" -ne 0 ]; then
                            version=""
                        fi
                        ;;
                esac
            fi
            ;;
    esac
    
    echo "$version"
}

# Function to display package name and version
# Usage: show_package_version "package_name"
show_package_version() {
    local package_name="$1"
    local version=$(get_package_version "$package_name")
    
    if [ -n "$version" ]; then
        echo "$package_name=$version"
    else
        echo "$package_name=not_installed"
    fi
}

# Function to check package version against expected version for specific distro
# Usage: check_package_version "distro_name" "package_name" "expected_version"
check_package_version() {
    local distro_name="$1"
    local package_name="$2"
    local expected_version="$3"
    local current_distro=""
    
    # Determine current distro
    case $(uname -s) in
        Darwin)
            current_distro="macos"
            ;;
        Linux)
            if [ -f "/etc/os-release" ]; then
                DISTRO_NAME=$(. /etc/os-release; echo $NAME)
                case $DISTRO_NAME in
                    "Amazon Linux"*)
                        current_distro="amazon"
                        ;;
                    Ubuntu)
                        current_distro="ubuntu"
                        ;;
                    "Linux Mint")
                        current_distro="mint"
                        ;;
                esac
            fi
            ;;
    esac
    
    # Only run check if distro matches
    if [ "$distro_name" = "ubuntu-or-mint" ]; then
        if [ "$current_distro" != "ubuntu" ] && [ "$current_distro" != "mint" ]; then
            return 0
        fi
    elif [ "$distro_name" != "$current_distro" ]; then
        return 0
    fi
    
    local actual_version=$(get_package_version "$package_name")
    
    if [ -z "$actual_version" ]; then
        echo "ERROR - Package $package_name is not installed"
        exit 1
    fi
    
    if [ "$actual_version" != "$expected_version" ]; then
        echo "ERROR - Version mismatch for $package_name:"
        echo "  Expected: $expected_version"
        echo "  Actual:   $actual_version"
        exit 1
    fi
    
    echo "✓ $package_name version $actual_version matches expected version"
}

case $(uname -s) in

#------------------------------------------------------------------------------
# macOS
#------------------------------------------------------------------------------

Darwin)
    # Check macOS version constraints - only allow Sequoia
    MACOS_VERSION=$(sw_vers -productVersion)
    MACOS_MAJOR=$(echo $MACOS_VERSION | cut -d. -f1)
    if [ "$MACOS_MAJOR" != "15" ]; then
        echo "ERROR - STRATO Mercata only supports macOS Sequoia (15.x)."
        echo "Your macOS version: $MACOS_VERSION"
        exit 1
    fi
    
    echo "Installing STRATO Mercata dependencies on macOS Sequoia $MACOS_VERSION."
    
    # Install Homebrew if not already installed (non-interactive, safe to run repeatedly)
    if ! command -v brew > /dev/null 2>&1; then
        echo "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" < /dev/null
        
        # Add Homebrew to PATH for the current session
        if [[ $(uname -m) == "arm64" ]]; then
            # Apple Silicon Mac
            eval "$(/opt/homebrew/bin/brew shellenv)"
        else
            # Intel Mac
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    else
        echo "Homebrew is already installed."
    fi

    # Install git
    brew install --quiet git
    
    # Install Docker - detect if GUI is available or if this is headless
    if [ -n "$SSH_CONNECTION" ] || [ -n "$SSH_CLIENT" ] || [ -z "$DISPLAY" ] || ! command -v osascript >/dev/null 2>&1; then
        # Headless environment - use Colima
        echo "Detected headless environment. Installing Docker Engine with Colima..."
        
        # Check if Docker Desktop is already installed and warn
        if [ -d "/Applications/Docker.app" ]; then
            echo "⚠ Warning: Docker Desktop is installed but this appears to be a headless environment."
            echo "⚠ Colima and Docker Desktop can conflict. Consider uninstalling Docker Desktop if you encounter issues."
        fi
        
        brew install --quiet docker docker-compose colima
        
        # Ensure Docker is linked (in case it was installed but not linked)
        brew link --overwrite docker 2>/dev/null || true
        
        # Ensure Docker CLI is available in PATH
        if [[ $(uname -m) == "arm64" ]]; then
            # Apple Silicon Mac
            export PATH="/opt/homebrew/bin:$PATH"
        else
            # Intel Mac
            export PATH="/usr/local/bin:$PATH"
        fi
        
        # Verify Docker CLI is installed before starting Colima
        if ! command -v docker >/dev/null 2>&1; then
            echo "⚠ Docker CLI not found in PATH. Refreshing shell environment..."
            # Reload Homebrew environment
            if [[ $(uname -m) == "arm64" ]]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            else
                eval "$(/usr/local/bin/brew shellenv)"
            fi
            
            # Try linking Docker again if still not found
            if ! command -v docker >/dev/null 2>&1; then
                echo "Attempting to link Docker..."
                brew link --overwrite docker
            fi
        fi
        
        # Start Colima (Docker runtime for headless systems)
        echo "Starting Colima Docker runtime..."
        colima start --cpu 2 --memory 4 --disk 60
        
        # Wait for Docker daemon to be ready
        echo "Waiting for Docker daemon to start..."
        timeout=60
        while [ $timeout -gt 0 ] && ! docker info >/dev/null 2>&1; do
            echo "Still waiting for Docker... ($timeout seconds remaining)"
            sleep 5
            timeout=$((timeout-5))
        done
        
        if docker info >/dev/null 2>&1; then
            echo "✓ Docker is now running via Colima"
            echo "Docker version: $(docker --version)"
            echo "Docker Compose version: $(docker-compose --version)"
        else
            echo "⚠ Docker failed to start. You may need to run 'colima start' manually."
        fi
    else
        # GUI environment - use Docker Desktop
        echo "Detected GUI environment. Installing Docker Desktop..."
        
        # Check if Colima is running and warn
        if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
            echo "⚠ Warning: Colima is currently running. Docker Desktop and Colima can conflict."
            echo "⚠ Consider stopping Colima with 'colima stop' before using Docker Desktop."
        fi
        
        brew install --quiet --cask docker
        echo "✓ Docker Desktop installed. Please start it manually from Applications or Launchpad."
        echo "Note: Docker Desktop requires manual startup and may need permissions approval."
    fi
    
    # Install Haskell Stack
    brew install --quiet haskell-stack

    # Install STRATO dependencies
    brew install --quiet \
        leveldb \
        libpq \
        libsodium \
        pkgconf \
        secp256k1 \
        xz

    # Add libpq to PATH so pg_config can be found
    # This is needed for Haskell packages that depend on PostgreSQL
    if [[ $(uname -m) == "arm64" ]]; then
        # Apple Silicon Mac
        LIBPQ_PATH="/opt/homebrew/opt/libpq/bin"
    else
        # Intel Mac
        LIBPQ_PATH="/usr/local/opt/libpq/bin"
    fi
    
    # Detect shell and set appropriate profile
    SHELL_PROFILE=""
    if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ] || [ "$SHELL" = "/usr/bin/zsh" ]; then
        SHELL_PROFILE="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ] || [ "$SHELL" = "/usr/bin/bash" ]; then
        SHELL_PROFILE="$HOME/.bash_profile"
    else
        # Default to zsh on macOS (default since Catalina)
        SHELL_PROFILE="$HOME/.zshrc"
    fi
    
    # Create shell profile if it doesn't exist
    if [ ! -f "$SHELL_PROFILE" ]; then
        touch "$SHELL_PROFILE"
        echo "Created $SHELL_PROFILE"
    fi
    
    # Add to shell profile if not already present
    if ! grep -q "libpq/bin" "$SHELL_PROFILE"; then
        sudo echo "export PATH=\"$LIBPQ_PATH:\$PATH\"" >> "$SHELL_PROFILE"
        echo "Added libpq to PATH in $SHELL_PROFILE"
    else
        echo "libpq PATH already configured in $SHELL_PROFILE"
    fi
    
    # Source the profile to make pg_config available immediately
    if [ -f "$SHELL_PROFILE" ]; then
        # Export the PATH for the current session
        export PATH="$LIBPQ_PATH:$PATH"
        echo "libpq PATH activated for current session"
        
        # Verify pg_config is now available
        if command -v pg_config > /dev/null 2>&1; then
            echo "✓ pg_config is now available: $(which pg_config)"
            echo "✓ pg_config version: $(pg_config --version)"
        else
            echo "⚠ pg_config still not found. You may need to restart your terminal."
        fi
    fi
    ;;

Linux)
    if [ -f "/etc/os-release" ]; then
        DISTRO_NAME=$(. /etc/os-release; echo $NAME)
        case $DISTRO_NAME in

        "Amazon Linux"*)
            # Check Amazon Linux version constraints - only allow 2023
            AMAZON_VERSION=$(. /etc/os-release; echo $VERSION_ID)
            case $AMAZON_VERSION in
                2023|2023.*)
                    echo "Installing STRATO Mercata dependencies on Amazon Linux $AMAZON_VERSION."
                    ;;
                *)
                    echo "ERROR - STRATO Mercata only supports Amazon Linux 2023 (initial release or point releases)."
                    echo "Your Amazon Linux version: $AMAZON_VERSION"
                    exit 1
                    ;;
            esac
            
            # Install git
            sudo dnf update -q -y
            sudo dnf install -q -y git
            
            # Install Docker
            sudo dnf install -q -y docker
            sudo systemctl enable docker
            sudo systemctl start docker
            # Docker-compose
            DOCKER_CONFIG=/usr/local/lib/docker
            sudo mkdir -p $DOCKER_CONFIG/cli-plugins
            sudo curl -SL https://github.com/docker/compose/releases/download/v2.36.0/docker-compose-linux-x86_64 -o $DOCKER_CONFIG/cli-plugins/docker-compose
            sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
            
            # Install Haskell Stack
            sudo dnf install -q -y \
                gcc \
                gcc-c++ \
                gmp-devel \
                ncurses-devel \
                zlib-devel
            curl -sSL https://get.haskellstack.org/ | sh -s - -f
            
            # Install STRATO dependencies
            sudo dnf install -q -y \
                libsodium-devel \
                postgresql15 \
                postgresql-devel \
                xz-devel
            
            # Build leveldb (not available in Amazon Linux 2023 repositories)
            sudo dnf install -q -y snappy-devel
            git clone --branch v1.20 --recurse-submodules https://github.com/google/leveldb.git
            cd leveldb
            make
            sudo mkdir -p /usr/local/include/leveldb
            sudo cp -r include/leveldb/* /usr/local/include/leveldb/
            sudo cp out-shared/libleveldb.* /usr/local/lib/
            sudo cp out-static/libleveldb.a /usr/local/lib/
            sudo cp /usr/local/lib/libleveldb.so.1 /lib64
            cd ..
            rm -rf leveldb
            
            # Build secp256k1 (not available in Amazon Linux 2023 repositories)
            sudo dnf install -y autoconf libtool make
            git clone --branch v0.7.0 https://github.com/bitcoin-core/secp256k1.git
            cd secp256k1
            ./autogen.sh
            ./configure --enable-module-recovery --enable-experimental --enable-module-ecdh
            make
            sudo make install
            # Need to copy to /usr/share/pkgconfig for pkg-config to find it.
            # To check where the library was installed: `sudo find /usr -name "libsecp256k1.pc" 2>/dev/null`
            # To check the pkgconfig paths: `pkg-config --variable pc_path pkg-config`
            sudo cp /usr/local/lib/pkgconfig/libsecp256k1.pc /usr/share/pkgconfig/
            sudo cp /usr/local/lib/libsecp256k1.so.6 /lib64
            cd ..
            rm -rf secp256k1

            # Update library cache
            sudo ldconfig
            
            ;;

        Ubuntu|"Linux Mint")
            # Check Ubuntu version constraints - only allow 24.04 LTS "Noble Numbat"
            if [ "$DISTRO_NAME" = "Ubuntu" ]; then
                UBUNTU_VERSION=$(lsb_release -rs)
                UBUNTU_CODENAME=$(lsb_release -cs)
                case $UBUNTU_VERSION in
                    24.04|24.04.*)
                        echo "Installing STRATO Mercata dependencies on Ubuntu $UBUNTU_VERSION LTS \"$UBUNTU_CODENAME\"."
                        ;;
                    *)
                        echo "ERROR - STRATO Mercata only supports Ubuntu 24.04 LTS \"Noble Numbat\" (initial release or point releases)."
                        echo "Your Ubuntu version: $UBUNTU_VERSION \"$UBUNTU_CODENAME\"."
                        exit 1
                        ;;
                esac
            else
                # Check Linux Mint version constraints - only allow 22.1 "Xia"
                MINT_VERSION=$(lsb_release -rs)
                MINT_CODENAME=$(lsb_release -cs)
                if [ "$MINT_VERSION" = "22.1" ] && [ "$MINT_CODENAME" = "xia" ]; then
                    echo "Installing STRATO Mercata dependencies on Linux Mint $MINT_VERSION \"Xia\"."
                else
                    echo "ERROR - STRATO Mercata only supports Linux Mint 22.1 \"Xia\"."
                    echo "Your Linux Mint version: $MINT_VERSION \"$MINT_CODENAME\""
                    exit 1
                fi
            fi
            
            # Install git
            sudo apt -q update
            sudo apt install -qy --no-install-recommends git
            
            # Install packaging-related tools needed for the Docker install
            sudo apt install -qy --no-install-recommends \
                ca-certificates \
                curl \
                gnupg \
                lsb-release

            # Download Docker GPG key and add to our Apt keyrings
            sudo mkdir -p /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg

            # Add the appropriate "Additional Sources List" for the stable Docker packages for this distro version
            if [ "$DISTRO_NAME" = "Linux Mint" ]; then
                UBUNTU_CODENAME=$(cat /etc/upstream-release/lsb-release | grep DISTRIB_CODENAME | cut -d= -f2)
            else
                UBUNTU_CODENAME=$(lsb_release -cs)
            fi
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $UBUNTU_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

            # Install the Docker packages
            sudo apt -q update
            sudo apt install -qy --no-install-recommends \
                docker-ce \
                docker-ce-cli \
                containerd.io \
                docker-buildx-plugin \
                docker-compose-plugin

            # Ubuntu does not automatically add the current user to the docker group (Mint Linux does),
            # so we need to do so manually as a post-install step.
            #
            # See https://docs.docker.com/engine/install/linux-postinstall/
            if [ "$DISTRO_NAME" = "Ubuntu" ]; then
                sudo groupadd docker 2>/dev/null || true
                sudo usermod -aG docker $USER
                echo "Note: You may need to log out and back in for Docker group membership to take effect."
            fi
                        
            # Install Haskell GHC and Stack
            sudo apt install -qy --no-install-recommends \
                build-essential \
                curl \
                libgmp-dev \
                zlib1g-dev
            curl -sSL https://get.haskellstack.org/ | sh -s - -f
            
            # Install STRATO dependencies
            sudo apt install -qy --no-install-recommends \
                libleveldb-dev \
                liblzma-dev \
                libpq-dev \
                libsecp256k1-dev \
                libsodium-dev \
                postgresql-client
            ;;

        *)
            unsupported_platform "$DISTRO_NAME"
            ;;

        esac
    else
        unsupported_platform "$(lsb_release -is)"
    fi
    ;;

*)
    unsupported_platform "$(uname -s)"
    ;;

esac

# Lock the specific package versions for Ubuntu or Mint Linux
check_package_version "ubuntu-or-mint" "build-essential" "12.10ubuntu1"
check_package_version "ubuntu-or-mint" "ca-certificates" "20240203"
check_package_version "ubuntu-or-mint" "containerd.io" "1.7.27-1"
check_package_version "ubuntu-or-mint" "curl" "8.5.0-2ubuntu10.6"
check_package_version "ubuntu-or-mint" "docker-buildx-plugin" "0.26.1-1~ubuntu.24.04~noble"
check_package_version "ubuntu-or-mint" "docker-ce" "5:28.3.3-1~ubuntu.24.04~noble"
check_package_version "ubuntu-or-mint" "docker-ce-cli" "5:28.3.3-1~ubuntu.24.04~noble"
check_package_version "ubuntu-or-mint" "docker-compose-plugin" "2.39.1-1~ubuntu.24.04~noble"
check_package_version "ubuntu-or-mint" "git" "1:2.43.0-1ubuntu7.3"
check_package_version "ubuntu-or-mint" "gnupg" "2.4.4-2ubuntu17.3"
check_package_version "ubuntu-or-mint" "libgmp-dev" "2:6.3.0+dfsg-2ubuntu6.1"
check_package_version "ubuntu-or-mint" "libleveldb-dev" "1.23-5build1"
check_package_version "ubuntu-or-mint" "liblzma-dev" "5.6.1+really5.4.5-1ubuntu0.2"
check_package_version "ubuntu-or-mint" "libpq-dev" "16.9-0ubuntu0.24.04.1"
check_package_version "ubuntu-or-mint" "libsecp256k1-dev" "0.2.0-2"
check_package_version "ubuntu-or-mint" "libsodium-dev" "1.0.18-1build3"
check_package_version "ubuntu-or-mint" "lsb-release" "12.0-2"
check_package_version "ubuntu-or-mint" "postgresql-client" "16+257build1.1"
check_package_version "ubuntu-or-mint" "zlib1g-dev" "1:1.3.dfsg-3.1ubuntu2.1"
