#!/usr/bin/env python3

import json
import os
import re

export_v2_1_filepath = "/home/adnan/Full Suite.postman_collection.json"
desired_names = ['Oracle', 'Swap', 'Bridge']

with open(export_v2_1_filepath, "r") as f:
    data = json.load(f)

for name in desired_names:
    
    # Make a folder for the name
    os.makedirs(f"./{name.lower()}_post_response", exist_ok=True)

    entries = [x for x in data['item'] if x['name'] == name][0]
    testnet = [x for x in entries['item'] if x['name'] == 'Testnet'][0]
    for test in testnet['item']:
        sanitized_name = re.sub(r'[^a-z0-9_]+', '_', test['name'].lower()).strip('_')
        with open(f"./{name.lower()}_post_response/{sanitized_name}.js", "w") as f:
            post_script = [x for x in test['event'] if x['listen'] == 'test'][0]
            code = post_script['script']['exec']
            f.write('\n'.join(code))