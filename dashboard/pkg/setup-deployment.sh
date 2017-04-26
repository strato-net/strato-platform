#!/bin/bash

set -e

echo "dashboard:setup-build.sh"

$sudo apt-get update
$sudo apt-get -y install tmux tmuxinator
