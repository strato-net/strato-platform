import pandas as pd
import sys
from collections import defaultdict
import requests
import sys
from requests.exceptions import HTTPError
import base64
import json




keycloackRel           = sys.argv[1]
index               = int(sys.argv[2])
indexOfMessageTable = int(sys.argv[3])

db = pd.read_csv("userTable.csv")



def getAccessToken():
    try:
        r = requests.post(keycloackRel,
            headers= { 'Content-Type': 'application/x-www-form-urlencoded','Authorization': 'Basic ZGV2OmQ1ZTY3YjhjLTRmYmYtNDJjNi1hOGQ5LTI5YTRkZDEzNTc1Zg=='},
            data={"grant_type" : "client_credentials"}
            )
        r.raise_for_status()
        middlePartOfToken = (r.json()['access_token']).split('.')[1]
        print(base64.urlsafe_b64decode(middlePartOfToken))
        print("Succes")
        jsonified = json.loads(base64.urlsafe_b64decode(middlePartOfToken))
        print(jsonified)
        print(jsonified['sub'])
        print('sub attainment success')
        return (jsonified['sub'], jsonified['iss'])
    except HTTPError as http_err:
        print(f'HTTP error occurred: {http_err}')
        print(http_err.response.text)
    except Exception as err:
        
        print(f'Other error occurred: {err}')

    return False




def getCorrectResult():
    resFromGet  = getAccessToken()
    if False ==  resFromGet:
        print("Need to call again")
        return getCorrectResult()
    else:  return resFromGet


(nodeKeyName, oauthProviderM) = getCorrectResult()



print("Headers before cleaning")
for col in db.columns: print(col)
print()


db['id'] = db.apply( lambda x: x['id'] + index, axis=1) # This needs to be modified to fit the correct 

db['x_user_unique_name'] = db.apply( lambda x: nodeKeyName  if x['x_user_unique_name'] == "nodekey" else x['x_user_unique_name'] , axis=1)
db['oauth_provider_id'] = db.apply( lambda x: oauthProviderM , axis=1) # Wait should this column name be oauth_provider_id or x_identity_provider_id
db = db.drop(['enc_sec_key'], axis=1)


print("Headers after some but not all of cleaning")
for col in db.columns: print(col)
print()


db.to_csv("userTableModfied.csv", header=False, index=False)#Add nodeRelated to this to file name?
print("Clean headers and indexed-index column for user table")
db       = pd.read_csv("messageTable.csv")
print()
for col in db.columns: print(col)
print()
db['id'] = db.apply( lambda x: x['id'] + 1, axis=1)


db.to_csv("messageTableModfied.csv", header=False, index=False)#Add nodeRelated to this to file name?


print("Cleaned headers from message table")
