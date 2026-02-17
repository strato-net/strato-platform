#!/bin/bash
#
# Deploy Railgun contract to STRATO (behind upgradeable proxy)
#
# Usage: ./deploy-railgun.sh
#
# This script deploys:
# 1. RailgunSmartWallet (logic contract)
# 2. Proxy (proxy contract pointing to the logic)
#
# Users interact with the proxy address. To upgrade, call setLogicContract() on the proxy.

set -e

SCRIPT_DIR="$(dirname "$0")"
CONTRACT_FILE="$SCRIPT_DIR/../contracts/railgun.sol"
source "$SCRIPT_DIR/refresh-token.sh"

if [ ! -f "$CONTRACT_FILE" ]; then
    echo "Error: Contract file not found at $CONTRACT_FILE"
    exit 1
fi

# Get deployer address for ownership
echo "Getting user address..."
TOKEN=$(ensure_valid_token) || exit 1
HOST=${STRATO_HOST:-localhost:8081}
USER_ADDR=$(curl -s -H "Authorization: Bearer $TOKEN" "http://$HOST/strato/v2.3/key" | jq -r '.address')

if [ -z "$USER_ADDR" ] || [ "$USER_ADDR" = "null" ]; then
    echo "Error: Could not get user address"
    exit 1
fi
echo "Deployer address: $USER_ADDR"

CONTRACT_SRC=$(cat "$CONTRACT_FILE")

echo ""
echo "Step 1: Deploying RailgunSmartWallet (logic contract)..."

# Deploy logic contract
LOGIC_RESPONSE=$(jq -n --arg src "$CONTRACT_SRC" '{
  txs: [{
    payload: {
      contract: "RailgunSmartWallet",
      src: $src,
      metadata: {VM: "SolidVM"}
    },
    type: "CONTRACT"
  }]
}' | restish strato post-bloc-transaction --resolve)

LOGIC_ADDRESS=$(echo "$LOGIC_RESPONSE" | jq -r '.[0].data.contents.address // empty')
LOGIC_STATUS=$(echo "$LOGIC_RESPONSE" | jq -r '.[0].status // empty')

if [ "$LOGIC_STATUS" != "Success" ] || [ -z "$LOGIC_ADDRESS" ]; then
    echo "Logic contract deployment failed:"
    echo "$LOGIC_RESPONSE" | jq .
    exit 1
fi

echo "Logic contract deployed: $LOGIC_ADDRESS"

echo ""
echo "Step 2: Deploying Proxy..."

# Deploy proxy contract with logic address and owner
PROXY_RESPONSE=$(jq -n --arg src "$CONTRACT_SRC" --arg logic "$LOGIC_ADDRESS" --arg owner "$USER_ADDR" '{
  txs: [{
    payload: {
      contract: "Proxy",
      src: $src,
      args: {
        _logicContract: $logic,
        _initialOwner: $owner
      },
      metadata: {VM: "SolidVM"}
    },
    type: "CONTRACT"
  }]
}' | restish strato post-bloc-transaction --resolve)

PROXY_ADDRESS=$(echo "$PROXY_RESPONSE" | jq -r '.[0].data.contents.address // empty')
PROXY_STATUS=$(echo "$PROXY_RESPONSE" | jq -r '.[0].status // empty')

if [ "$PROXY_STATUS" != "Success" ] || [ -z "$PROXY_ADDRESS" ]; then
    echo "Proxy contract deployment failed:"
    echo "$PROXY_RESPONSE" | jq .
    exit 1
fi

echo "Proxy contract deployed: $PROXY_ADDRESS"

echo ""
echo "=== Deployment Complete ==="
echo "Logic contract:  $LOGIC_ADDRESS"
echo "Proxy contract:  $PROXY_ADDRESS (this is the address users interact with)"
echo ""
echo "Next step: Run init-railgun.sh to initialize"

# Update node's ethconf.yaml
DEFAULT_NODE_FILE="$HOME/.strato/default-node"
if [ -f "$DEFAULT_NODE_FILE" ]; then
    NODE_DIR=$(cat "$DEFAULT_NODE_FILE" | tr -d '\n')
    ETHCONF_FILE="$NODE_DIR/.ethereumH/ethconf.yaml"
    if [ -f "$ETHCONF_FILE" ]; then
        echo ""
        echo "Updating node config with Railgun address..."
        if command -v yq &> /dev/null; then
            # File may be read-only, temporarily make writable
            chmod u+w "$ETHCONF_FILE" 2>/dev/null || true
            
            # Check which yq version (Go vs Python)
            if yq --version 2>&1 | grep -q "mikefarah"; then
                # Go version (mikefarah/yq)
                yq -i ".contractsConfig.railgunProxy = \"$PROXY_ADDRESS\"" "$ETHCONF_FILE"
            else
                # Python version - write to temp file then move
                yq -y ".contractsConfig.railgunProxy = \"$PROXY_ADDRESS\"" "$ETHCONF_FILE" > "$ETHCONF_FILE.tmp"
                mv -f "$ETHCONF_FILE.tmp" "$ETHCONF_FILE"
            fi
            
            # Restore read-only
            chmod u-w "$ETHCONF_FILE"
            echo "Updated: $ETHCONF_FILE"
        else
            echo "Error: yq not installed, cannot update ethconf.yaml"
            echo "Install yq: https://github.com/mikefarah/yq"
            exit 1
        fi
    else
        echo "Warning: ethconf.yaml not found at $ETHCONF_FILE"
    fi
else
    echo "Warning: No default node set (~/.strato/default-node not found)"
    echo "Run strato-setup first, or manually add to your node's ethconf.yaml:"
    echo "  contractsConfig:"
    echo "    railgunProxy: \"$PROXY_ADDRESS\""
fi
