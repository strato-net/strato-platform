{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    Arrows
  , FlexibleInstances
  , LambdaCase
  , MultiParamTypeClasses
  , OverloadedStrings
  , RecordWildCards
  , ScopedTypeVariables
  , TupleSections
#-}

module BlockApps.Bloc.Database.Queries where

import Control.Arrow
import Control.Monad
import Crypto.Hash
import qualified Crypto.Saltine.Class as Saltine
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import Crypto.Secp256k1
import qualified Data.ByteArray as ByteArray
import Data.ByteString (ByteString)
import qualified Data.ByteString.Char8 as Char8
import Data.Foldable
import Data.Int (Int32)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.Monoid
import Data.Profunctor
import Data.Profunctor.Product.Default
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Data.Traversable
import Database.PostgreSQL.Simple (Connection)
import Opaleye hiding (not,null)
import qualified Opaleye as Opaleye (not,null)

import BlockApps.Bloc.Crypto
import BlockApps.Bloc.Database.Tables
import BlockApps.Ethereum
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Solidity
import BlockApps.Strato.Client
import BlockApps.Strato.Types

{- |
SELECT address from key_store;
-}
getAddressesQuery :: Query (Column PGBytea)
getAddressesQuery = proc () -> do
  (_,_,_,_,_,_,addr,_) <- queryTable keyStoreTable -< ()
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
WITH userid AS (
 SELECT id FROM users WHERE name = $1)
 , newUserId AS
 (
   INSERT INTO users (name)
   SELECT $1 WHERE NOT EXISTS (SELECT id FROM users WHERE name = $1)
   RETURNING id
 )
 INSERT INTO keystore (salt,password_hash,nonce,enc_sec_key,pub_key,address,user_id)
 SELECT $2, $3, $4, $5, $6, $7, uid.id FROM
(SELECT id FROM userid UNION SELECT id FROM newUserId) uid;
-}
postUsersUserQuery :: Text -> KeyStore -> Connection -> IO Bool
postUsersUserQuery userName KeyStore{..} conn = do
  userIds1 <- runQuery conn $ proc () -> do
    (userId,name) <- queryTable usersTable -< ()
    restrict -< name .== constant userName
    returnA -< userId
  userIds2 <- case listToMaybe userIds1 of
    Nothing -> runInsertReturning conn usersTable
      (Nothing,constant userName) (\(userId,_) -> userId)
    Just userId -> return [userId::Int32]
  case listToMaybe userIds2 of
    Nothing -> return False
    Just userId -> do
      _ <- runInsert conn keyStoreTable
        ( Nothing
        , constant keystoreSalt
        , constant keystorePasswordHash
        , constant keystoreAcctNonce
        , constant keystoreAcctEncSecKey
        , constant keystorePubKey
        , constant keystoreAcctAddress
        , constant userId
        )
      return True

