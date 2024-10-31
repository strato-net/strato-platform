#!/usr/bin/env bash
set -e

if [ $1 == "true" ] #If script is to be executed on test network...
then
  stratoURL=[TEST_NODE]
elif [ $2 == "true" ] #If script is to be executed on production network...
then 
  stratoURL=[PROD_NODE]
fi
keycloakURL=$(echo $stratoURL | sed 's/http/&s/')
keycloakURL=${keycloakURL%:*}
token=`curl -s -X POST "$keycloakURL/auth/realms/myrealm/protocol/openid-connect/token" -H 'Content-Type: application/x-www-form-urlencoded' -H 'Authorization: Basic YmxvY2thcHBzLXRlc3Q6NjYxMmJlNmMtMjQxYy00ZDdlLWE2ZjYtNWQ4NDFlMTkzNzdl' --data-urlencode 'grant_type=client_credentials' | jq -r ".access_token"`
#if there isn't a service account because we've wiped and restarted the node, comment out the servicer code above and use this definition::
curl -X POST "$stratoURL/strato/v2.3/key" -H "accept: application/json;charset=utf-8" -H "Authorization: Bearer $token"
servicer=`curl -X GET "$stratoURL/strato/v2.3/users" -H "accept: application/json;charset=utf-8" -H "Authorization: Bearer $token" | jq '.[] | select(.username=="service-account-blockapps-test")' | jq '.address' | sed -e 's/^"//' -e 's/"$//'`
#curl -i -X GET "$stratoURL/strato/v2.3/users" -H "accept: application/json;charset=utf-8" -H "Authorization: Bearer $token"
#echo $servicer
# create an array with all the filer/dir inside ~/myDir
declare arrContracts
declare arrPayloads
declare arrSources
# generate the array of payloads and sources to use in the data package for the parallel endpoint POST request
for file in ./contracts/*; do
  if [[ -d $file ]]; then
    echo "$file skipped; $file is a directory"
  else
    k=`basename $file`
    contractName=${k%.sol}
    echo "ATTEMPTING TO UPLOAD FILE NAMED: $contractName"
    arrContracts=`basename $file .sol` #this must correspond to the character spaces in the folder being referenced; it removes the folder prefix
    arrPayloads="{\"payload\":{\"contract\":\"$contractName\",\"args\":{},\"metadata\":{\"history\":\"\",\"index\":\"\",\"VM\":\"SolidVM\"}},\"type\":\"CONTRACT\"}}"
    src=${file:1}
    var=`cat $PWD$src`
    var="$(echo "$var"|tr -d '\n'|sed -e 's/^[ \t]*//')"
    arrSources='{"'$contractName'":"'$var'"}}"'
    arrPayloads=$(IFS=,; echo "{${arrPayloads[*]}"| sed s/./[\/1| sed s/.$/]\/)
    arrSources=$(IFS=,; echo "{${arrSources[*]}"| sed s/.//1| sed s/.$//)
    uploadrequest="{\"txs\":$arrPayloads,\"txParams\":{\"gasLimit\":10000000000,\"gasPrice\":1},\"contract\":\"$contractName\",\"srcs\":$arrSources"
    curl -v -X POST "$stratoURL/strato/v2.3/transaction/parallel?resolve=true" -H "accept: application/json;charset=utf-8" -H "Authorization: Bearer $token" -H "Content-Type: application/json;charset=utf-8" -d "$uploadrequest"
  fi
done