#!/bin/bash

set -e

$sudo apt-get -y install \
  curl libleveldb-dev libpq-dev libpcre3-dev \
  libboost-all-dev libjsoncpp-dev libstdc++6 \
  netcat-openbsd netbase
curl -sL https://deb.nodesource.com/setup_6.x | $sudo bash -
$sudo apt-get -y install nodejs 
