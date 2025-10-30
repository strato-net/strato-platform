#!/bin/python3

import ast
import base64
import json
import requests
import subprocess

import credentials


class MercataManager:

    vault_url = 'https://vault.mercata-testnet-staging-mts2j0d.blockapps.net:8093'  # should be parametrized
    node_url = 'https://node1.mercata-testnet-staging-mts2j0d.blockapps.net'

    @staticmethod
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

    @staticmethod
    def get_keycloak_master_token():
        creds = credentials.KEYCLOAK_CREDENTIALS['master']
        return MercataManager._get_keycloak_token(
            'master',
            creds['client_id'],
            creds['client_secret']
        )

    @staticmethod
    def get_keycloak_mercata_token():
        creds = credentials.KEYCLOAK_CREDENTIALS['mercata-testnet']
        return MercataManager._get_keycloak_token(
            'mercata-testnet',
            creds['client_id'],
            creds['client_secret'],
            creds['username'],
            creds['password'],
        )

    @staticmethod
    def get_keycloak_mercata_users():
        offset = 0
        result = []
        while True:
            url = 'https://keycloak.blockapps.net/auth/admin/realms/mercata-testnet/users?first={offset}&max=100'.format(offset=offset)
            headers = {
                'content-type': 'application/json',
                'Authorization': 'Bearer %s' % MercataManager.get_keycloak_master_token()
            }
            resp = requests.get(url, headers=headers)
            resp_json = resp.json()
            result += resp_json
            if len(resp_json) < 100:
                break
            else:
                offset += 100
        return result

    @staticmethod
    def get_vault_users():
        url = '{vault_url}/strato/v2.3/users'.format(vault_url=MercataManager.vault_url)
        headers = {
            'Authorization': 'Bearer %s' % MercataManager.get_keycloak_mercata_token()
        }
        resp = requests.get(url, headers=headers)
        return resp.json()

    @staticmethod
    def get_vault_user_pubkey(username, token=None):
        if not token:
            token = MercataManager.get_keycloak_mercata_token()

        url = '{vault_url}/strato/v2.3/key?username={username}'.format(vault_url=MercataManager.vault_url, username=username)
        headers = {
            'Authorization': 'Bearer %s' % token
        }
        resp = requests.get(url, headers=headers)
        resp_json = resp.json()
        return resp_json['pubkey']


