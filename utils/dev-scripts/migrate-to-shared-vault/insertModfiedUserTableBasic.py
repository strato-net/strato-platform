import pandas as pd
import os
import time

df = pd.read_csv("userTableModfiedWithHeaders.csv")

for index, row in df.iterrows():
    bashCommand = 'docker exec -it vault_vault-wrapper_1 curl -X POST http://vault-wrapper:8000/strato/v2.3/key -H "X-USER-UNIQUE-NAME:%s " -H "X-IDENTITY-PROVIDER-ID:%s" '%(row["x_user_unique_name"], row["oauth_provider_id"])
    os.system(bashCommand)
    print()
    time.sleep(0.3) 