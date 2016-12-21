#!/bin/bash

set -e

$sudo apt-get -y install \
  lsb-release cmake \
  curl libleveldb-dev libpq-dev libpcre3-dev \
  libboost-all-dev libjsoncpp-dev libstdc++6
$sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 575159689BEFB442
echo "deb http://download.fpcomplete.com/ubuntu $(lsb_release -s -c) main" | \
  sudo tee /etc/apt/sources.list.d/fpco.list
$sudo apt-get update
$sudo apt-get -y --allow-unauthenticated install stack
stack setup
stack install alex happy
$sudo cp ~/.local/bin/{alex,happy} /usr/bin

echo "Installing node..."
curl -sL https://deb.nodesource.com/setup_6.x | $sudo bash -
$sudo apt-get install -y nodejs
