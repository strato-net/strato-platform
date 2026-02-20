#!/bin/bash
#
# Helper to get Railgun contract address from node config
# Source this file, then call: get_railgun_address
#

get_railgun_address() {
    local DEFAULT_NODE_FILE="$HOME/.strato/default-node"
    
    if [ ! -f "$DEFAULT_NODE_FILE" ]; then
        echo "Error: No default node set (~/.strato/default-node not found)" >&2
        return 1
    fi
    
    local NODE_DIR=$(cat "$DEFAULT_NODE_FILE" | tr -d '\n')
    local ETHCONF_FILE="$NODE_DIR/.ethereumH/ethconf.yaml"
    
    if [ ! -f "$ETHCONF_FILE" ]; then
        echo "Error: ethconf.yaml not found at $ETHCONF_FILE" >&2
        return 1
    fi
    
    local ADDR
    ADDR=$(yq -r '.contractsConfig.railgunProxy' "$ETHCONF_FILE" 2>/dev/null)
    
    if [ -z "$ADDR" ] || [ "$ADDR" = "null" ]; then
        echo "Error: Railgun contract address not found. Has it been deployed?" >&2
        return 1
    fi
    
    echo "$ADDR"
}
