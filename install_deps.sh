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
            sudo apt -q update
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