if __name__ == '__main__':

    m = MercataManager()
    vault_users = m.get_vault_users()  # format: [{'username': '7a49633d-7608-451d-a74a-56cc9a78a6fc', 'address': '07a4d47662ebe7fc49a62f40892bf04572309c68'}, ... ]

    print('Vault user [0] from the list: ', vault_users[0])
    print('Total number of Vault users: %s' % len(vault_users))

    keycloak_users = m.get_keycloak_mercata_users()  # format: [{'id': '99681621-4aac-4bb5-8298-f30b6f9e2b3a', 'createdTimestamp': 1675216943885, 'username': '641824@student.dmschools.org', 'enabled': True, 'totp': False, 'emailVerified': False, 'firstName': 'xavier', 'lastName': 'lous', 'email': '641824@student.dmschools.org', 'attributes': {'companyName': ['desmoince']}, 'disableableCredentialTypes': ['password'], 'requiredActions': ['VERIFY_EMAIL'], 'notBefore': 0, 'access': {'manageGroupMembership': False, 'view': True, 'mapRoles': False, 'impersonate': False, 'manage': False}}, ... ]
    print('Keycloak user [0] from the list: ', keycloak_users[0])
    print('Total number of Keycloak users: %s' % len(keycloak_users))
    keycloak_users_keyed = {ku['id']: ku for ku in keycloak_users}

    mercata_testnet_token = m.get_keycloak_mercata_token()

    users_to_update = []
    skipped_users = []
    for v_user in vault_users:
        if v_user['username'] not in keycloak_users_keyed:
            skipped_users.append({'username': v_user['username'], 'reason': 'vault user id not in keycloak (service user?)'})
        else:
            k_user = keycloak_users_keyed[v_user['username']]
            pubkey = m.get_vault_user_pubkey(v_user['username'], token=mercata_testnet_token)
            users_to_update.append(
                {
                    'uuid': v_user['username'],
                    'fullname': '{first_name} {last_name}'.format(first_name=k_user['firstName'], last_name=k_user['lastName']),
                    'org': k_user['attributes']['companyName'][0],
                    'pubkey': pubkey,
                }
            )

    processed_users = []
    for user in users_to_update:
        print("Processing user {fullname} (uuid={uuid})...".format(fullname=user['fullname'], uuid=user['uuid']))
        # if user['pubkey'] != '045577133ac364ebd0387352854eedebfe5c89fa96367d3aa7daaa7e7edb89aeed739a8bc970b0cd34d19a6b0f54362e8bfd8b16adad8c665c8b75207acf539c6c':
        #     continue
        try:
            subject_json = {
              "commonName": user['fullname'],
              "organization": user['org'],
              "pubKey": user['pubkey']
            }
            with open('subject/subject.json', 'w', encoding='utf-8') as f:
                json.dump(subject_json, f, ensure_ascii=False, indent=2)
            subprocess.check_call([
                'sudo docker run --rm -v $(pwd)/cert:/x509scripts/cert -v $(pwd)/subject:/x509scripts/subject registry-aws.blockapps.net:5000/blockapps/x509-tools:2 sh -c "'
                './x509-generator --issuer=cert/rootCert.pem --subject=subject/subject.json --key=cert/rootPriv.pem > /dev/null && '
                'mv OutputCert.pem subject/" &> /dev/null'
            ], shell=True)

            f = open("subject/OutputCert.pem", "r")
            raw_cert = f.read()
            escaped_cert = (raw_cert.replace('\n', '\\n'))
            # Updating token for each user as it may expire (can be optimized with the lifetime checks)
            mercata_testnet_token = m.get_keycloak_mercata_token()

            data = {
                "txs": [{
                    "payload": {
                        "contractName": "CertificateRegistry",
                        "contractAddress": "509",
                        "method": "registerCertificate",
                        "args": {
                            "newCertificateString": escaped_cert
                        },
                        "metadata": {}
                    },
                    "type": "FUNCTION"
                }]
            }
            headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': 'Bearer %s' % mercata_testnet_token
            }
            resp = requests.request("POST", m.node_url + '/strato/v2.3/transaction?resolve=true', headers=headers, json=data)
            # curl 'https://node1.mercata-testnet.blockapps.net/strato/v2.3/transaction?resolve=true' \
            # -X 'POST' \
            # -H 'Accept: application/json' \
            # -H "Authorization: Bearer ${ADMIN_TOKEN}" \
            # -H 'Content-Type: application/json' \
            # -H 'Origin: https://node1.mercata-testnet.blockapps.net' \
            # -H 'Accept-Language: en-US,en;q=0.9' \
            # -H 'Host: node1.mercata-testnet.blockapps.net' \
            # -H 'Accept-Encoding: gzip, deflate, br' \
            # -H 'Connection: keep-alive' \
            # --data-binary "{\"txs\":[{\"payload\":{\"contractName\":\"OfficialCertificateRegistry\",\"contractAddress\":\"24c6003021471df20530ba4ae973527a8d2f4385\",\"method\":\"registerCertificate\",\"args\":{\"newCertificateString\":\"${CERT_ESCAPED}\"},\"metadata\":{}},\"type\":\"FUNCTION\"}]}"
            print('### STRATO API response:', resp.content)
            print('-----')
            processed_users.append(user)
        except Exception as e:
            err_msg = 'Failed to process user cert issuance or registration with the exception: %s' % e
            print(err_msg)
            skipped_users.append({user['uuid']: err_msg})

    print('Total users processed (certs registered): %s' % len(processed_users))
    print('!!! SKIPPED USERS:', skipped_users)
