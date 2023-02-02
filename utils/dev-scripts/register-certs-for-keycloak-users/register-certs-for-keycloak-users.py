#!/bin/python3

import ast
import base64
import requests
import subprocess

import credentials



# TODO: call https://vault.mercata-testnet-staging-mts2j0d.blockapps.net:8093/strato/v2.3/users to get the list of users in shared vault
# Response format:
# [
#     {
#         "username": "7a49633d-7608-451d-a74a-56cc9a78a6fc",
#         "address": "07a4d47662ebe7fc49a62f40892bf04572309c68"
#     },
#     {
#         "username": "9d348133-8baf-4bf4-b79f-d930a24e89f7",
#         "address": "e098d5625a131d6b9d6712a41a3a44b8b7214714"
#     },
#     {
#         "username": "c8745d25-51db-4f38-a665-a121705a79d4",
#         "address": "bb915655220140baf5f7bd4abd9f412771a53681"
#     },
#     {
#         "username": "6a7d086a-b565-4547-8896-17b2131196af",
#         "address": "ce7818c494c77ba92f170600f9097443b42d4bd0"
#     }
# ]





# TODO: get the list of usernames from that response

# TODO: get the COMMON NAME (full name?) and ORGANIZATION for each of the user id in the list

# TODO: register certs for each user




































def _get_keycloak_token(realm_name, client_id, client_secret, username=None, password=None):
    basic_token = base64.b64encode(bytes('%s:%s' % (client_id, client_secret), 'utf-8')).decode('utf-8')
    url = "https://keycloak.blockapps.net/auth/realms/%s/protocol/openid-connect/token" % realm_name
    payload = {
        'grant_type': 'client_credentials' if not username else 'password',
        'username': username,
        'password': password
    }
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic %s' % basic_token
    }
    resp = requests.request("POST", url, headers=headers, data=payload)
    return ast.literal_eval(resp.text)['access_token']


def get_keycloak_master_token():
    creds = credentials.KEYCLOAK_CREDENTIALS['master']
    return _get_keycloak_token(
        'master',
        creds['client_id'],
        creds['client_secret']
    )


def get_keycloak_mercata_users():
    offset = 0
    result = []
    while True:
        url = 'https://keycloak.blockapps.net/auth/admin/realms/mercata-testnet/users?first={offset}&max=100'.format(offset=offset)
        headers = {
            'content-type': 'application/json',
            'Authorization': 'Bearer %s' % get_keycloak_master_token()
        }
        resp = requests.get(url, headers=headers)
        resp_json = resp.json()
        result += resp_json
        if len(resp_json) < 100:
            break
        else:
            offset += 100
    return result


if __name__ == '__main__':

    keycloak_users = get_keycloak_mercata_users()
    username_id_mapping = {u['username']: u['id'] for u in keycloak_users}

    print('Number of users obtained from Keycloak: %s' % len(username_id_mapping))

    updated_users = []
    failed_users = []

    for username, uuid in username_id_mapping.items():
        try:
            subprocess.check_call(['sudo docker exec vault_postgres_1 bash -c "PGPASSWORD=api psql -U postgres -h postgres oauth -c \\"UPDATE users SET x_user_unique_name = \'{uuid}\' where x_user_unique_name=\'{username}\';\\""'
                             .format(uuid=uuid, username=username)], shell=True)
            updated_users.append({username: uuid})
        except Exception as e:
            failed_users.append({username: e})

    print('Keycloak users processed: %s' % len(updated_users))
    if len(failed_users):
        print('FAILED UPDATES:')
        for username, err in failed_users.items():
            print('{username} : {error}'.format(username=username, error=err))

    pass
