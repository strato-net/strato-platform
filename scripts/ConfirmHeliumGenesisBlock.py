#!/usr/bin/env python3
"""
Genesis vs Testnet Asset Comparison Script

Compares asset balances between the genesis block configuration and the local
testnet database, accounting for:
- Escrow logic (CDP vault collateral)
- Address migrations (old gold/silver assets → new consolidated assets)
- Scaling transformations (different decimal places)

The script replicates Haskell's assetBalances logic to ensure consistency.
"""

import os
import re
import csv
import subprocess
from typing import Dict, List, Tuple, Any

# =============================================================================
# CONSTANTS - Asset Addresses
# =============================================================================

# Main asset addresses (from HeliumGenesisBlock.hs)
GOLDST_ROOT = 'cdc93d30182125e05eec985b631c7c61b3f63ff0'  # New consolidated gold
GOLD_OUNCE_ROOT = 'b00e37ca092cb3c2a62d4110154a5e172279e770'  # Legacy gold ounce
GOLD_GRAM_ROOT = 'bc94173470e33deef702c6f45c6bf701d682f58c'  # Legacy gold gram
SILVST_ROOT = '2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94'  # New consolidated silver
ALT_SILVST_ROOT = '7b5f6d756c4e02104d5039205442cf7aa913a8a6'  # Legacy silver
ETHST_ROOT = '93fb7295859b2d70199e0a4883b7c320cf874e6c'
WBTCST_ROOT = '7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9'
USDST_ROOT = '937efa7e3a77e20bbdbd7c0d32b6514f368c1010'

# =============================================================================
# CONSTANTS - System Addresses
# =============================================================================
BLOCKAPPS_ADDRESS = '1b7dc206ef2fe3aab27404b88c36470ccf16c0ce'
BLOCKAPPS_OLD_ADDRESS = '0dbb9131d99c8317aa69a70909e124f2e02446e8'
BRIDGE_RELAYER_ADDRESS = '72b572ed77397da1ece4768cb2fec1943e1af7cb'
ORACLE_ADDRESS1 = '61960004350908061a90246f50ef2ab9d4b4f2c9'
ORACLE_ADDRESS2 = '11298e3fd793aab22178d185ef7cedff24dbec7d'
ETHST_POOL_ADDRESS = '0000000000000000000000000000000000001017'
WBTCST_POOL_ADDRESS = '0000000000000000000000000000000000001019'
GOLDST_POOL_ADDRESS = '000000000000000000000000000000000000101b'
SILVST_POOL_ADDRESS = '000000000000000000000000000000000000101d'
LIQUIDITY_POOL_ADDRESS = '0000000000000000000000000000000000001004'
CDP_VAULT_ADDRESS = '0000000000000000000000000000000000001013'

# =============================================================================
# CONSTANTS - Hardcoded Assets
# =============================================================================

# Assets with hardcoded BlockApps balances in HeliumGenesisBlock.hs
HARDCODED_BLOCKAPPS_ASSETS = {
    ETHST_ROOT,
    WBTCST_ROOT,
    GOLDST_ROOT,
    SILVST_ROOT
}

# =============================================================================
# CONSTANTS - System Addresses to Exclude
# =============================================================================

