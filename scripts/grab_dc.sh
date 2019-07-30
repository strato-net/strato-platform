#!/usr/bin/env sh

if [  $# -lt 1 ]
then
  echo "usage: grab_dc.sh <build_number>"
  exit 1
fi
set -x
set -e

BUILD_NUMBER=$1
SOURCE_DIR="/var/jenkins_home/jobs/STRATO_test/builds/${BUILD_NUMBER}/archive/strato-worktree/docker-compose.yml"
TMP_DIR="/tmp/dcs/${BUILD_NUMBER}/"
mkdir -p ${TMP_DIR}
ssh jenkins mkdir -p "${TMP_DIR}"
ssh jenkins sudo docker cp "jenkins_jenkins_1:${SOURCE_DIR}" "${TMP_DIR}"
scp jenkins:"${TMP_DIR}/docker-compose.yml" "${TMP_DIR}"
cp "${TMP_DIR}/docker-compose.yml" .
