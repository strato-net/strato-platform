import requests as requests
import os
from dotenv import load_dotenv

load_dotenv()

mercata_username  = os.getenv("MINTER_USERNAME")
mercata_password  = os.getenv("MINTER_PASSWORD")
mercata_node      = os.getenv("NODE_ENDPOINT") 
keycloak_endpoint = os.getenv("KEYCLOAK_ENDPOINT")
strat_address     = os.getenv("STRAT_ASSET_ADDRESS")
cirrus_endpoint   = "/cirrus/search/"

def transform_response_to_tuple_list(response_data):
    return [(item['key'], item['value']) for item in response_data]

def generate_tx(address, balance):
    return {
        "payload": {
            "contractName": "STRATSToken",
            "contractAddress": strat_address,
            "method": "automaticTransfer",
            "args": {
                "_newOwner": address,
                "_price": 0, # TODO what should this value truly be?
                "_quantity": balance,
                "_transferNumber": 0 # TODO same goes for this

            }
        },
        "type": "FUNCTION"
    }

def main():
    if None in (mercata_username, mercata_password, mercata_node, keycloak_endpoint, strat_address):
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
    balances_endpoint = mercata_node + cirrus_endpoint + "TestCompany-ERC20Dapp-balances"
    response = requests.get(balances_endpoint, headers=headers)
    balances = transform_response_to_tuple_list(response.json())

    # print([generate_tx(a, b) for (a, b) in balances])
    requests.post(
            mercata_node + '/strato/v2.3/transaction?resolve=true',
            headers=headers,
            json={ 'txs': [generate_tx(a, b) for (a, b) in balances] }
        )

if __name__ == "__main__":
    main()