# System contract addresses to exclude from comparison
SPECIAL_ADDRESSES = {
    '0000000000000000000000000000000000001003',  # collateralVaultAddress
    '0000000000000000000000000000000000001004',  # liquidityPoolAddress
    '0000000000000000000000000000000000001005',  # mercataAddress
    '0000000000000000000000000000000000001006',  # rateStrategyAddress
    '0000000000000000000000000000000000001007',  # priceOracleAddress
    '0000000000000000000000000000000000001008',  # adminRegistryAddress
    '0000000000000000000000000000000000001009',  # adminRegistryImplAddress
    '000000000000000000000000000000000000100a',  # voucherAddress
    '000000000000000000000000000000000000100b',  # voucherImplAddress
    '000000000000000000000000000000000000100c',  # tokenFactoryAddress
    '000000000000000000000000000000000000100d',  # mTokenAddress
    '000000000000000000000000000000000000100e',  # rewardsChefAddress
    '000000000000000000000000000000000000100f',  # mercataBridgeAddress
    '0000000000000000000000000000000000001010',  # feeCollectorAddress
    '0000000000000000000000000000000000001011',  # ethstPoolAddress
    '0000000000000000000000000000000000001012',  # wbtcstPoolAddress
    '0000000000000000000000000000000000001013',  # cdpVaultAddress
    '0000000000000000000000000000000000001014',  # goldstPoolAddress
    '0000000000000000000000000000000000001015',  # silvstPoolAddress
    '0000000000000000000000000000000000001016',  # paxgstPoolAddress
    '0000000000000000000000000000000000001017',  # ethstPoolAddress
    '0000000000000000000000000000000000001018',  # wbtcstPoolAddress
    '0000000000000000000000000000000000001019',  # wbtcstPoolAddress
    '000000000000000000000000000000000000101a',  # goldstPoolAddress
    '000000000000000000000000000000000000101b',  # goldstPoolAddress
    '000000000000000000000000000000000000101c',  # silvstPoolAddress
    '000000000000000000000000000000000000101d',  # silvstPoolAddress
    '000000000000000000000000000000000000101e',  # paxgstPoolAddress
    '000000000000000000000000000000000000101f',  # paxgstPoolAddress
}

# =============================================================================
# CONSTANTS - Numeric Values
# =============================================================================

ONE_E18 = 10**18

# =============================================================================
# UTILITY FUNCTIONS - Conversions
# =============================================================================

def gramsToOz(grams: int) -> int:
    """
    Convert grams to ounces using Haskell's exact formula.
    
    Formula: (10000 * n) `div` 283495
    This matches the gramsToOz function in HeliumGenesisBlock.hs
    
    Args:
        grams: Integer value in grams (scaled to 18 decimals)
    
    Returns:
        Integer value in troy ounces (scaled to 18 decimals)
    """
    return (10000 * grams) // 283495

def get_decimals(decimals: int, name: str) -> int:
    """
    Get decimal places following Haskell's getDecimals logic.
    
    Special cases:
    - CATA, ETHST, USDTEMP, BETHTEMP: always 18 decimals
    - STRAT: always 4 decimals
    - Invalid decimals (<0 or >=18): default to 18
    - Otherwise: use the asset's declared decimals
    """
    if decimals < 0 or decimals >= 18 or name in ["CATA", "ETHST", "USDTEMP", "BETHTEMP"]:
        return 18
    elif name == "STRAT":
        return 4
    else:
        return decimals

def correct_quantity(decimals: int, name: str, quantity: int) -> int:
    """
    Scale quantity to 18 decimal places following Haskell's correctQuantity.
    
    Formula: quantity * 10^(18 - decimals)
    
    Args:
        decimals: Asset's declared decimal places
        name: Asset name (used for special cases)
        quantity: Raw quantity value
    
    Returns:
        Quantity scaled to 18 decimal places
    """
    decs = get_decimals(decimals, name)
    return quantity * (10 ** (18 - decs))

# =============================================================================
# PRIMITIVE FUNCTIONS - Escrow Processing
# =============================================================================

def sum_raw_escrows_by_user(asset_root: str, escrows: List[Dict[str, Any]]) -> Dict[str, int]:
    """
    Sum raw escrow quantities for an asset, grouped by user.
    
    Args:
        asset_root: Asset root address
        escrows: List of escrow dictionaries
    
    Returns:
        Dictionary mapping user_address -> total_raw_quantity
    """
    user_totals = {}
    for escrow in escrows:
        if escrow['root'] == asset_root:
            user = escrow['borrower']
            qty = escrow['collateralQuantity']
            user_totals[user] = user_totals.get(user, 0) + qty
    return user_totals

