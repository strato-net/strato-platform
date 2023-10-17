#!/bin/python3

import ast
import base64
import csv
from datetime import datetime
import os
import pytz
import requests
import slack_sdk

import credentials


class UserData:
    
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
        creds = credentials.KEYCLOAK['master_realm_client']
        return UserData._get_keycloak_token(
            'master',
            creds['client_id'],
            creds['client_secret']
        )

    @staticmethod
    def get_keycloak_mercata_token():
        realm_name = credentials.KEYCLOAK['realm_name']
        client_creds = credentials.KEYCLOAK['client']
        return UserData._get_keycloak_token(
            realm_name,
            client_creds['client_id'],
            client_creds['client_secret'],
        )

    @staticmethod
    def get_keycloak_mercata_users():
        PAGE_LIMIT = 100
        offset = 0
        result = []
        while True:
            url = 'https://keycloak.blockapps.net/auth/admin/realms/{realm_name}/users?first={offset}&max={limit}'.format(realm_name=credentials.KEYCLOAK['realm_name'], offset=offset, limit=PAGE_LIMIT)
            headers = {
                'content-type': 'application/json',
                'Authorization': 'Bearer %s' % UserData.get_keycloak_master_token()
            }
            resp = requests.get(url, headers=headers)
            resp_json = resp.json()
            result += resp_json
            if len(resp_json) < PAGE_LIMIT:
                break
            else:
                offset += PAGE_LIMIT
        return result

    @staticmethod
    def get_strato_address_data():
        PAGE_LIMIT = 500
        offset = 0
        result = []
        mercata_realm_token = UserData.get_keycloak_mercata_token()
        while True:
            url = '{vault_url}/strato/v2.3/users?offset={offset}&limit={limit}'.format(vault_url=credentials.VAULT['vault_url'] ,offset=offset, limit=PAGE_LIMIT)
            headers = {
                'Authorization': 'Bearer %s' % mercata_realm_token,
            }
            resp = requests.get(url, headers=headers)
            resp_json = resp.json()
            result += resp_json
            if len(resp_json) < PAGE_LIMIT:
                break
            else:
                offset += PAGE_LIMIT
        return result

    @staticmethod
    def get_formatted_user_data():
        keycloak_data = UserData.get_keycloak_mercata_users()
        strato_address_data = UserData.get_strato_address_data()
        strato_address_mapping = {a['username']: a['address'] for a in strato_address_data}
        
        return [
            {
                'id': u['id'], 
                'blockchain_address': strato_address_mapping[u['id']] if u['id'] in strato_address_mapping else None,
                'email': u['email'],
                'username': u['username'],
                'firstName': u['firstName'],
                'lastName': u['lastName'],
                'org': u['attributes']['companyName'][0] if 'attributes' in u and 'companyName' in u['attributes'] else None,
                'created': datetime.utcfromtimestamp(int(u['createdTimestamp']/1000)).strftime('%Y-%m-%d %H:%M:%S'),
                'email_verified': u['emailVerified'],
            } 
            for u in keycloak_data
        ]

    @staticmethod
    def write_data_to_csv(data: list, csv_file_path: str):
        if len(data) < 0:
            data = [{'users': 'no users found'}]
        txs_csv_columns = data[0].keys()
        txs_csv_filename = csv_file_path
        try:
            with open(txs_csv_filename, 'w') as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=txs_csv_columns)
                writer.writeheader()
                for data in data:
                    writer.writerow(data)
        except IOError as e:
            print("I/O error", e)

    @staticmethod
    def generate_csv():
        current_date = datetime.now().astimezone(pytz.timezone('US/Eastern'))
        csv_dir = 'csv_archive'
        csv_filename_prefix = current_date.strftime("%Y%m%d_%H%M%S")
        csv_path = '%s/%s_mercata_users.csv' % (csv_dir, csv_filename_prefix)
        data = UserData.get_formatted_user_data()
        UserData.write_data_to_csv(data, csv_path)
        return csv_path

    @staticmethod
    def slack_send(channel, text=None, file_uploads_data=None):
        client = slack_sdk.WebClient(token=credentials.SLACK['slack_token'])
        if file_uploads_data:
            result = client.files_upload_v2(
                channel=channel,
                file_uploads=file_uploads_data,
                initial_comment=text if text else None,
            )
        elif text:
            result = client.chat_postMessage(
                channel=channel, 
                text=text
            )
        else:
            raise Exception('nothing to send')
        print("Slack send result:\n%s" % result)

if __name__ == '__main__':
    try:
        csv_path = UserData.generate_csv()
    except Exception as e:
        UserData.slack_send(channel=credentials.SLACK['ops_channel_id'], text='*({host}) Error in Mercata User Data csv generation script:* {error}'.format(host=credentials.HOST_DESCRIPTION, error=e))
        raise e
    file_uploads = [
        {
            "file": csv_path,
            "title": csv_path.split('/')[-1],
        },
    ]
    if 'SLACK_DISABLED' not in os.environ or os.environ['SLACK_DISABLED'] != 'true':
        UserData.slack_send(channel=credentials.SLACK['ops_channel_id'], file_uploads_data=file_uploads)
    else:
        print('SLACK_DISABLED is true, skipping slack send')