contractsJoinTable :: Query
  ( Column PGInt4
  , Column PGText
  , Column PGBytea
  , Column PGTimestamptz
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
contractsJoinTable = joinF
  (\ (_,_,a,ts) (cmId,n,b,br,ch,xch) -> (cmId,n,a,ts,b,br,ch,xch))
  (\ (_,contractMetaDataId,_,_) (cmId,_,_,_,_,_) -> cmId .== contractMetaDataId)
  (queryTable contractsInstanceTable) $ joinF
    (\ (cmId,_,b,br,ch,xch) (_,n) -> (cmId,n,b,br,ch,xch))
    (\ (_,contractId,_,_,_,_) (cid,_) -> cid .== contractId)
    (queryTable contractsMetaDataTable)
    (queryTable contractsTable)

contractByAddress
  :: Text
  -> Address
  -> Query
    ( Column PGInt4
    , Column PGText
    , Column PGBytea
    , Column PGTimestamptz
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    )
contractByAddress contractName contractAddress = proc () -> do
  contract@(_,name,addr,_,_,_,_,_) <- contractsJoinTable -< ()
  restrict -< name .== constant contractName
  restrict -< addr .== constant contractAddress
  returnA -< contract

linkedContractsJoinTable :: Query
  ( Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGText
  , Column PGText
  , Column PGInt4
  )
linkedContractsJoinTable = joinF
  (\ (_,name2) (name,cm2Id,_,b,br,ch,xch) -> (b,br,ch,xch,name,name2,cm2Id))
  (\ (c2Id,_) (_,_,contractId2,_,_,_,_) -> c2Id .== contractId2)
  (queryTable contractsTable) $ joinF
    (\ (cm2Id,contractId2,_,_,_,_) (name,_,b,br,ch,xch) -> (name,cm2Id,contractId2,b,br,ch,xch))
    (\ (cm2Id,_,_,_,_,_) (_,linkedMetadataId,_,_,_,_) -> cm2Id .== linkedMetadataId)
    (queryTable contractsMetaDataTable) $ joinF
      (\ (_,linkedMetadataId) (name,_,b,br,ch,xch) -> (name,linkedMetadataId,b,br,ch,xch))
      (\ (contractMetaDataId,_) (_,cmId,_,_,_,_) -> contractMetaDataId .== cmId)
      (queryTable contractsLookupTable) $ joinF
        (\ (_,name) (cmId,_,b,br,ch,xch) -> (name,cmId,b,br,ch,xch))
        (\ (cid,_) (_,contractId,_,_,_,_) -> cid .== contractId)
        (queryTable contractsTable)
        (queryTable contractsMetaDataTable)

{- |
SELECT CI.address FROM contracts_instance CI
 JOIN contracts_metadata CM ON CM.id = CI.contracts_metadata_id
 JOIN contracts C ON C.id = CM.contract_id
 WHERE C.name = $1 ORDER BY timestamp DESC;
-}
getSearchContractQuery :: Text -> Query (Column PGBytea)
getSearchContractQuery contractName = proc () -> do
  (_,name,addr,_,_,_,_,_) <-
    orderBy (desc (\(_,_,_,timestamp,_,_,_,_) -> timestamp))
      contractsJoinTable -< ()
  restrict -< name .== constant contractName
  returnA -< addr

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
getContractsAddressesQuery = proc () -> do
  (_,name,addr,timestamp,_,_,_,_) <- contractsJoinTable -< ()
  returnA -< (name,addr,timestamp)

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
getContractsNamesAsAddressesQuery :: Query
  ( Column PGText
  , Column PGText
  , Column PGTimestamptz
  )
getContractsNamesAsAddressesQuery = joinF
  (\ (_,_,_,timestamp) (_,_,_,_,name,name2,_) -> (name,name2,timestamp))
  (\ (_,contractMetaDataId,_,_) (_,_,_,_,_,_,cm2Id) -> contractMetaDataId .== cm2Id)
  (queryTable contractsInstanceTable)
  linkedContractsJoinTable

{- |
SELECT
  CI.address
FROM contracts C
JOIN contracts_metadata CM
  ON CM.contract_id = C.id
JOIN contracts_instance CI
  ON CI.contract_metadata_id = CM.id
WHERE C.name=$1;
-}
getContractsDataAddressesQuery :: Text -> Query (Column PGBytea)
getContractsDataAddressesQuery contractName = proc () -> do
  (_,name,addr,_,_,_,_,_) <- contractsJoinTable -< ()
  restrict -< name .== constant contractName
  returnA -< addr

{- |
SELECT C.name
FROM contracts C
WHERE C.name=$1
UNION
SELECT
  C2.Name
FROM contracts C
JOIN contracts_metadata CM
  ON CM.contract_id = C.id
JOIN contracts_lookup CL
  ON CL.contract_metadata_id = CM.id
JOIN contracts_metadata CM2
  ON CM2.id = CL.linked_metadata_id
JOIN contracts C2
  ON C2.id = CM2.contract_id
WHERE C.name=$1
UNION
SELECT 'Latest'
FROM contracts C
WHERE C.name=$1;
-}
getContractsDataNamesQuery :: Text -> Query (Column PGText)
getContractsDataNamesQuery contractName =
  sameName `union` differentName `union` latest
  where
    sameName = proc () -> do
      (_,name) <- queryTable contractsTable -< ()
      restrict -< name .== constant contractName
      returnA -< name
    differentName = proc () -> do
      (_,_,_,_,name,name2,_) <- linkedContractsJoinTable -< ()
      restrict -< name .== constant contractName
      returnA -< name2
    latest = proc () -> do
      (_,name) <- queryTable contractsTable -< ()
      restrict -< name .== constant contractName
      returnA -< constant ("Latest"::Text)

getContractsMetaDataId :: Text -> MaybeNamed Address -> Query (Column PGInt4)
getContractsMetaDataId contractName = \case
  Named "Latest" ->
    getContractsMetaDataIdByLatestQuery contractName
  Unnamed contractAddress ->
    getContractsMetaDataIdByAddressQuery contractName contractAddress
  Named name -> if contractName == name
    then getContractsMetaDataIdBySameNameQuery contractName
    else getContractsMetaDataIdByNameQuery contractName name

insertXabiFunctionArg
  :: Int32
  -> Map Text IndexedXabiType
  -> Connection -> IO ()
insertXabiFunctionArg funcId args conn = do
  entryTypeIdss <- for (toList args) $ \ IndexedXabiType{indexedXabiTypeType=XabiType{xabiTypeEntry = argEntry}} ->
    case argEntry of
      Nothing -> return [Nothing::Maybe Int32]
      Just XabiType{..} -> runInsertReturning conn xabiTypesTable
        ( Nothing
        , constant $ fromMaybe (error "xabiTypeType was Nothing") xabiTypeType
        , Opaleye.null
        , constant False
        , constant False
        , constant xabiTypeBytes
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )
        (\ (tyId,_,_,_,_,_,_,_,_) -> toNullable tyId)
  let entryTypeIds = map head entryTypeIdss
  typeIds <- runInsertManyReturning conn xabiTypesTable
    [ ( Nothing
      , constant (fromMaybe "Contract" xabiTypeType) -- Type is missing from Val when the variable is a contract
      , constant xabiTypeTypedef
      , constant (fromMaybe False xabiTypeDynamic)
      , constant False
      , constant xabiTypeBytes
      , constant entryTypeId
      , Opaleye.null
      , Opaleye.null
      )
    | (entryTypeId,IndexedXabiType{indexedXabiTypeType=XabiType{..}}) <- zip entryTypeIds (toList args)
    ]
    (\ (tyId,_,_,_,_,_,_,_,_) -> tyId)
  void $ runInsertMany conn xabiFunctionArgumentsTable
    [ ( Nothing
      , constant funcId
      , constant (typeId::Int32)
      , constant name --TODO: this could end up reordered. Revisit
      , constant indexedXabiTypeIndex
      )
    | (typeId,(name,IndexedXabiType{..})) <- zip typeIds (Map.toList args)
    ]

insertXabiFunctionRet
  :: Int32
  -> [IndexedXabiType]
  -> Connection -> IO ()
insertXabiFunctionRet funcId vals conn = do
  entryTypeIdss <- for vals $ \ IndexedXabiType{indexedXabiTypeType=XabiType{xabiTypeEntry = valEntry}} ->
    case valEntry of
      Nothing -> return [Nothing::Maybe Int32]
      Just XabiType{..} -> runInsertReturning conn xabiTypesTable
        ( Nothing
        , constant $ fromMaybe (error "xabiTypeType is missing") xabiTypeType
        , Opaleye.null
        , constant False
        , constant False
        , constant xabiTypeBytes
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )
        (\ (tyId,_,_,_,_,_,_,_,_) -> toNullable tyId)
  let entryTypeIds = map head entryTypeIdss
  typeIds <- runInsertManyReturning conn xabiTypesTable
    [ ( Nothing
      , constant (fromMaybe "Contract" xabiTypeType) -- Type is missing from Val when the variable is a contract
      , constant xabiTypeTypedef
      , constant (fromMaybe False xabiTypeDynamic)
      , constant False -- How will we know if it is signed? A: `Val` type may need another field for `signed`
      , constant xabiTypeBytes
      , constant entryTypeId
      , Opaleye.null
      , Opaleye.null
      )
    | (entryTypeId,IndexedXabiType{indexedXabiTypeType=XabiType{..}}) <- zip entryTypeIds vals
    ]
    (\ (tyId,_,_,_,_,_,_,_,_) -> tyId)
  void $ runInsertMany conn xabiFunctionReturnsTable
    [ ( Nothing
      , constant funcId
      , constant indexedXabiTypeIndex
      , constant (typeId::Int32)
      )
    | (typeId,IndexedXabiType{..}) <- zip typeIds vals
    ]
{- |
SELECT CM.id
FROM contracts_metadata CM
JOIN contracts C
  ON C.id = CM.contract_id
JOIN contracts_instance CI
  ON CI.contract_metadata_id = CM.id
WHERE C.name=$1 AND CI.address=$2;
-}
getContractsMetaDataIdByAddressQuery
  :: Text
  -> Address
  -> Query (Column PGInt4)
getContractsMetaDataIdByAddressQuery contractName contractAddress =
  proc () -> do
    (cmId,_,_,_,_,_,_,_) <-
      contractByAddress contractName contractAddress -< ()
    returnA -< cmId

{- |
SELECT
   CM.bin
 , CI.address
 , CM.bin_runtime
 , CM.code_hash
 , C.name
 , CM.id
FROM contracts_metadata CM
JOIN contracts C
  ON C.id = CM.contract_id
JOIN contracts_instance CI
  ON CI.contract_metadata_id = CM.id
WHERE C.name=$1 AND CI.address=$2
LIMIT 1;
-}
getContractsContractByAddressQuery
  :: Text
  -> Address
  -> Query
    ( Column PGBytea
    , ( Column PGBytea
      , Column PGBytea
      , Column PGBytea
      , Column PGBytea
      , Column PGText
    ) )
getContractsContractByAddressQuery contractName contractAddress =
  limit 1 $ proc () -> do
    (_,name,addr,_,bin,binRuntime,codeHash,xcodeHash) <-
      contractByAddress contractName contractAddress -< ()
    returnA -< (addr,(bin,binRuntime,codeHash,xcodeHash,name))

{- |
SELECT CM2.id
FROM contracts_metadata CM
JOIN contracts C
  ON C.id = CM.contract_id
JOIN contracts_lookup CL
  ON CL.contract_metadata_id = CM.id
JOIN contracts_metadata CM2
  ON CM2.id = CL.linked_metadata_id
JOIN contracts C2
  ON C2.id = CM2.contract_id
WHERE C.name = $1 AND C2.name=$2
ORDER BY CM2.id DESC
LIMIT 1;
-}
getContractsMetaDataIdByNameQuery
  :: Text
  -> Text
  -> Query (Column PGInt4)
getContractsMetaDataIdByNameQuery contractName1 contractName2 =
  limit 1 . orderBy (desc (\ cm2Id -> cm2Id)) $ proc () -> do
    (_,_,_,_,name1,name2,cm2Id) <- linkedContractsJoinTable -< ()
    restrict -< name1 .== constant contractName1
    restrict -< name2 .== constant contractName2
    returnA -< cm2Id

{- |
SELECT
   CM2.bin
 , CM2.bin_runtime
 , CM2.code_hash
 , C2.name
FROM contracts_metadata CM
JOIN contracts C
  ON C.id = CM.contract_id
JOIN contracts_lookup CL
  ON CL.contract_metadata_id = CM.id
JOIN contracts_metadata CM2
  ON CM2.id = CL.linked_metadata_id
JOIN contracts C2
  ON C2.id = CM2.contract_id
WHERE C.name = $1 AND C2.name=$2
LIMIT 1;
-}
getContractsContractByNameQuery
  :: Text
  -> Text
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    )
getContractsContractByNameQuery contractName1 contractName2 =
  limit 1 $ proc () -> do
    (b,br,ch,xch,name1,name2,_) <- linkedContractsJoinTable -< ()
    restrict -< name1 .== constant contractName1
    restrict -< name2 .== constant contractName2
    returnA -< (b,br,ch,xch,name2)

