#!/bin/python3

import requests
import base64
import time
import sys

def wait_for_slipstream_to_sync(node1_url, node2_url, headers1, headers2, attempts, sleep_time):
    attempt = 0
    while True:
        attempt += 1
        try:
            response1 = requests.get(node1_url + "/cirrus/search/BlockApps-Mercata-Asset", headers=headers1, params={'order':'block_timestamp.desc', 'limit':1})
            response2 = requests.get(node2_url + "/cirrus/search/BlockApps-Mercata-Asset", headers=headers2, params={'order':'block_timestamp.desc', 'limit':1})
            if response1.ok and response2.ok:
                block_number1 = response1.json()[0]["block_number"]
                block_number2 = response2.json()[0]["block_number"]
                if block_number1 == block_number2:
                    print(f"Nodes are in sync with block number: {block_number1}")
                    break
                else:
                    print(f"Slipstream of node1 is at block {block_number1}, but Node2 is at block {block_number2} (attempt #{attempt})")
            else:
                print(f"Failed to fetch data for one of the nodes (attempt #{attempt})")
        except Exception as e:
            print(f"Slipstream sync test exception occurred: {e}")
            sys.exit(1)
        if attempts != 0 and attempt == attempts:
            print(f"Failed to find the slipstream being in sync for the nodes. Made {attempts} attempts with sleep time {sleep_time}sec")
            sys.exit(1) 
        else:
          print(f"Retrying in {sleep_time} seconds...")
          time.sleep(sleep_time)

def get_auth_token(client_id, client_secret, realm_name):
    basic_token = base64.b64encode(bytes('%s:%s' % (client_id, client_secret), 'utf-8')).decode('utf-8')
    url = "https://keycloak.blockapps.net/auth/realms/%s/protocol/openid-connect/token" % realm_name
    payload = {
        'grant_type': 'client_credentials'
    }
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic %s' % basic_token
    }
    resp = requests.request("POST", url, headers=headers, data=payload)
    return resp.json()['access_token']

def check_table(table):
    discrepancies, count = False, False
    print("Checking table ", table)
    endpoint = "/cirrus/search/" + table
    a1_resp = requests.get(node1_url + endpoint, headers=headers1).json()
    a2_resp = requests.get(node2_url + endpoint, headers=headers2).json()

    assets1 = {a['address'] : a for a in a1_resp}
    assets2 = {a['address'] : a for a in a2_resp}

    count1 = len(a1_resp)
    count2 = len(a2_resp)
    print(f"Table '{table}': jenkins node count = {count1}, node1 count = {count2}")
    if(count1 != count2):
        count=True
        print(f"Count discrepancy found for table '{table}': jenkins node has {count1} entries, node1 has {count2} entries.")

    in1Not2 = set(assets1.keys()).difference(set(assets2.keys()))
    if len(in1Not2) > 0:
        print("found in ", node1_url, " but not in ", node2_url, ": ", in1Not2)
        # discrepancies = True
    in2Not1 = set(assets2.keys()).difference(set(assets1.keys()))
    if len(in2Not1) > 0:
        print("found in ", node2_url, " but not in ", node1_url, ": ", in2Not1)
        # discrepancies = True

    for a in assets1.keys():
        if a not in assets2.keys():
            print(a, " is in ", node1_url, "but not in ", node2_url)
            # discrepancies = True
        else:
            if assets1[a] != assets2[a]:
                print("inconsistency at ", a)
                for k in assets1[a].keys():
                    if assets1[a][k] != assets2[a][k]:
                        #Only on contract name for now
                        if k=='contract_name':
                            print("\t", a, " on ", node1_url, " has ", k, ": ", assets1[a][k])
                            print("\t", a, " on ", node2_url, " has ", k, ": ", assets2[a][k])
                            discrepancies = True
                        else:
                            print("\t", a, " on ", node1_url, " has ", k, ": ", assets1[a][k])
                            print("\t", a, " on ", node2_url, " has ", k, ": ", assets2[a][k])

    return discrepancies, count


if __name__ == "__main__":
    if len(sys.argv) < 7 or len(sys.argv) > 9:
        print('Incorrect number of arguments supplied. Expected 6-8 arguments.')
        sys.exit(1)

    DEFAULT_ATTEMPTS = 0  # 0 for infinite
    DEFAULT_SLEEP_TIME = 30

    client_id1 = sys.argv[1]
    client_id2 = sys.argv[2]
    client_secret1 = sys.argv[3]
    client_secret2 = sys.argv[4]
    realm_1 = sys.argv[5]
    realm_2 = sys.argv[6]
    attempts = sys.argv[7] if len(sys.argv) > 7 else DEFAULT_ATTEMPTS
    sleep_time = sys.argv[8] if len(sys.argv) > 8 else DEFAULT_SLEEP_TIME

    node1_url = "http://localhost"
    node2_url = "https://node1.mercata-testnet2.blockapps.net"

    token1 = get_auth_token(client_id1, client_secret1, realm_1)
    token2 = get_auth_token(client_id2, client_secret2, realm_2)
    headers1 = {'Authorization': f'Bearer {token1}'}
    headers2 = {'Authorization': f'Bearer {token2}'}

    # Wait until both nodes have the same latest block indexed in Slipstream
    wait_for_slipstream_to_sync(node1_url, node2_url, headers1, headers2, attempts, sleep_time)

    discrepancies_asset, count_asset_discrepancy = check_table("BlockApps-Mercata-Asset")
    discrepancies_sale, count_sale_discrepancy = check_table("BlockApps-Mercata-Order")
    discrepancies_order, count_order_discrepancy = check_table("BlockApps-Mercata-Sale")
    
        # Print the results
    print("\nFinal check summary:")
    print(f"Asset Discrepancies: {'Yes' if discrepancies_asset else 'No'}")
    print(f"Order Discrepancies: {'Yes' if discrepancies_order else 'No'}")
    print(f"Sale Discrepancies: {'Yes' if discrepancies_sale else 'No'}")
    print(f"Asset Count Match Discrepancies: {'Yes' if count_asset_discrepancy else 'No'}")
    print(f"Order Count Match Discrepancies: {'Yes' if count_order_discrepancy else 'No'}")
    print(f"Sale Count Match Discrepancies: {'Yes' if  count_sale_discrepancy else 'No'}")
        
    if discrepancies_asset or discrepancies_sale or discrepancies_order or count_asset_discrepancy or count_sale_discrepancy or count_order_discrepancy:
        sys.exit(1)
