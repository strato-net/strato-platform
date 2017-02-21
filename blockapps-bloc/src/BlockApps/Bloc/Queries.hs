{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.Queries where

import Data.ByteString (ByteString)

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