{- |
SELECT CM.id
FROM contracts_metadata CM
JOIN contracts C
  ON C.id = CM.contract_id
WHERE C.name = $1
ORDER BY CM.id DESC
LIMIT 1;
-}
getContractsMetaDataIdBySameNameQuery :: Text -> Query (Column PGInt4)
getContractsMetaDataIdBySameNameQuery contractName =
  limit 1 . orderBy (desc (\ cmId -> cmId)) $ proc () -> do
    (cmId,name) <- joinTable -< ()
    restrict -< name .== constant contractName
    returnA -< cmId
  where
    joinTable = joinF
      (\ (cmId,_,_,_,_,_) (_,name) -> (cmId,name))
      (\ (_,contractId,_,_,_,_) (cId,_) -> cId .== contractId)
      (queryTable contractsMetaDataTable)
      (queryTable contractsTable)

{- |
SELECT
   CM.bin
 , CM.bin_runtime
 , CM.code_hash
 , C.name
FROM contracts_metadata CM
JOIN contracts C
  ON C.id = CM.contract_id
WHERE C.name = $1
LIMIT 1;
-}
getContractsContractBySameNameQuery
  :: Text
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    )
getContractsContractBySameNameQuery contractName =
  limit 1 $ proc () -> do
    (b,br,ch,xch,name,_) <- joinTable -< ()
    restrict -< name .== constant contractName
    returnA -< (b,br,ch,xch,name)
  where
    joinTable = joinF
      (\ (cmId,_,b,br,ch,xch) (_,name) -> (b,br,ch,xch,name,cmId))
      (\ (_,contractId,_,_,_,_) (cId,_) -> cId .== contractId)
      (queryTable contractsMetaDataTable)
      (queryTable contractsTable)

