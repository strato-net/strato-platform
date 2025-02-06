import random
import requests as requests
import os
from dotenv import load_dotenv
from collections import defaultdict

load_dotenv()

mercata_username  = os.getenv("MINTER_USERNAME")
mercata_password  = os.getenv("MINTER_PASSWORD")
mercata_node      = os.getenv("NODE_ENDPOINT") 
keycloak_endpoint = os.getenv("KEYCLOAK_ENDPOINT")
strat_asset_address     = os.getenv("STRAT_ASSET_ADDRESS")
usdst_address     = os.getenv("USDST_ASSET_ADDRESS")
cirrus_endpoint   = "/cirrus/search/"


# Emulates blockapps-rest util function 'uid()'
def uid(prefix=None, digits=6):
    digits = max(1, min(16, digits))
    random_number = random.randint(0, 10**digits - 1)

    if prefix is None:
        return f"{random_number:0{digits}d}"
    else:
        return f"{prefix}_{random_number:0{digits}d}"

def transform_response_to_tuple_list(response_data):
    owner_quantities = defaultdict(int)

    for item in response_data:
        owner = item['owner']
        quantity = item['quantity']
        owner_quantities[owner] += quantity

    return [(owner, total_quantity) for owner, total_quantity in owner_quantities.items()]

def generate_tx(address, balance):
    return {
        "payload": {
            "contractName": "Tokens",
            "contractAddress": usdst_address,
            "method": "automaticTransfer",
            "args": {
                "_newOwner": address,
                "_price": 0.000000000000000001,
                "_quantity": balance * (10**14),
                "_transferNumber": int(uid())
            }
        },
        "type": "FUNCTION"
    }

def main():
    if None in (mercata_username, mercata_password, mercata_node, keycloak_endpoint, usdst_address):
        raise ValueError("One or more required environment variables are not set.")

    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic bG9jYWxob3N0OjdlYTRiODJhLTJjYTktNDMwZC05YTZmLWZhOTk4NWQ5N2Y5Yg=='
    }

    data = {
        'grant_type': 'password',
        'username': mercata_username,
        'password': mercata_password 
    }

    response = requests.post(keycloak_endpoint, headers=headers, data=data)

    access_token = response.json()["access_token"]

    headers = {
        'Authorization': 'Bearer ' + access_token,
        'Content-Type': 'application/json'
    }

    # Get the balances and create a list of tuples that contains (address, balance)
    balances_endpoint = mercata_node + cirrus_endpoint + "BlockApps-Mercata-Asset?select=owner,quantity&root=eq." + strat_asset_address + "&ownerCommonName=neq." + mercata_username
    response = requests.get(balances_endpoint, headers=headers)
    balances = transform_response_to_tuple_list(response.json())

    chunk_size = 25

    # Loop through balances in chunks of 25
    for i in range(0, len(balances), chunk_size):
        chunk = balances[i:i + chunk_size]
        post_response = requests.post(
            mercata_node + '/strato/v2.3/transaction?resolve=true',
            headers=headers,
            json={'txs': [generate_tx(a, b) for (a, b) in chunk]}
        )

        # Handle the response if necessary
        if post_response.status_code == 200:
            print(f"Chunk {i // chunk_size + 1} posted successfully.")
        else:
            print(f"Error in chunk {i // chunk_size + 1}: {post_response.json()}")

if __name__ == "__main__":
    main()
