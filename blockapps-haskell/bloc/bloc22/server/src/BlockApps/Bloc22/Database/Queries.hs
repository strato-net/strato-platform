{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE Arrows                #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TupleSections         #-}

module BlockApps.Bloc22.Database.Queries where

import           Control.Arrow
import           Control.Monad
import           Crypto.Hash
import           Crypto.HaskoinShim
import qualified Crypto.Saltine.Class            as Saltine
import qualified Crypto.Saltine.Core.SecretBox   as SecretBox
import           Data.Aeson                      (Result(..), fromJSON, decode, encode)
import qualified Data.ByteArray                  as ByteArray
import           Data.ByteString                 (ByteString)
import qualified Data.ByteString                 as BS
import qualified Data.ByteString.Char8           as Char8
import           Data.ByteString.Lazy            (fromStrict, toStrict)
import           Data.Either                     (fromRight)
import           Data.Int                        (Int32)
import           Data.Map.Strict                 (Map)
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Profunctor
import           Data.Profunctor.Product.Default
import           Data.RLP
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import qualified Data.Text.Encoding              as Text
import           Data.Traversable
import           Data.Tuple                      (swap)
import           Database.PostgreSQL.Simple      (Connection)
import           GHC.Stack
import           Opaleye                         hiding (not, null, index)
import           UnliftIO

import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Database.Solc
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.SolidityVarReader     (byteStringToWord256, word256ToByteString)
import           BlockApps.Solidity.Parse.Parser
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types
import           Blockchain.Strato.Model.CodePtr


{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

data Should a = Don't a | Do a
data Compile = Compile

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
SELECT id FROM users WHERE name = $1;
-}
getUserIdQuery :: UserName -> Query (Column PGInt4)
getUserIdQuery username = proc () -> do
  (uid, name) <- queryTable usersTable -< ()
  restrict -< name .== constant username
  returnA -< uid

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
postUsersUserQuery userName keystore conn = do
  userIds1 <- runQuery conn $ proc () -> do
    (userId,name) <- queryTable usersTable -< ()
    restrict -< name .== constant userName
    returnA -< userId
  userIds2 <- case listToMaybe userIds1 of
    Nothing -> runInsertManyReturning conn usersTable
      [(Nothing,constant userName)] fst
    Just userId -> return [userId::Int32]
  case listToMaybe userIds2 of
    Nothing -> return False
    Just userId -> insertKeyStore userId keystore conn

insertKeyStore :: Int32 -> KeyStore -> Connection -> IO Bool
insertKeyStore userId KeyStore{..} conn = do
    _ <- runInsertMany conn keyStoreTable [
      ( Nothing
      , constant keystoreSalt
      , constant keystorePasswordHash
      , constant keystoreAcctNonce
      , constant keystoreAcctEncSecKey
      , constant keystorePubKey
      , constant keystoreAcctAddress
      , constant userId
      )]
    return True

contractsJoinTable :: Query
  ( Column PGInt4
  , Column PGText
  , Column PGText
  , Column PGBytea
  , Column PGTimestamptz
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
contractsJoinTable = joinF
  (\ (_,_,a,ts, cid) (b,br,ch,xch,_,n,src,cmId,xabi) -> (cmId,n,src,a,ts,b,br,ch,xch,cid,xabi))
  (\ (_,contractmetadataId,_,_,_) (_,_,_,_,_,_,_,cmId,_) -> cmId .== contractmetadataId)
  (queryTable contractsInstanceTable)
  contractDetailsJoinTable

contractDetailsJoinTable :: Query
  ( Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGText
  , Column PGText
  , Column PGInt4
  , Column PGBytea
  )
contractDetailsJoinTable = joinF
  (\ (_,name) (cmId,_,b,br,ch,xch,sh,src,xabi) -> (b,br,ch,xch,sh,name,src,cmId,xabi))
  (\ (cId,_) (_,contractId,_,_,_,_,_,_,_) -> cId .== contractId)
  (queryTable contractsTable) $ joinF
    (\ (cmId,cid,b,br,ch,xch,sh,xabi) (_,_,src) -> (cmId,cid,b,br,ch,xch,sh,src,xabi))
    (\ (_,_,_,_,_,_,sh,_) (_,sh',_) -> sh .== sh')
    (queryTable contractsMetaDataTable)
    (queryTable contractsSourceTable)

contractByAddress
  :: Text
  -> Address
  -> Maybe ChainId
  -> Query
    ( Column PGInt4
    , Column PGText
    , Column PGText
    , Column PGBytea
    , Column PGTimestamptz
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    )
contractByAddress contractName contractAddress chainId = proc () -> do
  contract@(_,name,_,addr,_,_,_,_,_,cid,_) <- contractsJoinTable -< ()
  restrict -< name .== constant contractName
  restrict -< addr .== constant contractAddress
  restrict -< cid .== constant chainId
  returnA -< contract

contractByCodeHash
  :: CodePtr
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    , Column PGText
    , Column PGInt4
    , Column PGBytea
    )
contractByCodeHash codeHash = proc () -> do
  contract@(_,_,ch,_,_,_,_,_,_) <- contractDetailsJoinTable -< ()
  restrict -< ch .== constant codeHash
  returnA -< contract

contractByMetadataId
  :: Int32
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    , Column PGText
    , Column PGInt4
    , Column PGBytea
    )
contractByMetadataId metadataId = proc () -> do
  contract@(_,_,_,_,_,_,_,cmId,_) <- contractDetailsJoinTable -< ()
  restrict -< cmId .== constant metadataId
  returnA -< contract

contractInstancesByCodeHash
  :: CodePtr
  -> Address
  -> Maybe ChainId
  -> Query (Column PGInt4)
contractInstancesByCodeHash codeHash address chainId = proc () -> do
  (cmId,_,_,addr,_,_,_,ch,_,cid,_) <- contractsJoinTable -< ()
  restrict -< ch .== constant codeHash
  restrict -< addr .== constant address
  restrict -< cid .== constant chainId
  returnA -< cmId

contractBySourceHash
  :: Keccak256
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    , Column PGText
    , Column PGInt4
    , Column PGBytea
    )