{- |
SELECT CM.id
FROM contracts_metadata CM
JOIN contracts C
  ON C.id = CM.contract_id
JOIN contracts_instance CI
  ON CI.contract_metadata_id = CM.id
WHERE C.name = $1
ORDER BY CI.timestamp DESC
LIMIT 1;
-}
getContractsMetaDataIdByLatestQuery :: Text -> Query (Column PGInt4)
getContractsMetaDataIdByLatestQuery contractName = limit 1 $ proc () -> do
  (cmId,name,_,_,_,_,_,_) <-
    orderBy (desc (\ (_,_,_,timestamp,_,_,_,_) -> timestamp))
      contractsJoinTable -< ()
  restrict -< name .== constant contractName
  returnA -< cmId

{- |
SELECT
   CM.bin
 , CM.bin_runtime
 , CM.code_hash
 , C2.name
 , CM.id
FROM contracts_metadata CM
JOIN contracts C
  ON C.id = CM.contract_id
JOIN contracts_instance CI
  ON CI.contract_metadata_id = CM.id
WHERE C.name = $1
ORDER BY CI.timestamp DESC
LIMIT 1;
-}
getContractsContractLatestQuery
  :: Text
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    )
getContractsContractLatestQuery contractName = limit 1 $ proc () -> do
  (_,name,_,_,b,br,ch,xch) <-
    orderBy (desc (\ (_,_,_,timestamp,_,_,_,_) -> timestamp))
      contractsJoinTable -< ()
  restrict -< name .== constant contractName
  returnA -< (b,br,ch,xch,name)

{- |
SELECT
  XF.id
 ,XF.name
 ,XF.selector
FROM xabi_functions XF
WHERE XF.is_constructor = false AND XF.contract_metadata_id = $1;
-}
getXabiFunctionsQuery
  :: Int32
  -> Query
    ( Column PGInt4
    , Column (Nullable PGText)
    , Column (Nullable PGBytea)
    )
getXabiFunctionsQuery cmId = proc () -> do
  (xfId,contractMetaDataId,isConstr,name,selector) <-
    queryTable xabiFunctionsTable -< ()
  restrict -< contractMetaDataId .== constant cmId .&& Opaleye.not isConstr
  returnA -< (xfId,name,selector)

{- |
SELECT XF.id
FROM xabi_functions XF
WHERE XF.is_constructor = true AND XF.contract_metadata_id = $1;
-}
getXabiConstrQuery :: Int32 -> Query (Column PGInt4)
getXabiConstrQuery cmId = proc () -> do
  (xfId,contractMetaDataId,isConstr,_,_) <-
    queryTable xabiFunctionsTable -< ()
  restrict -< contractMetaDataId .== constant cmId .&& isConstr
  returnA -< xfId

{- |
SELECT
  ,XFA.name
  ,XFA.index
  ,XT.type
  ,XT.typedef
  ,XT.is_dynamic
  ,XT.bytes
  ,XTE.type as entry_type
  ,XTE.bytes as entry_bytes
FROM xabi_function_arguments XFA
JOIN xabi_types XT
  ON XT.id = XFA.type_id
LEFT OUTER JOIN xabi_types XTE
  ON XTE.id = XT.entry_type_id
WHERE XFA.function_id = $1;
-}
getXabiFunctionsArgsQuery
  :: Int32
  -> Query
    ( Column PGText
    , Column PGInt4
    , Column (Nullable PGText)
    , Column (Nullable PGText)
    , Column (Nullable PGBool) --TO REVIEW: Had to make this nullable because of Ln 147 @ API/Contract.hs
    , Column (Nullable PGInt4)
    , Column (Nullable PGText)
    , Column (Nullable PGInt4)
    )
getXabiFunctionsArgsQuery funcId = proc () -> do
  (functionId,name,index,ty,tyd,dy,by,ety,eby) <- joinTable -< ()
  restrict -< functionId .== constant funcId
  returnA -< (name,index,ty,tyd,dy,by,ety,eby)
  where
    joinTable = joinF
      (\ (_,functionId,_,name,index) (_,ty,tyd,dy,by,ety,eby) -> (functionId,name,index, toNullable ty,tyd, toNullable dy,by,ety,eby))
      (\ (_,_,typeId,_,_) (xtId,_,_,_,_,_,_) -> xtId .== typeId)
      (queryTable xabiFunctionArgumentsTable) $ leftJoinF
        (\ (xtId,ty,tyd,dy,_,by,_,_,_) (_,ety,_,_,_,eby,_,_,_) -> (xtId,ty,tyd,dy,by, toNullable ety,eby))
        (\ (xtId,ty,tyd,dy,_,by,_,_,_) -> (xtId,ty,tyd,dy,by,Opaleye.null,Opaleye.null))
        (\ (_,_,_,_,_,_,entryTypeId,_,_) (xteId,_,_,_,_,_,_,_,_) -> toNullable xteId .== entryTypeId)
        (queryTable xabiTypesTable)
        (queryTable xabiTypesTable)
{- |
SELECT
  (CASE WHEN XFR.name IS NULL THEN '#' + CAST(XFR.index AS VARCHAR(20)) ELSE XFR.name END) as name
  ,XFR.index
  ,XT.type
  ,XT.typedef
  ,XT.is_dynamic
  ,XT.bytes
  ,XTE.type as entry_type
  ,XTE.bytes as entry_bytes
FROM xabi_function_return XFR
JOIN xabi_types XT
  ON XT.id = XFR.type_id
LEFT OUTER JOIN xabi_types XTE
  ON XTE.id = XT.entry_type_id
WHERE XFR.function_id = $1;"
-}
getXabiFunctionsReturnValuesQuery
  :: Int32
  -> Query
    ( Column PGInt4
    , Column PGInt4
    , Column (Nullable PGText) --TO REVIEW: Had to make this nullable because of Ln 147 @ API/Contract.hs
    , Column (Nullable PGText)
    , Column (Nullable PGBool) --TO REVIEW: Had to make this nullable because of Ln 147 @ API/Contract.hs
    , Column (Nullable PGInt4)
    , Column (Nullable PGText)
    , Column (Nullable PGInt4)
    )