def scale_and_convert_escrow(
    asset_root: str, 
    raw_quantity: int, 
    asset_data: Dict[str, Any]
) -> tuple[int, str]:
    """
    Scale and convert escrow quantity based on asset type.
    
    Key insight: Gold gram/ounce escrows store RAW quantities,
    but GOLDST escrows store SCALED quantities.
    
    Args:
        asset_root: Original asset root address
        raw_quantity: Raw escrow quantity
        asset_data: Asset metadata (decimals, name)
    
    Returns:
        Tuple of (scaled_quantity, target_root)
    """
    if asset_root == GOLD_GRAM_ROOT:
        # Gold gram: raw → scale to 18 decimals → convert to oz
        scaled = correct_quantity(asset_data['decimals'], asset_data['name'], raw_quantity)
        return (gramsToOz(scaled), GOLDST_ROOT)
    
    elif asset_root == GOLD_OUNCE_ROOT:
        # Gold ounce: raw → scale to 18 decimals
        scaled = correct_quantity(asset_data['decimals'], asset_data['name'], raw_quantity)
        return (scaled, GOLDST_ROOT)
    
    elif asset_root == GOLDST_ROOT:
        # GOLDST: already scaled (use as-is)
        return (raw_quantity, GOLDST_ROOT)
    
    elif asset_root == ALT_SILVST_ROOT:
        # Alt silver: raw → scale to 18 decimals
        scaled = correct_quantity(asset_data['decimals'], asset_data['name'], raw_quantity)
        return (scaled, SILVST_ROOT)
    
    else:
        # Other assets: raw → scale to 18 decimals
        scaled = correct_quantity(asset_data['decimals'], asset_data['name'], raw_quantity)
        return (scaled, asset_root)

def consolidate_gold_for_user(
    user: str,
    raw_assets: Dict[str, Dict]
) -> int:
    """
    Consolidate all gold balances for a user (GOLDST + gold oz + gold gram).
    
    Args:
        user: User address
        raw_assets: Dictionary of raw asset data
    
    Returns:
        Total consolidated gold balance in oz (18 decimals)
    """
    total = 0
    
    # GOLDST balance
    if GOLDST_ROOT in raw_assets:
        goldst_data = raw_assets[GOLDST_ROOT]
        for (owner, _), qty in goldst_data['balances'].items():
            if owner == user:
                total += correct_quantity(goldst_data['decimals'], goldst_data['name'], qty)
    
    # Gold ounce balance
    if GOLD_OUNCE_ROOT in raw_assets:
        oz_data = raw_assets[GOLD_OUNCE_ROOT]
        for (owner, _), qty in oz_data['balances'].items():
            if owner == user:
                total += correct_quantity(oz_data['decimals'], oz_data['name'], qty)
    
    # Gold gram balance (convert to oz)
    if GOLD_GRAM_ROOT in raw_assets:
        gram_data = raw_assets[GOLD_GRAM_ROOT]
        for (owner, _), qty in gram_data['balances'].items():
            if owner == user:
                scaled = correct_quantity(gram_data['decimals'], gram_data['name'], qty)
                total += gramsToOz(scaled)
    
    return total

def consolidate_silver_for_user(
    user: str,
    raw_assets: Dict[str, Dict]
) -> int:
    """
    Consolidate all silver balances for a user (SILVST + alt silver).
    
    Args:
        user: User address
        raw_assets: Dictionary of raw asset data
    
    Returns:
        Total consolidated silver balance (18 decimals)
    """
    total = 0
    
    # SILVST balance
    if SILVST_ROOT in raw_assets:
        silvst_data = raw_assets[SILVST_ROOT]
        for (owner, _), qty in silvst_data['balances'].items():
            if owner == user:
                total += correct_quantity(silvst_data['decimals'], silvst_data['name'], qty)
    
    # Alt silver balance
    if ALT_SILVST_ROOT in raw_assets:
        alt_data = raw_assets[ALT_SILVST_ROOT]
        for (owner, _), qty in alt_data['balances'].items():
            if owner == user:
                total += correct_quantity(alt_data['decimals'], alt_data['name'], qty)
    
    return total

