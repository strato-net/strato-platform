import random
import requests as requests
import os
from dotenv import load_dotenv

load_dotenv()

mercata_username  = os.getenv("MINTER_USERNAME")
mercata_password  = os.getenv("MINTER_PASSWORD")
mercata_node      = os.getenv("NODE_ENDPOINT") 
keycloak_endpoint = os.getenv("KEYCLOAK_ENDPOINT")
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
    return [(item['key'], item['value']) for item in response_data]

def generate_tx(address, balance):
    return {
        "payload": {
            "contractName": "USDSTToken",
            "contractAddress": usdst_address,
            "method": "automaticTransfer",
            "args": {
                "_newOwner": address,
                "_price": 0.0001,
                "_quantity": balance * (10**18),
                "_transferNumber": int(uid()),
                "_description": "<p><strong>What is USDST</strong></p><p style=\"text-align: start\"></p><p style=\"text-align: start\"><strong><span style=\"font-size: 12px\">Loyalty Points</span></strong><span style=\"font-size: 12px\">: USDST are digital points that are roughly pegged to the US dollar and provided to customers for their participation and interactions on the STRATO Mercata Marketplace.</span></p><p style=\"text-align: start\"><strong><span style=\"font-size: 12px\">Reward Mechanism</span></strong><span style=\"font-size: 12px\">: USDST are part of our rewards system, designed to incentivize and recognize engagement and loyalty.</span></p><p style=\"text-align: start\"><strong><span style=\"font-size: 12px\">Redeemable Assets</span></strong><span style=\"font-size: 12px\">: Customers can use their USDST to redeem marketplace items, and access special offers.</span></p><p style=\"text-align: start\"><strong><span style=\"font-size: 12px\">Empowering the Community</span></strong><span style=\"font-size: 12px\">: By engaging with USDST, you’re not just earning rewards; you’re actively contributing to the development and success of the Mercata protocol, embodying the spirit of decentralized growth.</span></p><p style=\\\"text-align: start\\\"><span style=\\\"font-size: 12px\\\">For more information, please refer to the VIP Program Terms of Use found on the&nbsp;</span><a target=\\\"_blank\\\" rel=\\\"noopenernoreferrernofollow\\\" href="https://blockapps.net/"><span style=\\\"color: #0000ff;font-size: 12px;color: #0000ff\\\">BlockApps website</span></a><span style=\\\"font-size: 12px\\\">.</span></p>"
                "_itemNumber": "",
                "_name": "USDST",
                "_ownerCommonName": "",
                "_sale": null,
                "_status": "1",
                
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
    balances_endpoint = mercata_node + cirrus_endpoint + "BlockApps-Mercata-Asset?name=eq.STRAT"
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
