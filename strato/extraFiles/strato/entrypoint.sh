#!/bin/bash
# Entrypoint of the strato image when it runs a node's processes (strato-setup
# --dockerMode=all): the node directory, set up on the host by
# strato-setup and started by strato-up, is bind-mounted at /var/lib/strato,
# and convoke supervises the processes in commands.txt as on a host, minus the
# containers, which compose started itself.
set -euo pipefail

cd /var/lib/strato
if [[ ! -f commands.txt ]]; then
  echo "entrypoint.sh: no commands.txt in /var/lib/strato; mount a node directory set up by strato-setup" >&2
  exit 1
fi
exec convoke --no-docker