def add_system_balances(asset_root: str) -> Dict[str, int]:
    """
    Get hardcoded system balances for an asset.
    
    These are special balances defined in HeliumGenesisBlock.hs that
    don't come from GenesisAssets.
    
    Args:
        asset_root: Asset root address
    
    Returns:
        Dictionary of address -> balance
    """
    balances = {}
    
    if asset_root == ETHST_ROOT:
        balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
        balances[ETHST_POOL_ADDRESS] = 11_129_288_949_700_000_000
    
    elif asset_root == WBTCST_ROOT:
        balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
        balances[WBTCST_POOL_ADDRESS] = (425 * ONE_E18) // 1000
    
    elif asset_root == GOLDST_ROOT:
        balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
        balances[GOLDST_POOL_ADDRESS] = (151 * ONE_E18) // 10
    
    elif asset_root == SILVST_ROOT:
        balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
        balances[SILVST_POOL_ADDRESS] = (13_125 * ONE_E18) // 10
    
    return balances

# =============================================================================
# UTILITY FUNCTIONS - Helpers
# =============================================================================

def is_special_address(address: str) -> bool:
    """Check if address is a special system address to exclude from comparison."""
    return address.lower() in SPECIAL_ADDRESSES

def create_sql_file(sql_content: str, filepath: str) -> None:
    """Create SQL file with given content"""
    with open(filepath, 'w') as f:
        f.write(sql_content)

def run_command(command: str, description: str) -> bool:
    """Run a shell command and return success status"""
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"{description} completed")
            if result.stdout.strip():
                print(f"Output: {result.stdout.strip()}")
            return True
        else:
            print(f"{description} failed: {result.stderr}")
            return False
    except Exception as e:
        print(f"{description} error: {e}")
        return False

# =============================================================================
# PARSING FUNCTIONS - Genesis Data
# =============================================================================

def parse_genesis_escrows() -> List[Dict[str, Any]]:
    """
    Parse GenesisEscrows.hs to extract escrow collateral data.
    
    Extracts:
    - Escrow asset root address
    - Borrower address
    - Borrowed amount (USDST debt)
    - Collateral quantity (staked assets)
    
    Returns:
        List of escrow dictionaries with parsed data
    """
    escrows_file = "strato/core/strato-genesis/src/Blockchain/GenesisBlocks/Instances/GenesisEscrows.hs"
    
    with open(escrows_file, 'r') as f:
        content = f.read()
    
    # Match escrow entries: Escrow ADDRESS ROOT (BORROWED) BORROWER "name" (COLLATERAL) ...
    # Format: Escrow 0xADDR 0xROOT (BORROWED) 0xBORROWER "name" (COLLATERAL) ...
    escrow_pattern = r'Escrow\s+0x[a-fA-F0-9]+\s+0x([a-fA-F0-9]+)\s+\((\d+)\)\s+0x([a-fA-F0-9]+)\s+"[^"]*"\s+\((\d+)\)'
    escrow_matches = re.findall(escrow_pattern, content)
    
    escrows = []
    for match in escrow_matches:
        root, borrowed, borrower, collateral = match
        escrows.append({
            'root': root.lower(),
            'borrower': borrower.lower(),
            'borrowedAmount': int(borrowed),
            'collateralQuantity': int(collateral),
            'decimals': 0  # Will be looked up from assets
        })
    
    print(f"Parsed {len(escrows)} escrow entries from GenesisEscrows.hs")
    return escrows

