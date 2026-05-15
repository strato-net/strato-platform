#!/usr/bin/env sh

#------------------------------------------------------------------------------
# Bash script for installing pre-requisite packages for building the full
# STRATO platform on Linux, macOS and other UNIX-derived platforms.
#
# This is an "infrastucture-as-code" alternative to the manual build
#
# See "How can I reliably get the operating system's name?"
# http://unix.stackexchange.com/questions/92199/how-can-i-reliably-get-the-operating-systems-name
#------------------------------------------------------------------------------

set -e

# Function to handle unsupported platforms
unsupported_platform() {
    echo "STRATO is not natively supported on $1."
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
                    "Amazon Linux"*|"Oracle Linux Server"*)
                        # Amazon Linux / Oracle Linux - use dnf/rpm
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
    if [ "$MACOS_MAJOR" != "15" ] && [ "$MACOS_MAJOR" != "26" ]; then
        echo "ERROR - This script only natively support macOS Sequoia (15.x) and macOS Tahoe (26.x)."
        echo "Your macOS version: $MACOS_VERSION"
        exit 1
    fi
    
    echo "Installing STRATO dependencies on macOS Sequoia $MACOS_VERSION."
    
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
        librdkafka \
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
                    echo "Installing STRATO dependencies on Amazon Linux $AMAZON_VERSION."
                    ;;
                *)
                    echo "ERROR - STRATO only supports Amazon Linux 2023 (initial release or point releases)."
                    echo "Your Amazon Linux version: $AMAZON_VERSION"
                    exit 1
                    ;;
            esac
            
            # Install git
            sudo dnf update -q -y
            sudo dnf install -q -y git

            # Install Docker
            # Note: docs.docker.com does not officially support Amazon Linux 2023.
            # AWS provides Docker via its own repositories; install via dnf and
            # use the buildx/compose plugins where available (compose is fetched below).
            sudo dnf install -q -y docker
            sudo systemctl enable --now docker

            # Add current user to docker group so Docker runs as non-root user
            # See https://docs.docker.com/engine/install/linux-postinstall/
            sudo groupadd docker 2>/dev/null || true
            sudo usermod -aG docker $USER

            # Docker-compose
            DOCKER_CONFIG=/usr/local/lib/docker
            if [ ! -x "$DOCKER_CONFIG/cli-plugins/docker-compose" ]; then
                sudo mkdir -p $DOCKER_CONFIG/cli-plugins
                sudo curl -SL https://github.com/docker/compose/releases/download/v2.36.0/docker-compose-linux-x86_64 -o $DOCKER_CONFIG/cli-plugins/docker-compose
                sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
            else
                echo "docker-compose is already installed, skipping download."
            fi

            # Install Haskell Stack
            sudo dnf install -q -y \
                gcc \
                gcc-c++ \
                gmp-devel \
                ncurses-devel \
                zlib-devel
            if ! command -v stack > /dev/null 2>&1; then
                curl -sSL https://get.haskellstack.org/ | sh -s - -f
            else
                echo "Haskell Stack is already installed, skipping install."
            fi

            # Install STRATO dependencies
            sudo dnf install -q -y \
                libsodium-devel \
                postgresql15 \
                postgresql-devel \
                xz-devel

            # Build leveldb (not available in Amazon Linux 2023 repositories)
            if [ ! -f /usr/local/lib/libleveldb.so.1 ] || [ ! -f /lib64/libleveldb.so.1 ]; then
                sudo dnf install -q -y snappy-devel
                rm -rf leveldb
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
            else
                echo "leveldb is already installed, skipping build."
            fi

            # Build secp256k1 (not available in Amazon Linux 2023 repositories)
            if [ ! -f /usr/local/lib/libsecp256k1.so.6 ] || [ ! -f /lib64/libsecp256k1.so.6 ] || [ ! -f /usr/share/pkgconfig/libsecp256k1.pc ]; then
                sudo dnf install -y autoconf libtool make
                rm -rf secp256k1
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
            else
                echo "secp256k1 is already installed, skipping build."
            fi

            # Build librdkafka (not available in Amazon Linux 2023 repositories)
            if [ ! -f /usr/local/lib/librdkafka.so.1 ] || [ ! -f /lib64/librdkafka.so.1 ] || [ ! -f /usr/share/pkgconfig/rdkafka.pc ]; then
                sudo dnf install -y cmake openssl-devel cyrus-sasl-devel zlib-devel
                rm -rf librdkafka
                git clone --branch v2.3.0 https://github.com/confluentinc/librdkafka.git
                cd librdkafka
                ./configure
                make
                sudo make install
                # Need to copy to /usr/share/pkgconfig for pkg-config to find it.
                sudo cp /usr/local/lib/pkgconfig/rdkafka.pc /usr/share/pkgconfig/
                sudo cp /usr/local/lib/pkgconfig/rdkafka++.pc /usr/share/pkgconfig/
                sudo cp /usr/local/lib/librdkafka.so.1 /lib64
                sudo cp /usr/local/lib/librdkafka++.so.1 /lib64
                cd ..
                rm -rf librdkafka
            else
                echo "librdkafka is already installed, skipping build."
            fi

            # Update library cache
            sudo ldconfig

            ;;

        "Oracle Linux Server")
            # Check Oracle Linux version constraints - only allow 8.10
            ORACLE_VERSION=$(. /etc/os-release; echo $VERSION_ID)
            case $ORACLE_VERSION in
                8.10|8.10.*)
                    echo "Installing STRATO dependencies on Oracle Linux $ORACLE_VERSION."
                    ;;
                *)
                    echo "ERROR - STRATO only supports Oracle Linux 8.10."
                    echo "Your Oracle Linux version: $ORACLE_VERSION"
                    exit 1
                    ;;
            esac

            # Install git
            sudo dnf update -y
            sudo dnf install -y git

            # Enable EPEL and CodeReady Linux Builder repositories (needed for some -devel packages)
            sudo dnf install -y oracle-epel-release-el8
            sudo dnf config-manager --set-enabled ol8_codeready_builder

            # Install Docker
            # Per https://docs.docker.com/engine/install/centos/
            # Remove any unofficial Docker packages that could conflict with docker-ce.
            sudo dnf remove -y \
                docker \
                docker-client \
                docker-client-latest \
                docker-common \
                docker-latest \
                docker-latest-logrotate \
                docker-logrotate \
                docker-engine 2>/dev/null || true
            # Set up Docker's official repository.
            sudo dnf -y install dnf-plugins-core
            sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            sudo dnf install -y \
                docker-ce \
                docker-ce-cli \
                containerd.io \
                docker-buildx-plugin \
                docker-compose-plugin
            sudo systemctl enable --now docker

            # Add current user to docker group so Docker runs as non-root user
            # See https://docs.docker.com/engine/install/linux-postinstall/
            sudo groupadd docker 2>/dev/null || true
            sudo usermod -aG docker $USER

            # Install Haskell Stack dependencies
            sudo dnf install -y \
                gcc \
                gcc-c++ \
                gmp-devel \
                make \
                ncurses-devel \
                zlib-devel
            if ! command -v stack > /dev/null 2>&1; then
                curl -sSL https://get.haskellstack.org/ | sh -s - -f
            else
                echo "Haskell Stack is already installed, skipping install."
            fi

            # Install PostgreSQL 15 via the official PGDG repo (OL8 AppStream only ships PG 13)
            sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm
            sudo dnf -y module disable postgresql
            sudo dnf install -y postgresql15 postgresql15-devel
            # PGDG installs pg_config to /usr/pgsql-15/bin/ which is not in the default PATH.
            # Symlink it and the pkgconfig file into standard locations so build tools can find them.
            sudo ln -sf /usr/pgsql-15/bin/pg_config /usr/local/bin/pg_config
            sudo ln -sf /usr/pgsql-15/lib/pkgconfig/libpq.pc /usr/share/pkgconfig/libpq.pc

            # Install remaining STRATO dependencies available in standard repos
            sudo dnf install -y \
                libsodium-devel \
                xz-devel

            # Build leveldb from source (not available in Oracle Linux 8 repositories)
            if [ ! -f /usr/local/lib/libleveldb.so.1 ] || [ ! -f /lib64/libleveldb.so.1 ]; then
                sudo dnf install -y snappy-devel
                rm -rf leveldb
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
            else
                echo "leveldb is already installed, skipping build."
            fi

            # Build secp256k1 from source (not available in Oracle Linux 8 repositories)
            if [ ! -f /usr/local/lib/libsecp256k1.so.6 ] || [ ! -f /lib64/libsecp256k1.so.6 ] || [ ! -f /usr/share/pkgconfig/libsecp256k1.pc ]; then
                sudo dnf install -y autoconf libtool make
                rm -rf secp256k1
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
            else
                echo "secp256k1 is already installed, skipping build."
            fi

            # Build librdkafka from source (not available in Oracle Linux 8 repositories)
            if [ ! -f /usr/local/lib/librdkafka.so.1 ] || [ ! -f /lib64/librdkafka.so.1 ] || [ ! -f /usr/share/pkgconfig/rdkafka.pc ]; then
                sudo dnf install -y cmake openssl-devel cyrus-sasl-devel zlib-devel
                rm -rf librdkafka
                git clone --branch v2.3.0 https://github.com/confluentinc/librdkafka.git
                cd librdkafka
                ./configure
                make
                sudo make install
                # Need to copy to /usr/share/pkgconfig for pkg-config to find it.
                sudo cp /usr/local/lib/pkgconfig/rdkafka.pc /usr/share/pkgconfig/
                sudo cp /usr/local/lib/pkgconfig/rdkafka++.pc /usr/share/pkgconfig/
                sudo cp /usr/local/lib/librdkafka.so.1 /lib64
                sudo cp /usr/local/lib/librdkafka++.so.1 /lib64
                cd ..
                rm -rf librdkafka
            else
                echo "librdkafka is already installed, skipping build."
            fi

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
                        echo "Installing STRATO dependencies on Ubuntu $UBUNTU_VERSION LTS \"$UBUNTU_CODENAME\"."
                        ;;
                    *)
                        echo "ERROR - STRATO only supports Ubuntu 24.04 LTS \"Noble Numbat\" (initial release or point releases)."
                        echo "Your Ubuntu version: $UBUNTU_VERSION \"$UBUNTU_CODENAME\"."
                        exit 1
                        ;;
                esac
            else
                # Check Linux Mint version constraints - only allow 22.1 "Xia"
                MINT_VERSION=$(lsb_release -rs)
                MINT_CODENAME=$(lsb_release -cs)
                if [ "$MINT_VERSION" = "22.1" ] && [ "$MINT_CODENAME" = "xia" ]; then
                    echo "Installing STRATO dependencies on Linux Mint $MINT_VERSION \"Xia\"."
                else
                    echo "ERROR - STRATO only supports Linux Mint 22.1 \"Xia\"."
                    echo "Your Linux Mint version: $MINT_VERSION \"$MINT_CODENAME\""
                    exit 1
                fi
            fi
            
            # Remove stale apt source/key files left by previous versions of this
            # script (e.g. the old .gpg keyring or .list source file) to prevent
            # "Conflicting values set for Signed-By" errors when re-running.
            sudo rm -f /etc/apt/sources.list.d/docker.list
            sudo rm -f /etc/apt/keyrings/docker.gpg

            # Install git
            sudo apt -q update
            sudo apt install -qy --no-install-recommends git

            # Install Docker if not already installed
            # Per https://docs.docker.com/engine/install/ubuntu/
            if ! command -v docker > /dev/null 2>&1; then
                # Remove any unofficial Docker packages that could conflict with docker-ce.
                for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
                    sudo apt remove -qy "$pkg" 2>/dev/null || true
                done

                # Install packaging-related tools needed for the Docker install
                sudo apt install -qy --no-install-recommends \
                    ca-certificates \
                    curl \
                    lsb-release

                # Add Docker's official GPG key (PEM-armored .asc per current docs)
                sudo install -m 0755 -d /etc/apt/keyrings
                sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
                sudo chmod a+r /etc/apt/keyrings/docker.asc

                # Determine the Ubuntu codename (Linux Mint reports its own codename;
                # the upstream Ubuntu codename is needed for Docker's repo).
                if [ "$DISTRO_NAME" = "Linux Mint" ]; then
                    UBUNTU_CODENAME=$(cat /etc/upstream-release/lsb-release | grep DISTRIB_CODENAME | cut -d= -f2)
                else
                    UBUNTU_CODENAME=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
                fi

                # Add the Docker repository using the deb822 .sources format
                sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $UBUNTU_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

                # Install the Docker packages
                sudo apt -q update
                sudo apt install -qy --no-install-recommends \
                    docker-ce \
                    docker-ce-cli \
                    containerd.io \
                    docker-buildx-plugin \
                    docker-compose-plugin
            else
                echo "Docker is already installed."
            fi

            # Enable and start Docker
            sudo systemctl enable --now docker

            # Add current user to docker group so Docker runs as non-root user
            # See https://docs.docker.com/engine/install/linux-postinstall/
            sudo groupadd docker 2>/dev/null || true
            sudo usermod -aG docker $USER

            # Install Haskell GHC and Stack
            sudo apt install -qy --no-install-recommends \
                build-essential \
                curl \
                libgmp-dev \
                zlib1g-dev
            if ! command -v stack > /dev/null 2>&1; then
                curl -sSL https://get.haskellstack.org/ | sh -s - -f
            else
                echo "Haskell Stack is already installed, skipping install."
            fi

            # Install STRATO dependencies
            sudo apt install -qy --no-install-recommends \
                libleveldb-dev \
                liblzma-dev \
                libpq-dev \
                librdkafka-dev \
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
check_package_version "ubuntu-or-mint" "libgmp-dev" "2:6.3.0+dfsg-2ubuntu6.1"
check_package_version "ubuntu-or-mint" "libleveldb-dev" "1.23-5build1"
check_package_version "ubuntu-or-mint" "liblzma-dev" "5.6.1+really5.4.5-1ubuntu0.2"
check_package_version "ubuntu-or-mint" "libpq-dev" "16.9-0ubuntu0.24.04.1"
check_package_version "ubuntu-or-mint" "librdkafka-dev" "2.3.0-1build2"
check_package_version "ubuntu-or-mint" "libsecp256k1-dev" "0.2.0-2"
check_package_version "ubuntu-or-mint" "libsodium-dev" "1.0.18-1build3"
check_package_version "ubuntu-or-mint" "lsb-release" "12.0-2"
check_package_version "ubuntu-or-mint" "postgresql-client" "16+257build1.1"
check_package_version "ubuntu-or-mint" "zlib1g-dev" "1:1.3.dfsg-3.1ubuntu2.1"

echo ""
echo "Dependencies installed successfully."
if [ "$(uname -s)" = "Linux" ]; then
    echo "To activate Docker group membership (to run docker commands as non-root user) in your current shell session, run:"
    echo "  newgrp docker"
    echo "Then verify with:"
    echo "  docker ps"
fi