contractBySourceHash srcHash = proc () -> do
  contract@(_,_,_,_,sh,_,_,_,_) <- contractDetailsJoinTable -< ()
  restrict -< sh .== constant srcHash
  returnA -< contract

contractNameFromAddress :: Address -> Maybe ChainId -> Query (Column PGText)
contractNameFromAddress contractAddress chainId = proc () -> do
  (_,name,_,addr,_,_,_,_,_,cid,_) <- contractsJoinTable -< ()
  restrict -< addr .== constant contractAddress
  restrict -< cid .== constant chainId
  returnA -< name

contractByTxHash :: Keccak256 -> Query (Column PGInt4, Column PGInt4, Column PGText)
contractByTxHash txHash = limit 1 $ proc () -> do
  (_,tx_hash,cmId,ttype,name) <- queryTable hashNameTable -< ()
  restrict -< tx_hash .== constant txHash
  returnA -< (cmId,ttype,name)

linkedContractsJoinTable :: Query
  ( Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGText
  , Column PGText
  , Column PGText
  , Column PGInt4
  , Column PGBytea
  )
linkedContractsJoinTable = joinF
  (\ (_,name2) (b,br,ch,xch,name,src,cm2Id,_,xabi) -> (b,br,ch,xch,name,name2,src,cm2Id,xabi))
  (\ (c2Id,_) (_,_,_,_,_,_,_,contractId2,_) -> c2Id .== contractId2)
  (queryTable contractsTable) $ joinF
    (\ (cm2Id,contractId2,_,_,_,_,_,_) (b,br,ch,xch,_,name,src,_,xabi) -> (b,br,ch,xch,name,src,cm2Id,contractId2,xabi))
    (\ (_,_,_,_,_,_,sh',_) (_,_,_,_,sh,_,_,_,_) -> sh' .== sh)
    (queryTable contractsMetaDataTable)
    contractDetailsJoinTable

{- |
SELECT CI.address FROM contracts_instance CI
 JOIN contracts_metadata CM ON CM.id = CI.contracts_metadata_id
 JOIN contracts C ON C.id = CM.contract_id
 WHERE C.name = $1 ORDER BY timestamp DESC;
-}
getSearchContractQuery :: Text -> Query (Column PGBytea, Column PGBytea)
getSearchContractQuery contractName = proc () -> do
  (_,name,_,addr,_,_,_,_,_,cid,_) <-
    orderBy (desc (\(_,_,_,_,timestamp,_,_,_,_,_,_) -> timestamp))
      contractsJoinTable -< ()
  restrict -< name .== constant contractName
  returnA -< (addr,cid)

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
getContractsAddressesQuery :: Maybe ChainId -> Query
  ( Column PGText
  , Column PGBytea
  , Column PGTimestamptz
  , Column PGBytea
  )
getContractsAddressesQuery chainId = proc () -> do
  (_,name,_,addr,timestamp,_,_,_,_,cid,_) <- limit 100 $ contractsJoinTable -< ()
  restrict -< cid .== constant chainId
  returnA -< (name,addr,timestamp,cid)

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
getContractsNamesAsAddressesQuery :: Maybe ChainId -> Query
  ( Column PGText
  , Column PGText
  , Column PGTimestamptz
  , Column PGBytea
  )
getContractsNamesAsAddressesQuery chainId = proc () -> do
  (n1,n2,ts,cid) <- limit 100 $ joinF
    (\ (_,_,_,timestamp,cid) (_,_,_,_,name,name2,_,_,_) -> (name,name2,timestamp,cid))
    (\ (_,contractmetadataId,_,_,_) (_,_,_,_,_,_,_,cm2Id,_) -> contractmetadataId .== cm2Id)
    (queryTable contractsInstanceTable)
    linkedContractsJoinTable
    -< ()
  restrict -< cid .== constant chainId
  returnA -< (n1,n2,ts,cid)

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
getContractsDataAddressesQuery :: Text -> Query (Column PGBytea, Column PGBytea)
getContractsDataAddressesQuery contractName = proc () -> do
  (_,name,_,addr,_,_,_,_,_,cid,_) <- contractsJoinTable -< ()
  restrict -< name .== constant contractName
  returnA -< (addr,cid)

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
      (_,_,_,_,name,name2,_,_,_) <- linkedContractsJoinTable -< ()
      restrict -< name .== constant contractName
      returnA -< name2
    latest = proc () -> do
      (_,name) <- queryTable contractsTable -< ()
      restrict -< name .== constant contractName
      returnA -< constant ("Latest"::Text)

getContractsMetaDataId :: Text -> MaybeNamed Address -> Maybe ChainId -> Bloc (Maybe Int32)
getContractsMetaDataId name contractId = fmap (fmap fst) . getContractDetailsAndMetadataId (ContractName name) contractId

getContractDetailsByAddressOnly :: Address -> Maybe ChainId -> Bloc (Maybe ContractDetails)
getContractDetailsByAddressOnly contractAddr chainId = do
  mName <- fmap listToMaybe . blocQuery $ contractNameFromAddress contractAddr chainId
  fmap join . for mName $ \name -> getContractDetails (ContractName name) (Unnamed contractAddr) chainId

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
  -> Maybe ChainId
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    , Column PGText
    , Column PGInt4
    , Column PGBytea
    )
