#!/bin/bash

set -e  # Exit on any error

echo "Starting Strato upgrade process..."

echo "Step 1: Pulling latest changes from git..."
git pull

echo "Step 2: Go to master branch..."
git checkout master

echo "Step 3: Running strato --compose..."
sudo ./strato --compose

echo "Step 4: Running strato --pull..."
sudo ./strato --pull

echo "Step 5: Running strato --wipe..."
sudo ./strato --wipe

echo "Step 6: Running strato-run.sh..."
sudo ./strato-run.sh

echo "Upgrade completed successfully!"