def parse_genesis_assets() -> List[Dict[str, Any]]:
    """
    Parse GenesisAssets.hs to extract and process asset balances.
    
    This function replicates the Haskell assetBalances function logic:
    1. Parse raw asset definitions
    2. Process escrows (sum, scale, convert based on asset type)
    3. Consolidate legacy assets (gold gram/oz → GOLDST, alt silver → SILVST)
    4. Apply escrow subtractions (move staked amounts to CDP_VAULT_ADDRESS)
    5. Handle special system balances (hardcoded values)
    
    Critical: Gold gram and gold ounce escrows store RAW unscaled quantities,
    but GOLDST escrows store already-scaled quantities.
    
    Returns:
        List of processed asset balance dictionaries
    """
    assets_file = "strato/core/strato-genesis/src/Blockchain/GenesisBlocks/Instances/GenesisAssets.hs"
    
    with open(assets_file, 'r') as f:
        content = f.read()
    
    # Split content into individual Asset entries
    asset_entries = re.split(r'\s*,\s*Asset\s+"', content)
    
    # First pass: collect all balances by asset root
    raw_assets = {}
    
    for i, entry in enumerate(asset_entries):
        if i == 0:
            entry = entry.split('assets =')[1] if 'assets =' in entry else entry
            entry = entry.lstrip(' \n[')
        
        if not entry.strip():
            continue
        
        if i > 0:
            entry = 'Asset "' + entry
        
        # Match: Asset "Type" 0xROOT "Name" "Description" (DECIMALS)
        asset_match = re.search(r'Asset\s+"[^"]+"\s+0x([a-fA-F0-9]+)\s+"([^"]+?)".+?\((\d+)\)\s+\(fromList', entry, re.DOTALL)
        
        if not asset_match:
            continue
        
        asset_root = asset_match.group(1).lower()
        asset_name = asset_match.group(2)
        decimals = int(asset_match.group(3))
        
        balance_pattern = r'Balance\s+0x([a-fA-F0-9]+)\s+0x([a-fA-F0-9]+)\s+"([^"]*)"\s+\((\d+)\)'
        balance_matches = re.findall(balance_pattern, entry)
        
        if asset_root not in raw_assets:
            raw_assets[asset_root] = {
                'name': asset_name,
                'decimals': decimals,
                'balances': {}
            }
        
        for balance_match in balance_matches:
            balance_contract, owner, comment, quantity = balance_match
            owner = owner.lower()
            raw_assets[asset_root]['balances'][(owner, comment)] = int(quantity)
    
    # =========================================================================
    # STEP 1: Parse and Process Escrows Using Primitives
    # =========================================================================
    
    genesis_escrows = parse_genesis_escrows()
    
    # Build escrow lookup: (consolidated_root, borrower) -> scaled_quantity
    escrow_lookup = {}
    
    # Group escrows by asset root first
    escrows_by_root = {}
    for escrow in genesis_escrows:
        root = escrow['root']
        if root not in escrows_by_root:
            escrows_by_root[root] = []
        escrows_by_root[root].append(escrow)
    
    # Process each asset's escrows
    for root, root_escrows in escrows_by_root.items():
        # Get asset data for scaling
        asset_data = raw_assets.get(root, {'decimals': 18, 'name': 'UNKNOWN'})
        
        # Sum raw escrows by user
        user_totals = sum_raw_escrows_by_user(root, root_escrows)
        
        # Scale and convert each user's total
        for user, raw_total in user_totals.items():
            # Handle address migration
            if user == BLOCKAPPS_OLD_ADDRESS:
                user = BLOCKAPPS_ADDRESS
            
            # Scale and convert using primitive
            scaled_qty, target_root = scale_and_convert_escrow(root, raw_total, asset_data)
            
            # Add to lookup
            key = (target_root, user)
            escrow_lookup[key] = escrow_lookup.get(key, 0) + scaled_qty
    
    # =========================================================================
    # STEP 3: Process Asset Balances (Matching Haskell assetBalances)
    # =========================================================================
    
    processed_assets = []
    
    for root, asset_data in raw_assets.items():
        name = asset_data['name']
        decimals = asset_data['decimals']
        balances = asset_data['balances']
        
        # Skip legacy assets (they get consolidated into GOLDST/SILVST)
        if root in [GOLD_OUNCE_ROOT, GOLD_GRAM_ROOT, ALT_SILVST_ROOT]:
            continue
        
        result_balances = {}
        
        # Add hardcoded system balances (matching Haskell's special cases)
        if root == ETHST_ROOT:
            result_balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
            result_balances[ETHST_POOL_ADDRESS] = 11_129_288_949_700_000_000
        elif root == WBTCST_ROOT:
            result_balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
            result_balances[WBTCST_POOL_ADDRESS] = (425 * ONE_E18) // 1000
        elif root == GOLDST_ROOT:
            result_balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
            result_balances[GOLDST_POOL_ADDRESS] = (151 * ONE_E18) // 10
        elif root == SILVST_ROOT:
            result_balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
            result_balances[SILVST_POOL_ADDRESS] = (13_125 * ONE_E18) // 10
        
        # Process user balances with consolidation logic
        if root == GOLDST_ROOT:
            # Collect ALL unique users across all gold assets
            all_gold_users = set()
            
            # Users from GOLDST
            for (owner, _), _ in balances.items():
                all_gold_users.add(owner)
            
            # Users from Gold Ounce
            if GOLD_OUNCE_ROOT in raw_assets:
                for (owner, _), _ in raw_assets[GOLD_OUNCE_ROOT]['balances'].items():
                    all_gold_users.add(owner)
            
            # Users from Gold Gram
            if GOLD_GRAM_ROOT in raw_assets:
                for (owner, _), _ in raw_assets[GOLD_GRAM_ROOT]['balances'].items():
                    all_gold_users.add(owner)
            
            # Consolidate for each unique user
            for owner in all_gold_users:
                total_gold = consolidate_gold_for_user(owner, raw_assets)
                if total_gold > 0:
                    result_balances[owner] = total_gold
        elif root == SILVST_ROOT:
            # Collect ALL unique users across all silver assets
            all_silver_users = set()
            
            # Users from SILVST
            for (owner, _), _ in balances.items():
                all_silver_users.add(owner)
            
            # Users from Alt Silver
            if ALT_SILVST_ROOT in raw_assets:
                for (owner, _), _ in raw_assets[ALT_SILVST_ROOT]['balances'].items():
                    all_silver_users.add(owner)
            
            # Consolidate for each unique user
            for owner in all_silver_users:
                total_silver = consolidate_silver_for_user(owner, raw_assets)
                if total_silver > 0:
                    result_balances[owner] = total_silver
        else:
            # All other assets: process normally
            for (owner, comment), quantity in balances.items():
                if root == USDST_ROOT and comment == "mercata_usdst":
                    # Special USDST handling
                    result_balances[BLOCKAPPS_ADDRESS] = 1_000_000 * ONE_E18
                    result_balances[BRIDGE_RELAYER_ADDRESS] = 1_000 * ONE_E18
                    result_balances[ORACLE_ADDRESS1] = 1_000 * ONE_E18
                    result_balances[ORACLE_ADDRESS2] = 1_000 * ONE_E18
                    result_balances[ETHST_POOL_ADDRESS] = 50_000 * ONE_E18
                    result_balances[WBTCST_POOL_ADDRESS] = 50_000 * ONE_E18
                    result_balances[GOLDST_POOL_ADDRESS] = 50_000 * ONE_E18
                    result_balances[SILVST_POOL_ADDRESS] = 50_000 * ONE_E18
                    result_balances[LIQUIDITY_POOL_ADDRESS] = 250_000 * ONE_E18
                else:
                    # All other assets: just apply correctQuantity
                    scaled_qty = correct_quantity(decimals, name, quantity)
                    if owner in result_balances:
                        result_balances[owner] += scaled_qty
                    else:
                        result_balances[owner] = scaled_qty
        
        # =====================================================================
        # STEP 4: Apply Escrows - Move Staked Amounts to CDP_VAULT_ADDRESS
        # =====================================================================
        
        final_balances = {}
        for owner, qty in result_balances.items():
            # Handle BlockApps address migration
            if owner == BLOCKAPPS_OLD_ADDRESS:
                # Migrate old BlockApps address to new one
                owner = BLOCKAPPS_ADDRESS
            
            escrow_key = (root, owner)
            escrow_balance = escrow_lookup.get(escrow_key, 0)
            
            if escrow_balance > 0:
                # User gets max(0, balance - escrow)
                user_balance = max(0, qty - escrow_balance)
                if user_balance > 0:
                    final_balances[owner] = user_balance
                
                # CDP_VAULT_ADDRESS gets the escrow amount
                if CDP_VAULT_ADDRESS in final_balances:
                    final_balances[CDP_VAULT_ADDRESS] += escrow_balance
                else:
                    final_balances[CDP_VAULT_ADDRESS] = escrow_balance
            else:
                # No escrow, user keeps full balance
                final_balances[owner] = qty
        
        # Convert to list format
        for owner, qty in final_balances.items():
            if qty > 0:
                output_name = name
                if root == SILVST_ROOT:
                    output_name = "SILVST"
                elif root == GOLDST_ROOT:
                    output_name = "GOLDST"
                
                processed_assets.append({
                    'root': root,
                    'owner': owner,
                    'name': output_name,
                    'quantity': qty,
                    'decimals': decimals
                })
    
    print(f"Parsed {len(processed_assets)} asset balances from GenesisAssets.hs (after Haskell-style processing with escrows)")
    print(f"  Unique asset roots: {len(set(a['root'] for a in processed_assets))}")
    print(f"  Unique owners: {len(set(a['owner'] for a in processed_assets))}")
    
    return processed_assets

