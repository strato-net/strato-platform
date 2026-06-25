#!/bin/bash
set -e

read -r -s -p "Enter Vault password: " PASSWORD
echo

sudo docker exec -i vault-vault-wrapper-1 \
  curl -s -H "Content-Type: application/json" -d @- localhost:8000/strato/v2.3/password <<< \"$PASSWORD\"
