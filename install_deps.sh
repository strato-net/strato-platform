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

# Function to build secp256k1 from BlockApps custom source
# Note: Platform-specific build tools (autoconf, libtool, make) must be installed before calling this function
build_secp256k1() {
    echo "Building secp256k1 from BlockApps custom source..."
    
    # For secp256k1, we are currently dependent on our own custom version,
    # which we have to build from source.  We would really like to move to
    # vanilla 0.7.0, but it would require a further hard fork and we're
    # rushing for code freeze, so need a stable network more than to
    # resolve this version issue.
    git clone https://github.com/blockapps/secp256k1
    cd secp256k1
    git checkout c6b6090ef6feca10e5f82b557112523275fa76c7
    ./autogen.sh
    ./configure --enable-module-recovery --enable-experimental --enable-module-ecdh
    make
    sudo make install
    cd ..
    rm -rf secp256k1
    sudo ldconfig
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
    
    # Install Docker Desktop for Mac
    brew install --quiet --cask docker
    
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
            
            # Build secp256k1 from BlockApps custom source
            # We were having to build this package manually on Amazon Linux
            # even before this custom version situation, because the package
            # is not present in the Amazon Linux 2023 repositories at all, so
            # when we switch to a vanilla version, this local build will still
            # be needed.
            sudo dnf install -y autoconf libtool make
            build_secp256k1
            
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
                libsodium-dev \
                postgresql-client

            # Build secp256k1 from BlockApps custom source
            sudo apt install -y autoconf libtool make
            build_secp256k1

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