# =============================================================================
# DATABASE FUNCTIONS - Testnet Data
# =============================================================================

def fetch_testnet_data() -> bool:
    """
    Fetch testnet asset balances from local PostgreSQL database.
    
    Queries the ERC20 _balances mapping to get current on-chain balances.
    
    Returns:
        True if successful, False otherwise
    """
    local_db_params = "-h localhost -p 5432 -U postgres -d cirrus"
    
    testnet_balances_sql = f'''\\copy (SELECT m.key->>'key' AS owner, s.address AS asset, s.data->>'_name' AS name, SUM(m.value::numeric) AS total_balance FROM mapping m JOIN storage s ON m.address = s.address WHERE s."contract_name" = 'Proxy' AND m."collection_name" = '_balances' GROUP BY owner, asset, name HAVING SUM(m.value::numeric) > 0 ORDER BY asset, total_balance DESC) TO '/tmp/testnet_balances.csv' CSV HEADER;'''
    
    create_sql_file(testnet_balances_sql, '/tmp/testnet_balances.sql')
    
    testnet_balances_cmd = f'PGPASSWORD=api psql {local_db_params} -f /tmp/testnet_balances.sql'
    if not run_command(testnet_balances_cmd, "Fetching testnet balances from local"):
        return False
    
    copy_cmd = 'cp /tmp/testnet_balances.csv testnet_balances_raw.csv'
    if not run_command(copy_cmd, "Copying testnet balances"):
        return False
    
    os.remove('/tmp/testnet_balances.sql')
    return True

