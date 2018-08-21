#!/usr/bin/env bash
set -e

if [ $# -ne 3 ]; then
  echo "usage: ${0} <version> <target_dir> <source_output_dir>"
  exit 1
fi

VERSION=$1
TARGET_DIR=$2
SOURCE_OUTPUT_DIR=$3

CONTAINER=$(docker run -d --entrypoint=sleep "ethereum/solc:${VERSION}" 10000)
trap "docker rm -f ${CONTAINER}" EXIT

docker cp "${CONTAINER}:/usr/bin/solc" "${TARGET_DIR}"

# Fetching ethereum/solidity source code of same version as the GPLv3 license requires that
if [ ! -d ${SOURCE_OUTPUT_DIR} ]
then
    git clone --single-branch --branch v${VERSION} https://github.com/ethereum/solidity ${SOURCE_OUTPUT_DIR}
else
    cd ${SOURCE_OUTPUT_DIR}
    git pull https://github.com/ethereum/solidity v${VERSION}
fi

