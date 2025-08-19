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
        pkg-config \
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
            
            # Build leveldb 1.22 (not available in Amazon Linux 2023 repositories)
            sudo dnf install -q -y cmake
            git clone --branch 1.22 --recurse-submodules https://github.com/google/leveldb.git
            cd leveldb
            mkdir build && cd build
            cmake -DCMAKE_BUILD_TYPE=Release \
                  -DBUILD_SHARED_LIBS=ON \
                  -DCMAKE_CXX_STANDARD=17 \
                  -DCMAKE_CXX_STANDARD_REQUIRED=ON \
                  -DLEVELDB_BUILD_TESTS=OFF \
                  -DLEVELDB_BUILD_BENCHMARKS=OFF \
                  ..
            cmake --build . -j$(nproc)
            sudo cmake --build . --target install
            cd ..
            rm -rf leveldb 
            
            # Build secp256k1 (not available in Amazon Linux 2023 repositories)
            sudo dnf install -y autoconf libtool make
            git clone https://github.com/bitcoin-core/secp256k1.git  # TODO: peg to a specific refspec to match a version
            cd secp256k1
            ./autogen.sh
            ./configure --enable-module-recovery --enable-experimental --enable-module-ecdh
            make
            sudo make install
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
                newgrp docker
            fi
                        
            # Install Haskell GHC and Stack
            sudo apt install -qy --no-install-recommends \
                build-essential \
                curl \
                libtinfo-dev \
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
