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
    echo "Installing STRATO Mercata dependencies on macOS."
    
    # Check for Homebrew install and abort if it is not installed.
    brew --version > /dev/null 2>&1 || { echo >&2 "ERROR - STRATO Mercata requires a Homebrew install on macOS. See https://brew.sh"; exit 1; }

    # And finally install all the external dependencies.
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
            echo "Installing STRATO Mercata dependencies on Amazon Linux."
            sudo dnf update -q -y
            sudo dnf install -q -y \
                leveldb-devel \
                libsecp256k1-devel \
                libsodium-devel \
                postgresql-client \
                postgresql-devel \
                xz-devel
            ;;

        Ubuntu|"Linux Mint")
            echo "Installing STRATO Mercata dependencies on Ubuntu or Mint Linux."
            
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
