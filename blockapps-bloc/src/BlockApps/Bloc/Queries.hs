{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.Queries where

import Data.ByteString (ByteString)

getAddressesQuery :: ByteString
getAddressesQuery =
  "SELECT address from addresses;"

getContractsAddressesQuery :: ByteString
getContractsAddressesQuery =
  "SELECT \
  \   C.name \
  \ , CI.address \
  \ , CI.timestamp \
  \FROM \
  \  contracts C \
  \JOIN contracts_metadata CM \
  \  ON CM.contract_id = C.id \
  \JOIN contracts_instance CI \
  \  ON CI.contract_metadata_id = CM.id;"

getContractsNamesAsAddressesQuery :: ByteString
getContractsNamesAsAddressesQuery =
  "SELECT \
  \   C.name \
  \ , C2.name as address \
  \ , CI.timestamp \
  \FROM \
  \  contracts C \
  \JOIN contracts_metadata CM \
  \  ON CM.contract_id = C.id \
  \JOIN contracts_lookup CL \
  \  ON CL.contract_metadata_id = CM.id \
  \JOIN contracts_metadata CM2 \
  \  ON CM2.id = CL.linked_metadata_id \
  \JOIN contracts C2 \
  \  ON C2.id = CM2.contract_id \
  \JOIN contracts_instance CI \
  \  ON CI.contract_metadata_id = CM2.id;"

getContractsDataAddressesQuery :: ByteString
getContractsDataAddressesQuery =
  "SELECT \
  \  CI.address \
  \FROM \
  \  contracts C \
  \JOIN contracts_metadata CM ON \
  \  CM.contract_id = C.id \
  \JOIN contracts_instance CI ON \
  \  CI.contract_metadata_id = CM.id \
  \WHERE C.name=$1;"

getContractsDataNamesQuery :: ByteString
getContractsDataNamesQuery =
  "SELECT \
  \  C.name \
  \FROM contracts C \
  \  WHERE C.name=$1 \
  \UNION \
  \SELECT \
  \  C2.Name \
  \FROM \
  \  contracts C \
  \JOIN contracts_metadata CM ON \
  \  CM.contract_id = C.id \
  \JOIN contracts_lookup CL ON \
  \  CL.contract_metadata_id = CM.id \
  \JOIN contracts_metadata CM2 ON \
  \  CM2.id = CL.linked_metadata_id \
  \JOIN contracts C2 ON \
  \  C2.id = CM2.contract_id \
  \WHERE C.name=$1 \
  \UNION \
  \SELECT \
  \  'Latest' \
  \FROM \
  \  contracts C WHERE C.name=$1;"

getContractsContractByAddressQuery :: ByteString
getContractsContractByAddressQuery =
  "SELECT \
  \   CM.bin \
  \ , CM.bin_runtime \
  \ , CM.code_hash \
  \ , C.name \
  \ , CI.address \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_instance CI ON \
  \  CI.contract_metadata_id = CM.id \
  \WHERE C.name=$1 AND CI.address=$2;"

  --TODO: Account for name = same contractName
getContractsContractByNameQuery :: ByteString
getContractsContractByNameQuery =
  "SELECT \
  \   CM.bin \
  \ , CM.bin_runtime \
  \ , CM.code_hash \
  \ , C2.name \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_lookup CL ON \
  \  CL.contract_metadata_id = CM.id \
  \JOIN contracts_metadata CM2 ON \
  \  CM2.id = CL.linked_metadata_id \
  \JOIN contracts C2 ON \
  \  C2.id = CM2.contract_id \
  \WHERE C.name = $1 AND C2.name=$2 LIMIT 1;"

getContractsContractLatestQuery :: ByteString
getContractsContractLatestQuery =
  "SELECT \
  \   CM.bin \
  \ , CM.bin_runtime \
  \ , CM.code_hash \
  \ , C2.name \
  \ , 'Latest' as address \
  \FROM \
  \  contracts_metadata CM \
  \JOIN contracts C ON \
  \  C.id = CM.contract_id \
  \JOIN contracts_instance CI ON \
  \  CI.contract_metadata_id = CM.id \
  \WHERE C.name = $1 ORDER BY CI.timestamp DESC LIMIT 1;"


getSearchContractQuery :: ByteString
getSearchContractQuery =
  "SELECT CI.address FROM contracts_instance CI\
  \ JOIN contracts_metadata CM ON CM.id = CI.contracts_metadata_id\
  \ JOIN contracts C ON C.id = CM.contract_id\
  \ WHERE C.name = $1 ORDER BY timestamp DESC"

getUsersQuery :: ByteString
getUsersQuery = "SELECT name FROM users;"

getUsersUserQuery :: ByteString
getUsersUserQuery =
  "SELECT K.address FROM users U JOIN keystore K\
  \ ON K.user_id = U.id WHERE U.name = $1;"

postUsersUserQuery :: ByteString
postUsersUserQuery =
  "WITH userid AS (\
  \ SELECT id FROM users WHERE name = $1)\
  \ , newUserId AS \
  \ (\
  \   INSERT INTO users (name) \
  \   SELECT $1 WHERE NOT EXISTS (SELECT id FROM users WHERE name = $1)\
  \   RETURNING id \
  \ )\
  \ INSERT INTO keystore (salt,password_hash,nonce,enc_sec_key,pub_key,address,user_id)\
  \ SELECT $2, $3, $4, $5, $6, $7, uid.id FROM \
  \(SELECT id FROM userid UNION SELECT id FROM newUserId) uid;"
