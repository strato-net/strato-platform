#!/bin/python3

import ast
import base64
import requests
import subprocess

import credentials


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