def read_testnet_assets_csv(filepath: str) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """
    Read testnet asset balances from CSV file.
    
    Returns:
        Dictionary mapping (asset, owner) -> {'name': str, 'quantity': int}
    """
    testnet_data = {}
    
    with open(filepath, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            owner = row['owner'].lower()
            asset = row['asset'].lower()
            name = row['name']
            # Parse as Decimal first to avoid float precision loss with large integers
            from decimal import Decimal
            quantity = int(Decimal(row['total_balance']))
            
            if not is_special_address(owner):
                testnet_data[(asset, owner)] = {
                    'name': name,
                    'quantity': quantity
                }
    
    return testnet_data

# =============================================================================
# COMPARISON FUNCTIONS
# =============================================================================

def compare_assets(testnet_data: Dict, genesis_data: Dict) -> List[Dict[str, Any]]:
    """
    Compare testnet and genesis asset data to find discrepancies.
    
    Excludes:
    - BlockApps address balances for hardcoded assets
    - Special system addresses
    
    Returns:
        List of differences with asset, owner, quantities, and delta
    """
    testnet_keys = set(testnet_data.keys())
    genesis_keys = set(genesis_data.keys())
    
    only_in_testnet = testnet_keys - genesis_keys
    only_in_genesis = genesis_keys - testnet_keys
    common_keys = testnet_keys & genesis_keys
    
    print(f"Testnet assets: {len(testnet_data)}")
    print(f"Genesis assets: {len(genesis_data)}")
    print(f"Only in testnet: {len(only_in_testnet)}")
    print(f"Only in genesis: {len(only_in_genesis)}")
    print(f"Common: {len(common_keys)}")
    
    # Check for quantity differences in common assets
    # Exclude blockappsAddress for hardcoded assets since those are intentionally different
    differences = []
    blockapps_excluded = 0
    for key in common_keys:
        asset_root, owner = key
        
        # Skip blockappsAddress for assets that have hardcoded values in HeliumGenesisBlock.hs
        if owner == BLOCKAPPS_ADDRESS and asset_root in HARDCODED_BLOCKAPPS_ASSETS:
            blockapps_excluded += 1
            continue
        
        # Skip blockappsAddress for USDST since it's also hardcoded
        if owner == BLOCKAPPS_ADDRESS and asset_root == USDST_ROOT:
            blockapps_excluded += 1
            continue
            
        testnet_qty = testnet_data[key]['quantity']
        genesis_qty = genesis_data[key]['quantity']
        if testnet_qty != genesis_qty:
            differences.append({
                'asset': asset_root,
                'owner': owner,
                'testnet_qty': testnet_qty,
                'genesis_qty': genesis_qty,
                'difference': testnet_qty - genesis_qty
            })
    
    if blockapps_excluded > 0:
        print(f"Excluded {blockapps_excluded} blockappsAddress entries with hardcoded genesis values")
    
    return differences

def write_differences_csv(differences: List[Dict[str, Any]], testnet_data: Dict) -> None:
    """
    Write comparison differences to CSV file.
    
    Output: asset_delta.csv
    Columns: originAddress, owner, testnet_name, prod_name, testnet_quantity, prod_quantity, delta
    """
    with open('asset_delta.csv', 'w', newline='') as csvfile:
        fieldnames = ['originAddress', 'owner', 'testnet_name', 'prod_name', 'testnet_quantity', 'prod_quantity', 'delta']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        
        sorted_diffs = sorted(differences, key=lambda x: abs(x['difference']), reverse=True)
        for diff in sorted_diffs:
            testnet_name = testnet_data.get((diff['asset'], diff['owner']), {}).get('name', '')
            writer.writerow({
                'originAddress': diff['asset'],
                'owner': diff['owner'],
                'testnet_name': testnet_name,
                'prod_name': testnet_name,
                'testnet_quantity': diff['testnet_qty'],
                'prod_quantity': diff['genesis_qty'],
                'delta': diff['difference']
            })

# =============================================================================
# MAIN EXECUTION
# =============================================================================

def main():
    """
    Main execution function.
    
    Steps:
    1. Fetch testnet data from local database
    2. Parse genesis configuration files
    3. Compare balances
    4. Write differences to CSV
    """
    print("Starting Genesis vs Testnet Asset Comparison...")
    
    if not fetch_testnet_data():
        print("Data fetch failed")
        return
    
    # Read testnet data
    testnet_data = read_testnet_assets_csv('testnet_balances_raw.csv')
    
    # Get genesis data directly (already includes escrow transfers to CDP_VAULT_ADDRESS)
    genesis_assets = parse_genesis_assets()
    
    # Convert genesis assets to the same format as testnet data
    genesis_data = {}
    for asset in genesis_assets:
        if not is_special_address(asset['owner']):
            key = (asset['root'], asset['owner'])
            genesis_data[key] = {
                'name': asset['name'],
                'quantity': asset['quantity']
            }
    
    # Compare assets
    differences = compare_assets(testnet_data, genesis_data)
    
    print(f"Quantity differences: {len(differences)}")
    
    if differences:
        print("\nTop 10 differences:")
        sorted_diffs = sorted(differences, key=lambda x: abs(x['difference']), reverse=True)
        for diff in sorted_diffs[:10]:
            print(f"  {diff['asset'][:8]}... {diff['owner'][:8]}... "
                  f"testnet: {diff['testnet_qty']:,} genesis: {diff['genesis_qty']:,} "
                  f"diff: {diff['difference']:,}")
        
        # Write differences to CSV
        write_differences_csv(differences, testnet_data)
        print(f"\nWrote {len(differences)} differences to asset_delta.csv")
    
    # Clean up temporary files
    if os.path.exists('testnet_balances_raw.csv'):
        os.remove('testnet_balances_raw.csv')
        print("Cleaned up temporary testnet_balances_raw.csv file")

if __name__ == "__main__":
    main()