getXabiFunctionsReturnValuesQuery funcId = proc () -> do
  (functionId,xfrId,index,ty,tyd,dy,by,ety,eby) <- joinTable -< ()
  restrict -< functionId .== constant funcId
  returnA -< (xfrId,index,ty,tyd,dy,by,ety,eby)
  where
    joinTable = joinF
      (\ (xfrId,functionId,index,_) (_,ty,tyd,dy,by,ety,eby) -> (functionId,xfrId,index, toNullable ty,tyd, toNullable dy,by,ety,eby))
      (\ (_,_,_,typeId) (xtId,_,_,_,_,_,_) -> xtId .== typeId)
      (queryTable xabiFunctionReturnsTable) $ leftJoinF
        (\ (xtId,ty,tyd,dy,_,by,_,_,_) (_,ety,_,_,_,eby,_,_,_) -> (xtId,ty,tyd,dy,by, toNullable ety,eby))
        (\ (xtId,ty,tyd,dy,_,by,_,_,_) -> (xtId,ty,tyd,dy,by,Opaleye.null,Opaleye.null))
        (\ (_,_,_,_,_,_,entryTypeId,_,_) (xteId,_,_,_,_,_,_,_,_) -> toNullable xteId .== entryTypeId)
        (queryTable xabiTypesTable)
        (queryTable xabiTypesTable)

{- |
SELECT
   XV.name
  ,XV.at_bytes
  ,XV.type_id
FROM
  xabi_variables XV
WHERE XV.contract_metadata_id = $1;
-}
getXabiVariablesQuery :: Int32 -> Bloc (Map Text VarType)
getXabiVariablesQuery cmId = do
  varsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (_,cmid,typeid,name,atbytes,ispublic)
      <- queryTable xabiVariablesTable -< ()
    restrict -< cmid .== constant cmId
    returnA -< (name,(atbytes,ispublic,typeid))
  for varsWithIds $ \ (atbytes,ispublic,typeid) -> do
    ty <- getXabiType typeid
    return $ VarType atbytes (Just ispublic) ty

{- |
WITH contract_id AS (
 SELECT id FROM contracts WHERE name = $1)
 , new_contract_id AS
 (
   INSERT INTO contracts (name)
   SELECT $1 WHERE NOT EXISTS (SELECT id FROM contracts WHERE name = $1)
   RETURNING id
 )
SELECT id FROM contract_id UNION SELECT id FROM new_contract_id;
-}
createContractQuery :: Text -> Connection -> IO (Maybe Int32)
createContractQuery contractName conn = do
  cIds <- runQuery conn $ proc () -> do
    (cId,name) <- queryTable contractsTable -< ()
    restrict -< name .== constant contractName
    returnA -< cId
  cIds' <- case listToMaybe cIds of
    Just cId -> return [cId]
    Nothing -> runInsertReturning conn contractsTable
      (Nothing, constant contractName)
      (\ (cId, _) -> cId)
  return $ listToMaybe cIds'

{- |
Insert metadata into contract metadata table if metadata table does not contain codehash
and xcodehash combination.
-}
insertContractMetaDataQuery
  :: Int32
  -> Text
  -> Text
  -> Keccak256
  -> Keccak256
  -> Connection -> IO (Maybe Int32)
insertContractMetaDataQuery
  contractId bin binRuntime codeHash xcodeHash conn = do
    cmIds <- runQuery conn $ proc () -> do
      (cmId,_,_,_,ch,xch) <- queryTable contractsMetaDataTable -< ()
      restrict -< ch .== constant codeHash .&& xch .== constant xcodeHash
      returnA -< cmId
    case listToMaybe cmIds of
      Just cmId -> return $ Just cmId
      Nothing -> 
        listToMaybe <$> runInsertReturning conn contractsMetaDataTable
          writeColumns
          (\ (contractMetaDataId,_,_,_,_,_) -> contractMetaDataId)
  where
    writeColumns =
      ( Nothing
      , constant contractId
      , constant (Text.encodeUtf8 bin)
      , constant (Text.encodeUtf8 binRuntime)
      , constant codeHash
      , constant xcodeHash
      )

{- |
INSERT INTO contracts_lookup (contract_metadata_id, linked_metadata_id)
SELECT $1,$2  WHERE NOT EXISTS
(SELECT contract_metadata_id, linked_metadata_id FROM contracts_lookup
WHERE contract_metadata_id = $1 AND linked_metadata_id = $2);
-}
insertContractLookup :: Int32 -> Int32 -> Connection -> IO ()
insertContractLookup metaDataId linkedId conn = do
  rows <- runQuery conn $ proc () -> do
    row@(contractMetaDataId,linkedMetadataId) <-
      queryTable contractsLookupTable -< ()
    restrict -< contractMetaDataId .== constant metaDataId
      .&& linkedMetadataId .== constant linkedId
    returnA -< row
  when (null (rows::[(Int32,Int32)])) . void $
    runInsert conn contractsLookupTable
      (constant metaDataId,constant linkedId)