getContractsContractByAddressQuery contractName contractAddress chainId =
  limit 1 $ proc () -> do
    (cmId,name,src,_,_,bin,binRuntime,codeHash,xcodeHash,_,xabi) <-
      contractByAddress contractName contractAddress chainId -< ()
    returnA -< (bin,binRuntime,codeHash,xcodeHash,name,src,cmId,xabi)

getContractsContractByCodeHashQuery
  :: CodePtr
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    , Column PGText
    , Column PGInt4
    , Column PGBytea
    )
getContractsContractByCodeHashQuery codeHash =
  limit 1 $ proc () -> do
    details <- contractByCodeHash codeHash -< ()
    returnA -< details

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
    , Column PGText
    , Column PGInt4
    , Column PGBytea
    )
getContractsContractByNameQuery contractName1 contractName2 = proc () -> do
  (b,br,ch,xch,name1,name2,src,cm2Id,xabi) <- linkedContractsJoinTable -< ()
  restrict -< name1 .== constant contractName1
  restrict -< name2 .== constant contractName2
  returnA -< (b,br,ch,xch,name2,src,cm2Id,xabi)

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
-}
getContractsContractBySameNameQuery
  :: Text
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGText
    , Column PGText
    , Column PGInt4
    , Column PGBytea
    )
