#!/usr/bin/env sh

#------------------------------------------------------------------------------
# Installs the pre-requisite packages for building and running the full
# STRATO platform.
#
# Supported platforms:
#   - macOS Sequoia (15.x) and Tahoe (26.x)
#   - Ubuntu 24.04 LTS "Noble Numbat" and 26.04 LTS "Resolute Raccoon"
#   - Amazon Linux 2023
#   - Oracle Linux 8.10
#
# This is an "infrastructure-as-code" alternative to the manual build setup.
#------------------------------------------------------------------------------

set -e

# Function to handle unsupported platforms
unsupported_platform() {
    echo "STRATO is not natively supported on $1."
    exit 1
}

case $(uname -s) in

#------------------------------------------------------------------------------
# macOS
#------------------------------------------------------------------------------

Darwin)
    # Check macOS version constraints - only allow Sequoia and Tahoe
    MACOS_VERSION=$(sw_vers -productVersion)
    MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)
    case $MACOS_MAJOR in
        15|26)
            echo "Installing STRATO dependencies on macOS $MACOS_VERSION."
            ;;
        *)
            echo "ERROR - This script only supports macOS Sequoia (15.x) and macOS Tahoe (26.x)."
            echo "Your macOS version: $MACOS_VERSION"
            exit 1
            ;;
    esac

    # Install Homebrew if not already installed (non-interactive, safe to run repeatedly)
    if ! command -v brew > /dev/null 2>&1; then
        echo "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" < /dev/null

        # Add Homebrew to PATH for the current session
        if [ "$(uname -m)" = "arm64" ]; then
            # Apple Silicon Mac
            eval "$(/opt/homebrew/bin/brew shellenv)"
        else
            # Intel Mac
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    else
        echo "Homebrew is already installed."
        # Refresh package definitions - stale metadata for the Docker cask
        # (renamed from "docker" to "docker-desktop") fails to parse otherwise.
        brew update --quiet
    fi

    # Install git
    brew install --quiet git

    # Install Docker Desktop for Mac unless Docker is already installed
    # (e.g. Docker Desktop downloaded from docker.com - the cask install
    # would fail on the pre-existing /Applications/Docker.app)
    if ! command -v docker > /dev/null 2>&1 && [ ! -d /Applications/Docker.app ]; then
        brew install --quiet --cask docker-desktop
    else
        echo "Docker is already installed."
    fi

    # Install Haskell Stack unless already installed
    # (e.g. via the official get.haskellstack.org installer)
    if ! command -v stack > /dev/null 2>&1; then
        brew install --quiet haskell-stack
    else
        echo "Haskell Stack is already installed, skipping install."
    fi

    # The `ar` shipped with newer Xcode Command Line Tools (16.3+ / macOS Tahoe)
    # no longer supports @response-file arguments. GHC toolchains that were set
    # up under an older Xcode have ("ar supports at file", "YES") baked into
    # their settings and fail to link with:
    #   ar: @....rsp: No such file or directory
    # Detect the mismatch and patch any existing stack-installed GHC settings.
    AR_ATFILE_RSP=$(mktemp)
    AR_ATFILE_ARCHIVE=$(mktemp -u).a
    AR_SETTINGS_PATCHED=false
    if ! ar qc "$AR_ATFILE_ARCHIVE" @"$AR_ATFILE_RSP" 2>/dev/null; then
        for GHC_SETTINGS in "$HOME"/.stack/programs/*/ghc-*/lib/ghc-*/lib/settings; do
            if [ -f "$GHC_SETTINGS" ] && grep -q '("ar supports at file", "YES")' "$GHC_SETTINGS"; then
                sed -i '' 's|("ar supports at file", "YES")|("ar supports at file", "NO")|' "$GHC_SETTINGS"
                echo "Patched 'ar supports at file' to NO in $GHC_SETTINGS (system ar lacks @response-file support)."
                AR_SETTINGS_PATCHED=true
            fi
        done
    fi
    rm -f "$AR_ATFILE_RSP" "$AR_ATFILE_ARCHIVE"

    # Cabal also caches ar's response-file support per package at configure
    # time, so an existing build tree configured under the old Xcode keeps
    # failing even after the settings patch. Flush it once so every local
    # package re-probes ar on the next build.
    if [ "$AR_SETTINGS_PATCHED" = "true" ]; then
        SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
        if [ -d "$SCRIPT_DIR/strato" ] && command -v stack > /dev/null 2>&1; then
            echo "Cleaning stale package configure caches in $SCRIPT_DIR/strato (one-time after ar fix)..."
            (cd "$SCRIPT_DIR/strato" && stack clean)
        fi
    fi

    # Install STRATO dependencies
    brew install --quiet \
        gmp \
        leveldb \
        libpq \
        librdkafka \
        libsodium \
        logrotate \
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
                logrotate \
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
                logrotate \
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

        Ubuntu)
            # Check Ubuntu version constraints - only allow the supported LTS releases
            UBUNTU_VERSION=$(. /etc/os-release; echo $VERSION_ID)
            UBUNTU_CODENAME=$(. /etc/os-release; echo ${UBUNTU_CODENAME:-$VERSION_CODENAME})
            case $UBUNTU_VERSION in
                24.04|26.04)
                    echo "Installing STRATO dependencies on Ubuntu $UBUNTU_VERSION LTS \"$UBUNTU_CODENAME\"."
                    ;;
                *)
                    echo "ERROR - STRATO only supports Ubuntu 24.04 LTS \"Noble Numbat\" and 26.04 LTS \"Resolute Raccoon\"."
                    echo "Your Ubuntu version: $UBUNTU_VERSION \"$UBUNTU_CODENAME\"."
                    exit 1
                    ;;
            esac

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
                    curl

                # Add Docker's official GPG key (PEM-armored .asc per current docs)
                sudo install -m 0755 -d /etc/apt/keyrings
                sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
                sudo chmod a+r /etc/apt/keyrings/docker.asc

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
                logrotate \
                postgresql-client
            ;;

        *)
            unsupported_platform "$DISTRO_NAME"
            ;;

        esac
    else
        unsupported_platform "$(uname -s) (no /etc/os-release found)"
    fi
    ;;

*)
    unsupported_platform "$(uname -s)"
    ;;

esac

echo ""
echo "Dependencies installed successfully."
if [ "$(uname -s)" = "Linux" ]; then
    echo "To activate Docker group membership (to run docker commands as non-root user) in your current shell session, run:"
    echo "  newgrp docker"
    echo "Then verify with:"
    echo "  docker ps"
fi