{- |
INSERT INTO xabi_functions
  (contract_metadata_id,name,selector,is_constructor)
  VALUES ($1,$2,$3,$4) RETURNING id;
-}
insertXabiFunction
  :: Int32
  -> Text
  -> Text
  -> Bool
  -> Connection
  -> IO [Int32]
insertXabiFunction contractMetaDataId name selector isConstr conn = do
  runInsertReturning conn
    xabiFunctionsTable
    ( Nothing
    , constant contractMetaDataId
    , constant isConstr
    , toNullable (constant name)
    , toNullable (constant (Text.encodeUtf8 selector))
    )
    (\ (xfId,_,_,_,_) -> xfId)

instance QueryRunnerColumnDefault PGBytea Address where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode address") . stringAddress . Char8.unpack)
    queryRunnerColumnDefault
instance Default Constant Address (Column PGBytea) where
  def = lmap (Char8.pack . addressString) def

instance QueryRunnerColumnDefault PGBytea SecretBox.Nonce where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode nonce") . Saltine.decode)
    queryRunnerColumnDefault
instance Default Constant SecretBox.Nonce (Column PGBytea) where
  def = lmap Saltine.encode def

instance Default Constant PubKey (Column PGBytea) where
  def = lmap (exportPubKey False) def

instance Default Constant UserName (Column PGText) where
  def = lmap getUserName def

instance QueryRunnerColumnDefault PGBytea Keccak256 where
  queryRunnerColumnDefault =
    queryRunnerColumn id toKecc queryRunnerColumnDefault
    where
      toKecc :: ByteString -> Keccak256
      toKecc
        = Keccak256
        . fromMaybe (error "could not decode hash")
        . digestFromByteString
instance Default Constant Keccak256 (Column PGBytea) where
  def = lmap fromKecc def
    where
      fromKecc :: Keccak256 -> ByteString
      fromKecc (Keccak256 digest) = ByteArray.convert digest


compileContract :: Text -> Text -> Bloc Keccak256
compileContract contractName source = do
  (ExtabiResponse xabis,SolcResponse abiBins) <- blocStrato $
    (,) <$> postExtabi (Src source) <*> postSolc (Src source)
  let
    contracts = Map.intersectionWith (,) xabis abiBins
  metaDataIds <- forMap contracts $ \ contrName (Xabi{..},AbiBin{..}) -> do
    let
      codeHash = keccak256 (Text.encodeUtf8 binRuntime)
      xcodeHash = keccak256 (Text.encodeUtf8 bin)
    contrId <- blocMaybe "contract id" <=< blocModify $
      createContractQuery contrName


    metaDataId <- blocMaybe "metadata id" <=< blocModify $
      insertContractMetaDataQuery
        contrId bin binRuntime codeHash xcodeHash

    forMap_ xabiFuncs $ \ funcName Func{..} -> do
      funcId <- blocModify1 $ insertXabiFunction
        metaDataId funcName funcSelector False
      blocModify $ insertXabiFunctionArg funcId funcArgs
      blocModify $ insertXabiFunctionRet funcId (toList funcVals)

    constructorFuncId <- blocModify1 $ insertXabiFunction
      metaDataId contractName "" True
    blocModify $ insertXabiFunctionArg constructorFuncId xabiConstr
    blocModify $ insertXabiFunctionRet constructorFuncId []

    return metaDataId
  for_ metaDataIds $ \ leftMetaDataId ->
    for_ metaDataIds $ \ rightMetaDataId -> blocModify $
      insertContractLookup leftMetaDataId rightMetaDataId
  blocQuery1 $ proc () -> do
    (codeHash,name) <- joinF
      (\ (_,_,_,_,codeHash,_) (_,name) -> (codeHash,name))
      (\ (_,contractId,_,_,_,_) (cId,_) -> cId .== contractId)
      (queryTable contractsMetaDataTable)
      (queryTable contractsTable) -< ()
    restrict -< name .== constant contractName
    returnA -< codeHash

getXabiType :: Int32 -> Bloc XabiType
getXabiType typeId = do
  (xtty,xttd,xtdy,xtsi,xtby,xtetid,xtvtid,xtktid)
    <- blocQuery1 $ proc () -> do
      (xtid,xtty,xttd,xtdy,xtsi,xtby,xtet,xtvt,xtkt)
        <- queryTable xabiTypesTable -< ()
      restrict -< xtid .== constant typeId
      returnA -< (xtty,xttd,xtdy,xtsi,xtby,xtet,xtvt,xtkt)
  xtet <- traverse getXabiType xtetid
  xtvt <- traverse getXabiType xtvtid
  xtkt <- traverse getXabiType xtktid
  return XabiType
    { xabiTypeType = Just xtty
    , xabiTypeTypedef = xttd
    , xabiTypeDynamic = Just xtdy
    , xabiTypeSigned = Just xtsi
    , xabiTypeBytes = xtby
    , xabiTypeEntry = xtet
    , xabiTypeVal = xtvt
    , xabiTypeKey = xtkt
    }

