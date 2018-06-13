#!/usr/bin/env bash
set -e

if [ $# -ne 2 ]; then
  echo "usage: ${0} <version> <target_dir>" > 2
  exit 1
fi

VERSION=$1
TARGET_DIR=$2

CONTAINER=$(docker run -d --entrypoint=sleep "ethereum/solc:${VERSION}" 10000)
trap "docker stop ${CONTAINER}" EXIT

docker cp "${CONTAINER}:/usr/bin/solc" "${TARGET_DIR}"
