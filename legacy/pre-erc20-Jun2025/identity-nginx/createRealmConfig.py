import yaml
import requests
import json

identity_providers = []
with open('/tmp/idconf.yaml', 'r') as idconf:
    realms = yaml.safe_load(idconf)
    for realm in realms:
        discovery_url = realm['discoveryUrl']
        try:
            resp = requests.get(discovery_url)
            resp.raise_for_status()
            identity_providers.append({"ISSUER": resp.json()['issuer'], "DISCOVERY_URL": discovery_url })
        except Exception as e:
            print("When trying to retrieve issuer for discovery url", discovery_url)
            print("we got the following error:", e)

config = {'identity_providers' : identity_providers}

with open('/config/config.json', 'w') as out:
    out.write(json.dumps(config, indent=2))