getContractXabi :: ContractName -> MaybeNamed Address -> Bloc Xabi
getContractXabi (ContractName contractName) contractId = do
  metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
  funcIdNameSelsMaybe <- blocQuery $ getXabiFunctionsQuery metadataId
  let
    -- TODO: fix this in next API iteration
    funcIdNameSels =
      [ (funcId, funcName, sel)
      | (funcId, Just funcName, Just sel) <- funcIdNameSelsMaybe
      ]
  funcs <- fmap Map.fromList $
    for funcIdNameSels $ \ (funcId,funcName,sel) -> do
      args <- do
        tuples <- blocQuery (getXabiFunctionsArgsQuery funcId)
        for tuples $ \ (name,index,ty,tyd,dy,by,ety,eby) ->
          return $ (name, ) IndexedXabiType
            { indexedXabiTypeIndex = index,
              indexedXabiTypeType =
                XabiType {
                  xabiTypeType = ty
                , xabiTypeTypedef = tyd
                , xabiTypeDynamic = dy
                , xabiTypeBytes = by
                , xabiTypeSigned = Nothing
                , xabiTypeVal = Nothing
                , xabiTypeKey = Nothing
                , xabiTypeEntry = Just
                  XabiType {
                    xabiTypeBytes = eby
                  , xabiTypeType = ety
                  , xabiTypeTypedef = Nothing
                  , xabiTypeDynamic = Nothing
                  , xabiTypeSigned = Nothing
                  , xabiTypeEntry = Nothing
                  , xabiTypeVal = Nothing
                  , xabiTypeKey = Nothing
                  }
                }
            }
      vals <- do
        tuples <- blocQuery (getXabiFunctionsReturnValuesQuery funcId)
        for tuples $ \ (_::Int32,index,ty,tyd,dy,by,ety,eby) ->
          return $ ("#" <> Text.pack (show index),) IndexedXabiType
            { indexedXabiTypeIndex = index,
              indexedXabiTypeType=
                XabiType{
                  xabiTypeType = ty
                , xabiTypeTypedef = tyd
                , xabiTypeDynamic = dy
                , xabiTypeBytes = by
                , xabiTypeSigned = Nothing
                , xabiTypeVal = Nothing
                , xabiTypeKey = Nothing
                , xabiTypeEntry = Just
                  XabiType {
                    xabiTypeBytes = eby
                  , xabiTypeType = ety
                  , xabiTypeTypedef = Nothing
                  , xabiTypeDynamic = Nothing
                  , xabiTypeSigned = Nothing
                  , xabiTypeEntry = Nothing
                  , xabiTypeVal = Nothing
                  , xabiTypeKey = Nothing
                  }
                }
            }
      let
        func = Func
          { funcArgs = Map.fromList args
          , funcSelector = Text.decodeUtf8 sel
          , funcVals = Map.fromList vals
          }
      return (funcName,func)
  constrId <- blocQuery1 $ getXabiConstrQuery metadataId
  constr <- Map.fromList <$> do
    tuples <- blocQuery (getXabiFunctionsArgsQuery constrId)
    for tuples $ \ (name,index,ty,tyd,dy,by,ety,eby) ->
      return $ (name, ) IndexedXabiType
        { indexedXabiTypeIndex = index,
          indexedXabiTypeType =
            XabiType {
              xabiTypeType = ty
            , xabiTypeTypedef = tyd
            , xabiTypeDynamic = dy
            , xabiTypeBytes = by
            , xabiTypeSigned = Nothing
            , xabiTypeVal = Nothing
            , xabiTypeKey = Nothing
            , xabiTypeEntry = Just
                 XabiType{
                   xabiTypeBytes=eby
                 , xabiTypeType=ety
                 , xabiTypeTypedef=Nothing
                 , xabiTypeDynamic=Nothing
                 , xabiTypeSigned=Nothing
                 , xabiTypeEntry=Nothing
                 , xabiTypeVal=Nothing
                 , xabiTypeKey=Nothing
                 }
            }
        }
  vars <- Map.fromList <$> do
    tuples <- blocQuery (getXabiVariablesQuery metadataId)
    for tuples $ \ (name,atBy,ty,tyd,dy,si,by,ety,eby,vty,vby,vdy,vsi,vety,veby,kty,kby,kdy,ksi,kety,keby) ->
      return $ (name,) VarType
        { varTypeAtBytes = atBy,
          varTypeType =
            XabiType {
              xabiTypeType = Just ty
            , xabiTypeTypedef = tyd
            , xabiTypeDynamic = Just dy
            , xabiTypeSigned = Just si
            , xabiTypeBytes = by
            , xabiTypeEntry = Just
                   XabiType{
                     xabiTypeBytes = eby
                   , xabiTypeType = ety
                   , xabiTypeTypedef=Nothing
                   , xabiTypeDynamic=Nothing
                   , xabiTypeSigned=Nothing
                   , xabiTypeEntry=Nothing
                   , xabiTypeVal=Nothing
                   , xabiTypeKey=Nothing
                   }
            , xabiTypeVal = Just XabiType
                   { xabiTypeType = vty
                   , xabiTypeBytes = vby
                   , xabiTypeDynamic = vdy
                   , xabiTypeSigned = vsi
                   , xabiTypeTypedef=Nothing
                   , xabiTypeVal=Nothing
                   , xabiTypeKey=Nothing
                   , xabiTypeEntry = Just
                         XabiType{
                           xabiTypeBytes= veby
                         , xabiTypeType= vety
                         , xabiTypeTypedef=Nothing
                         , xabiTypeDynamic=Nothing
                         , xabiTypeSigned=Nothing
                         , xabiTypeEntry=Nothing
                         , xabiTypeVal=Nothing
                         , xabiTypeKey=Nothing
                         }
                   }
            , xabiTypeKey = Just XabiType
                   { xabiTypeType = kty
                   , xabiTypeBytes = kby
                   , xabiTypeDynamic = kdy
                   , xabiTypeSigned = ksi
                   , xabiTypeTypedef=Nothing
                   , xabiTypeVal=Nothing
                   , xabiTypeKey=Nothing
                   , xabiTypeEntry = Just
                         XabiType{
                           xabiTypeBytes = keby
                         , xabiTypeType = kety
                         , xabiTypeTypedef=Nothing
                         , xabiTypeDynamic=Nothing
                         , xabiTypeSigned=Nothing
                         , xabiTypeEntry=Nothing
                         , xabiTypeVal=Nothing
                         , xabiTypeKey=Nothing
                         }
                   }
            }
        }
  return $ Xabi funcs constr vars

