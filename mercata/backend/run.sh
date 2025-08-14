#!/bin/bash
set -e
envfile="$1version.env"
if [ -f "$envfile" ]; then
  if [ -L ".env" ]; then
    rm ".env"
  fi
  ln -s "$envfile" .env
  npm install
  npm run dev
else
  echo "Error: File '$envfile' does not exist or is not a regular file."
  exit 1 # Exit with an error code to indicate failure
fi