getContractsContractBySameNameQuery contractName = proc () -> do
  (b,br,ch,xch,_,name,src,cmId,xabi) <- contractDetailsJoinTable -< ()
  restrict -< name .== constant contractName
  returnA -< (b,br,ch,xch,name,src,cmId,xabi)

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
    , Column PGText
    , Column PGInt4
    , Column PGBytea
    )
getContractsContractLatestQuery contractName = limit 1 $ proc () -> do
  (b,br,ch,xch,_,name,src,cmId,xabi) <-
    orderBy (desc (\ (_,_,_,_,_,_,_,cmId,_) -> cmId))
      contractDetailsJoinTable -< ()
  restrict -< name .== constant contractName
  returnA -< (b,br,ch,xch,name,src,cmId,xabi)

serializeXabi :: Xabi -> ByteString
serializeXabi = toStrict . encode

deserializeXabi :: ByteString -> Bloc Xabi
deserializeXabi = decodeXabiJSON

decodeXabiJSON :: ByteString -> Bloc Xabi
decodeXabiJSON xabi' = case decode (fromStrict xabi') of
  Nothing -> throwIO $ DBError "Corrupted Xabi stored in database"
  Just x -> return x

getContractDetailsByMetadataId :: Int32 -> MaybeNamed Address -> Maybe ChainId -> Bloc ContractDetails
getContractDetailsByMetadataId cmId addr chainId = do
  (bin,binRuntime,codeHash,_ :: ByteString,_ :: Keccak256,name,src,_ :: Int32,xabi') <-
    blocQuery1 "getContractDetailsByMetadataId" $ contractByMetadataId cmId
  xabi <- deserializeXabi xabi'
  return ContractDetails
    { contractdetailsBin = Text.decodeUtf8 bin
    , contractdetailsAddress = Just addr
    , contractdetailsBinRuntime = Text.decodeUtf8 binRuntime
    , contractdetailsCodeHash = codeHash
    , contractdetailsName = name
    , contractdetailsSrc = src
    , contractdetailsXabi = xabi
    , contractdetailsChainId = chainId
    }

getContractDetails :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc (Maybe ContractDetails)
getContractDetails name contractId = fmap (fmap snd) . getContractDetailsAndMetadataId name contractId

getContractDetailsAndMetadataId :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc (Maybe (Int32, ContractDetails))
getContractDetailsAndMetadataId (ContractName contractName) contractId chainId = do
    let
      detailsWith detailsAddr cid (bin,binRuntime,codeHash,_ :: ByteString,name,src,cmId,xabi') = do
        xabi <- deserializeXabi xabi'
        return (cmId, ContractDetails
          { contractdetailsBin = Text.decodeUtf8 bin
          , contractdetailsAddress = detailsAddr
          , contractdetailsBinRuntime = Text.decodeUtf8 binRuntime
          , contractdetailsCodeHash = codeHash
          , contractdetailsName = name
          , contractdetailsSrc = src
          , contractdetailsXabi = xabi
          , contractdetailsChainId = cid
          })
    case contractId of
      Named "Latest" -> do
        tuple <- blocQueryMaybe $
          getContractsContractLatestQuery contractName
        for tuple $ detailsWith Nothing chainId
      Unnamed addr -> do
        tuple <- fmap listToMaybe . blocQuery $
          getContractsContractByAddressQuery contractName addr chainId
        case tuple of
          Just t -> Just <$> detailsWith (Just (Unnamed addr)) chainId t
          Nothing -> do
            tuple' <- blocQueryMaybe $
              getContractsContractLatestQuery contractName
            for tuple' $ detailsWith (Just (Unnamed addr)) chainId
      Named name -> if contractName == name
        then do
          tuple <- fmap listToMaybe . blocQuery $
            getContractsContractBySameNameQuery name
          for tuple $ detailsWith (Just (Named name)) chainId
        else do
          tuple <- fmap listToMaybe . blocQuery $
            getContractsContractByNameQuery contractName name
          for tuple $ detailsWith (Just (Named name)) chainId

getContractDetailsByCodeHash :: CodePtr -> Bloc (Maybe (Int32, ContractDetails))
getContractDetailsByCodeHash codeHash = do
    mDetails <- fmap listToMaybe . blocQuery $ getContractsContractByCodeHashQuery codeHash
    for mDetails $ \(bin,binr,ch,_ :: ByteString,_ :: ByteString,name,src,cmId,xabi') -> do
      xabi <- deserializeXabi xabi'
      return (cmId, ContractDetails
        { contractdetailsBin = Text.decodeUtf8 bin
        , contractdetailsAddress = Nothing
        , contractdetailsBinRuntime = Text.decodeUtf8 binr
        , contractdetailsCodeHash = ch
        , contractdetailsName = name
        , contractdetailsSrc = src
        , contractdetailsXabi = xabi
        , contractdetailsChainId = Nothing
        })

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
createContractQuery :: Text -> Bloc Int32
createContractQuery contractName = do
  cIds <- blocQuery $ proc () -> do
    (cId,name) <- queryTable contractsTable -< ()
    restrict -< name .== constant contractName
    returnA -< cId
  case listToMaybe cIds of
    Just cId -> return cId
    Nothing -> blocModify1 $ \ conn -> runInsertManyReturning conn contractsTable
      [(Nothing, constant contractName)]
      fst

createContractBatchQuery :: [Text] -> Bloc (Map Text Int32)
createContractBatchQuery names = do
  cidMap <- fmap Map.fromList . blocQuery $ proc () -> do
    (cId,name) <- queryTable contractsTable -< ()
    restrict -< in_ (map constant names) name
    returnA -< (name, cId)
  let new = filter (isNothing . flip Map.lookup cidMap) names
      inserts = map (\n -> (Nothing, constant n)) new
  newCids <- fmap Map.fromList . blocModify $ \conn ->
    runInsertManyReturning conn contractsTable inserts swap
  return $ Map.union newCids cidMap

insertContractSourceQuery
  :: Text
  -> Bloc (Int32, Keccak256)
insertContractSourceQuery src = do
  let srcHash = (keccak256 $ Text.encodeUtf8 src)
  blocModify1 $ \ conn ->
    runInsertManyReturning conn contractsSourceTable [
      ( Nothing
      , constant srcHash
      , constant src
      )]
      (\ (csId,sh,_) -> (csId,sh))

{- |
Insert metadata into contract metadata table if metadata table does not contain codehash
and xcodehash combination.
-}
insertContractMetaDataQuery
  :: Int32
  -> Text
  -> Text
  -> CodePtr
  -> Keccak256
  -> Keccak256
  -> Xabi
  -> Bloc Int32
insertContractMetaDataQuery
  contractId bin binRuntime codeHash xcodeHash srcHash xabi = blocModify1 $ \ conn ->
    runInsertManyReturning conn contractsMetaDataTable [
      ( Nothing
      , constant contractId
      , constant (Text.encodeUtf8 bin)
      , constant (Text.encodeUtf8 binRuntime)
      , constant codeHash
      , constant xcodeHash
      , constant srcHash
      , constant (serializeXabi xabi)
      )]
      (\ (contractmetadataId,_,_,_,_,_,_,_) -> contractmetadataId)

insertContractMetaDataBatchQuery
  :: Keccak256
  -> [(Int32, ContractDetails)]
  -> Bloc (Map Int32 Int32)
insertContractMetaDataBatchQuery srcHash details = blocModify $ \ conn ->
  let inserts = flip map details $ \(contractId, ContractDetails{..}) ->
        ( Nothing
        , constant contractId
        , constant (Text.encodeUtf8 contractdetailsBin)
        , constant (Text.encodeUtf8 contractdetailsBinRuntime)
        , constant contractdetailsCodeHash
        , constant $ keccak256 (Text.encodeUtf8 contractdetailsBin)
        , constant srcHash
        , constant (serializeXabi contractdetailsXabi)
        )
   in Map.fromList <$> runInsertManyReturning conn contractsMetaDataTable inserts
        (\(contractmetadataId,cId,_,_,_,_,_,_) -> (cId,contractmetadataId))

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

instance QueryRunnerColumnDefault PGBytea PubKey where
  queryRunnerColumnDefault =
     queryRunnerColumn id toPubKey queryRunnerColumnDefault
     where toPubKey :: ByteString -> PubKey
           toPubKey = fromMaybe (error "could not import pubkey") . importPubKey

instance Default Constant UserName (Column PGText) where
  def = lmap getUserName def

instance Default Constant StateMutability (Column PGText) where
  def = lmap tShow def

instance QueryRunnerColumnDefault PGText StateMutability where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode mutability") . tRead)
    queryRunnerColumnDefault

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

instance QueryRunnerColumnDefault PGBytea CodePtr where
  queryRunnerColumnDefault =
    queryRunnerColumn id toCodePtr queryRunnerColumnDefault
    where
      toCodePtr :: ByteString -> CodePtr
      toCodePtr
        = fromRight (error "could not decode CodePtr")
        . rlpDeserialize

instance Default Constant CodePtr (Column PGBytea) where
  def = lmap rlpSerialize def

instance QueryRunnerColumnDefault PGBytea (Maybe ChainId) where
  queryRunnerColumnDefault =
    queryRunnerColumn id toChainId queryRunnerColumnDefault
    where
      toChainId :: ByteString -> Maybe ChainId
      toChainId bs
        = if BS.null bs
            then Nothing
            else Just
               . ChainId
               . byteStringToWord256
               $ bs

instance Default Constant (Maybe ChainId) (Column PGBytea) where
  def = lmap fromChainId def
        where fromChainId = \case
                Nothing -> BS.empty
                Just cid -> word256ToByteString $ unChainId cid

insertContractInstance
  :: Int32
  -> Address
  -> Maybe ChainId
  -> Bloc Int32
insertContractInstance cmId address chainId = blocModify1 $ \conn -> runInsertManyReturning conn contractsInstanceTable
  [
  ( Nothing
  , constant cmId
  , constant address
  , Nothing
  , constant chainId
  )
  ]
  (\ (contractInstanceId,_,_,_,_) -> contractInstanceId)

sourceToContractDetails :: Should Compile -> Text -> Bloc (Map Text (Int32, ContractDetails))
sourceToContractDetails shouldCompile source = do
  let createContractDetails =
        case shouldCompile of
          Do Compile -> compileContract
          Don't Compile -> createMetadataNoCompile
  details <- blocQuery . contractBySourceHash . keccak256 $ Text.encodeUtf8 source
  if null details
    then createContractDetails source
    else fmap Map.fromList . forM details $
      \(bin,binr,ch,_ :: ByteString,_ :: ByteString,name,src,cmId,xabi') -> do
        xabi <- deserializeXabi xabi'
        return (name,(cmId, ContractDetails
          { contractdetailsBin = Text.decodeUtf8 bin
          , contractdetailsAddress = Nothing
          , contractdetailsBinRuntime = Text.decodeUtf8 binr
          , contractdetailsCodeHash = ch
          , contractdetailsName = name
          , contractdetailsSrc = src
          , contractdetailsXabi = xabi
          , contractdetailsChainId = Nothing
          }))

compileContract :: Text -> Bloc (Map Text (Int32, ContractDetails))
compileContract source = do
  let eVerXabis = parseXabi "-" $ Text.unpack source
  (ver, xabis) <- case eVerXabis of
    Left err -> blocError . UserError . Text.pack $ err
    Right (v, xs) -> return (v, Map.fromList xs)
  eabiBins <- fromJSON <$> compileSolc ver source
  abiBins <- case eabiBins of
    Error err -> blocError . UserError . Text.pack $ err
    -- Starting with 0.4.9, solc prepends a filename to abi keys.
    -- Bloc should too, but this change is easier :^)
    Success res -> return . Map.mapKeys (snd . Text.breakOnEnd ":") $ res
  --TODO - clean this up, what should filename be instead of "-"
  --       get rid of error
  --       name nicer, mabye merge with next let
  let contracts = Map.intersectionWith (,) xabis abiBins
      details = flip Map.mapWithKey contracts $ \ contrName (xabi,AbiBin{..}) ->
        ContractDetails
        { contractdetailsBin = bin
        , contractdetailsAddress = Just (Named "Latest")
        , contractdetailsBinRuntime = binRuntime
        , contractdetailsCodeHash =  EVMCode . keccak256SHA $ binRuntimeToCodeHash binRuntime
        , contractdetailsName = contrName
        , contractdetailsSrc = source
        , contractdetailsXabi = xabi
        , contractdetailsChainId = Nothing
        }

  (_,srcHash) <- insertContractSourceQuery source
  contractIdMap <- createContractBatchQuery $ Map.keys details
  let idDetails = Map.elems $ Map.intersectionWith (,) contractIdMap details
  mdIdMap <- insertContractMetaDataBatchQuery srcHash idDetails
  let cmIdDetails = Map.elems . Map.intersectionWith (,) mdIdMap $ Map.fromList idDetails
  return . Map.fromList $ map ((contractdetailsName . snd) &&& id) cmIdDetails

-- SolidVM only
createMetadataNoCompile :: Text -> Bloc (Map Text (Int32, ContractDetails))
createMetadataNoCompile source = do
  let eVerXabis = parseXabi "-" $ Text.unpack source
  xabis <- case eVerXabis of
    Left err -> blocError . UserError . Text.pack $ err
    Right (_, xs) -> return $ Map.fromList xs
  let contracts = xabis
      details = flip Map.mapWithKey contracts $ \ contrName (xabi) ->
        ContractDetails
        { contractdetailsBin = source
        , contractdetailsAddress = Just (Named "Latest")
        , contractdetailsBinRuntime = contrName `Text.append` source
        , contractdetailsCodeHash = SolidVMCode (Text.unpack contrName) $ keccak256SHA $ keccak256 (Char8.pack $ Text.unpack source)
        , contractdetailsName = contrName
        , contractdetailsSrc = source
        , contractdetailsXabi = xabi
        , contractdetailsChainId = Nothing
        }

  (_,srcHash) <- insertContractSourceQuery source
  contractIdMap <- createContractBatchQuery $ Map.keys details

  let idDetails = Map.elems $ Map.intersectionWith (,) contractIdMap details
  mdIdMap <- insertContractMetaDataBatchQuery srcHash idDetails
  let cmIdDetails = Map.elems . Map.intersectionWith (,) mdIdMap $ Map.fromList idDetails
  return . Map.fromList $ map ((contractdetailsName . snd) &&& id) cmIdDetails

getContractXabiByMetadataId :: HasCallStack => Int32 -> Bloc Xabi
getContractXabiByMetadataId cmId = do
  xabi' <- blocQuery1 "getContractXabiByMetadataId" . fmap ninth $ contractByMetadataId cmId
  deserializeXabi xabi'
  where ninth (_,_,_,_,_,_,_,_,x) = x

getContractXabi :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc (Maybe Xabi)
getContractXabi contractName contractId =
  fmap (fmap contractdetailsXabi) . getContractDetails contractName contractId