getXabiType :: Int32 -> Bloc XabiType
getXabiType typeId = do
  (xtty,xttd,xtdy,xtsi,xtby,xtetid,xtvtid,xtktid)
    <- blocQuery1 $ proc () -> do
      (xtid,xtty,xttd,xtdy,xtsi,xtby,xtet,xtvt,xtkt)
        <- queryTable xabiTypesTable -< ()
      restrict -< xtid .== constant typeId
      returnA -< (xtty,xttd,xtdy,xtsi,xtby,xtet,xtvt,xtkt)
  xtet <- traverse getXabiType xtetid
  xtvt <- traverse getXabiType xtvtid
  xtkt <- traverse getXabiType xtktid
  return XabiType
    { xabiTypeType = Just xtty
    , xabiTypeTypedef = xttd
    , xabiTypeDynamic = Just xtdy
    , xabiTypeSigned = Just xtsi
    , xabiTypeBytes = xtby
    , xabiTypeEntry = xtet
    , xabiTypeVal = xtvt
    , xabiTypeKey = xtkt
    }

getContractXabi :: ContractName -> MaybeNamed Address -> Bloc Xabi
getContractXabi (ContractName contractName) contractId = do
  metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
  funcIdNameSelsMaybe <- blocQuery $ getXabiFunctionsQuery metadataId
  let
    -- TODO: fix this in next API iteration
    funcIdNameSels =
      [ (funcId, funcName, sel)
      | (funcId, Just funcName, Just sel) <- funcIdNameSelsMaybe
      ]
  funcs <- fmap Map.fromList $
    for funcIdNameSels $ \ (funcId,funcName,sel) -> do
      args <- do
        tuples <- blocQuery (getXabiFunctionsArgsQuery funcId)
        for tuples $ \ (name,index,ty,tyd,dy,by,ety,eby) ->
          return $ (name, ) IndexedXabiType
            { indexedXabiTypeIndex = index,
              indexedXabiTypeType =
                XabiType {
                  xabiTypeType = ty
                , xabiTypeTypedef = tyd
                , xabiTypeDynamic = dy
                , xabiTypeBytes = by
                , xabiTypeSigned = Nothing
                , xabiTypeVal = Nothing
                , xabiTypeKey = Nothing
                , xabiTypeEntry = Just
                  XabiType {
                    xabiTypeBytes = eby
                  , xabiTypeType = ety
                  , xabiTypeTypedef = Nothing
                  , xabiTypeDynamic = Nothing
                  , xabiTypeSigned = Nothing
                  , xabiTypeEntry = Nothing
                  , xabiTypeVal = Nothing
                  , xabiTypeKey = Nothing
                  }
                }
            }
      vals <- do
        tuples <- blocQuery (getXabiFunctionsReturnValuesQuery funcId)
        for tuples $ \ (_::Int32,index,ty,tyd,dy,by,ety,eby) ->
          return $ ("#" <> Text.pack (show index),) IndexedXabiType
            { indexedXabiTypeIndex = index,
              indexedXabiTypeType=
                XabiType{
                  xabiTypeType = ty
                , xabiTypeTypedef = tyd
                , xabiTypeDynamic = dy
                , xabiTypeBytes = by
                , xabiTypeSigned = Nothing
                , xabiTypeVal = Nothing
                , xabiTypeKey = Nothing
                , xabiTypeEntry = Just
                  XabiType {
                    xabiTypeBytes = eby
                  , xabiTypeType = ety
                  , xabiTypeTypedef = Nothing
                  , xabiTypeDynamic = Nothing
                  , xabiTypeSigned = Nothing
                  , xabiTypeEntry = Nothing
                  , xabiTypeVal = Nothing
                  , xabiTypeKey = Nothing
                  }
                }
            }
      let
        func = Func
          { funcArgs = Map.fromList args
          , funcSelector = Text.decodeUtf8 sel
          , funcVals = Map.fromList vals
          }
      return (funcName,func)
  constrId <- blocQuery1 $ getXabiConstrQuery metadataId
  constr <- Map.fromList <$> do
    tuples <- blocQuery (getXabiFunctionsArgsQuery constrId)
    for tuples $ \ (name,index,ty,tyd,dy,by,ety,eby) ->
      return $ (name, ) IndexedXabiType
        { indexedXabiTypeIndex = index,
          indexedXabiTypeType =
            XabiType {
              xabiTypeType = ty
            , xabiTypeTypedef = tyd
            , xabiTypeDynamic = dy
            , xabiTypeBytes = by
            , xabiTypeSigned = Nothing
            , xabiTypeVal = Nothing
            , xabiTypeKey = Nothing
            , xabiTypeEntry = Just
                 XabiType{
                   xabiTypeBytes=eby
                 , xabiTypeType=ety
                 , xabiTypeTypedef=Nothing
                 , xabiTypeDynamic=Nothing
                 , xabiTypeSigned=Nothing
                 , xabiTypeEntry=Nothing
                 , xabiTypeVal=Nothing
                 , xabiTypeKey=Nothing
                 }
            }
        }
  vars <- getXabiVariablesQuery metadataId
  return $ Xabi funcs constr vars

-- helper functions
forMap :: Applicative m => Map k v -> (k -> v -> m x) -> m (Map k x)
forMap m act = Map.traverseWithKey act m

forMap_ :: Applicative m => Map k v -> (k -> v -> m ()) -> m ()
forMap_ m act = void $ forMap m act
