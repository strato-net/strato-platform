#!/bin/bash

set -e

$sudo apt-get -y install curl
curl -sL https://deb.nodesource.com/setup_6.x | $sudo bash -
$sudo apt-get -y install nodejs

