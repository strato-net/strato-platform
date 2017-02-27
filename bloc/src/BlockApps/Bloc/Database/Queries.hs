{-# LANGUAGE
    Arrows
#-}

module BlockApps.Bloc.Database.Queries where

import Control.Arrow
import Data.Text (Text)
import Opaleye

import BlockApps.Bloc.Database.Tables

{- |
SELECT address from key_store;
-}
getAddressesQuery :: Query (Column PGBytea)
getAddressesQuery = proc () -> do
  (_,_,_,_,_,_,addr,_) <- queryTable keyStoreTable -< ()
  returnA -< addr

{- |
SELECT CI.address FROM contracts_instance CI
 JOIN contracts_metadata CM ON CM.id = CI.contracts_metadata_id
 JOIN contracts C ON C.id = CM.contract_id
 WHERE C.name = $1 ORDER BY timestamp DESC;
-}
getSearchContractQuery :: Text -> Query (Column PGBytea)
getSearchContractQuery contractName = proc () -> do
  (name,addr,_) <- orderBy (desc (\(_,_,timestamp) -> timestamp))
    getContractsAddressesQuery -< ()
  restrict -< name .== constant contractName
  returnA -< addr

{- |
SELECT name FROM users;
-}
getUsersQuery :: Query (Column PGText)
getUsersQuery = proc () -> do
  (_,user) <- queryTable usersTable -< ()
  returnA -< user

{- |
SELECT K.address FROM users U JOIN keystore K
 ON K.user_id = U.id WHERE U.name = $1;
-}
getUsersUserQuery :: Text -> Query (Column PGBytea)
getUsersUserQuery userName = proc () -> do
  (name,addr) <- usersJoinKeyStore -< ()
  restrict -< name .== constant userName
  returnA -< addr
  where
    usersJoinKeyStore = joinF
      (\ (_,name) (_,_,_,_,_,_,addr,_) -> (name,addr))
      (\ (uid,_) (_,_,_,_,_,_,_,userId) -> userId .== uid)
      (queryTable usersTable)
      (queryTable keyStoreTable)

{- |
SELECT
   C.name
 , CI.address
 , CI.timestamp
FROM contracts C
JOIN contracts_metadata CM
  ON CM.contract_id = C.id
JOIN contracts_instance CI
  ON CI.contract_metadata_id = CM.id;
-}
getContractsAddressesQuery :: Query
  ( Column PGText
  , Column PGBytea
  , Column PGTimestamptz
  )
getContractsAddressesQuery = joinF
  (\ (_,_,addr,timestamp) (_,name) -> (name,addr,timestamp))
  (\ (_,contractMetaDataId,_,_) (cmId,_) -> cmId .== contractMetaDataId)
  (queryTable contractsInstanceTable) $ joinF
    (\ (cmId,_,_,_,_,_) (_,name) -> (cmId,name))
    (\ (_,contractId,_,_,_,_) (cid,_) -> cid .== contractId)
    (queryTable contractsMetaDataTable)
    (queryTable contractsTable)

{- |
SELECT
   C.name
 , C2.name as address
 , CI.timestamp
FROM contracts C
JOIN contracts_metadata CM
  ON CM.contract_id = C.id
JOIN contracts_lookup CL
  ON CL.contract_metadata_id = CM.id
JOIN contracts_metadata CM2
  ON CM2.id = CL.linked_metadata_id
JOIN contracts C2
  ON C2.id = CM2.contract_id
JOIN contracts_instance CI
  ON CI.contract_metadata_id = CM2.id;
-}
-- getContractsNamesAsAddressesQuery :: Query () [(Text,Text,UTCTime)]
-- getContractsNamesAsAddressesQuery = joinF
--   (\ () () -> )
--   (\ () () -> )
--   (queryTable contractsInstanceTable) $ joinF
--     (\ () () -> )
--     (\ () () -> )
--     (queryTable contractsTable) $ joinF
--       (\ () () -> )
--       (\ () () -> )
--       (queryTable contractsMetaDataTable) $ joinF
--         (\ () () -> )
--         (\ () () -> )
--         (queryTable contractsLookupTable)
--         (queryTable contractsMetaDataTable)
