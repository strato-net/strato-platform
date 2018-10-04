{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE Arrows                #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TupleSections         #-}

module BlockApps.Bloc22.Database.Queries where


import           Control.Arrow
import           Control.Concurrent              (threadDelay)
import           Control.Monad
import           Control.Monad.Except
import           Crypto.Hash
import qualified Crypto.Saltine.Class            as Saltine
import qualified Crypto.Saltine.Core.SecretBox   as SecretBox
import           Crypto.Secp256k1
import           Data.Aeson                      (Result(..),fromJSON)
import qualified Data.ByteArray                  as ByteArray
import           Data.ByteString                 (ByteString)
import qualified Data.ByteString                 as BS
import qualified Data.ByteString.Char8           as Char8
import           Data.Foldable
import           Data.Int                        (Int32, Int64)
import           Data.Map.Strict                 (Map)
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Monoid
import           Data.Profunctor
import           Data.Profunctor.Product.Default
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import qualified Data.Text.Encoding              as Text
import           Data.Traversable
import           Database.PostgreSQL.Simple      (Connection)
import           GHC.Stack
import           Opaleye                         hiding (not, null, index)
import qualified Opaleye                         (not, null)


import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Database.Solc
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.SolidityVarReader     (byteStringToWord256, word256ToByteString)
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Parse.Parser
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Def     as Xabi.Def
import qualified BlockApps.Solidity.Xabi.Type    as Xabi
import           BlockApps.Strato.Types
import           BlockApps.Strato.Client
import           BlockApps.XAbiConverter

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

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
  , Column PGBytea
  , Column PGTimestamptz
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
contractsJoinTable = joinF
  (\ (_,_,a,ts, cid) (cmId,n,b,br,ch,xch) -> (cmId,n,a,ts,b,br,ch,xch,cid))
  (\ (_,contractmetadataId,_,_,_) (cmId,_,_,_,_,_) -> cmId .== contractmetadataId)
  (queryTable contractsInstanceTable) $ joinF
    (\ (cmId,_,b,br,ch,xch) (_,n) -> (cmId,n,b,br,ch,xch))
    (\ (_,contractId,_,_,_,_) (cid,_) -> cid .== contractId)
    (queryTable contractsMetaDataTable)
    (queryTable contractsTable)

contractByAddress
  :: Text
  -> Address
  -> Maybe ChainId
  -> Query
    ( Column PGInt4
    , Column PGText
    , Column PGBytea
    , Column PGTimestamptz
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    , Column PGBytea
    )
contractByAddress contractName contractAddress chainId = proc () -> do
  contract@(_,name,addr,_,_,_,_,_,cid) <- contractsJoinTable -< ()
  restrict -< name .== constant contractName
  restrict -< addr .== constant contractAddress
  restrict -< cid .== constant chainId
  returnA -< contract

contractNameFromAddress :: Address -> Maybe ChainId -> Query (Column PGText)
contractNameFromAddress contractAddress chainId = proc () -> do
  (_,name,addr,_,_,_,_,_,cid) <- contractsJoinTable -< ()
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
  , Column PGInt4
  )
linkedContractsJoinTable = joinF
  (\ (_,name2) (name,cm2Id,_,b,br,ch,xch) -> (b,br,ch,xch,name,name2,cm2Id))
  (\ (c2Id,_) (_,_,contractId2,_,_,_,_) -> c2Id .== contractId2)
  (queryTable contractsTable) $ joinF
    (\ (cm2Id,contractId2,_,_,_,_) (name,_,b,br,ch,xch) -> (name,cm2Id,contractId2,b,br,ch,xch))
    (\ (cm2Id,_,_,_,_,_) (_,linkedmetadataId,_,_,_,_) -> cm2Id .== linkedmetadataId)
    (queryTable contractsMetaDataTable) $ joinF
      (\ (_,linkedmetadataId) (name,_,b,br,ch,xch) -> (name,linkedmetadataId,b,br,ch,xch))
      (\ (contractmetadataId,_) (_,cmId,_,_,_,_) -> contractmetadataId .== cmId)
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
getSearchContractQuery :: Text -> Query (Column PGBytea, Column PGBytea)
getSearchContractQuery contractName = proc () -> do
  (_,name,addr,_,_,_,_,_,cid) <-
    orderBy (desc (\(_,_,_,timestamp,_,_,_,_,_) -> timestamp))
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
getContractsAddressesQuery :: Query
  ( Column PGText
  , Column PGBytea
  , Column PGTimestamptz
  , Column PGBytea
  )
getContractsAddressesQuery = proc () -> do
  (_,name,addr,timestamp,_,_,_,_,cid) <- contractsJoinTable -< ()
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
getContractsNamesAsAddressesQuery :: Query
  ( Column PGText
  , Column PGText
  , Column PGTimestamptz
  , Column PGBytea
  )
getContractsNamesAsAddressesQuery = joinF
  (\ (_,_,_,timestamp,cid) (_,_,_,_,name,name2,_) -> (name,name2,timestamp,cid))
  (\ (_,contractmetadataId,_,_,_) (_,_,_,_,_,_,cm2Id) -> contractmetadataId .== cm2Id)
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
getContractsDataAddressesQuery :: Text -> Query (Column PGBytea, Column PGBytea)
getContractsDataAddressesQuery contractName = proc () -> do
  (_,name,addr,_,_,_,_,_,cid) <- contractsJoinTable -< ()
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
      (_,_,_,_,name,name2,_) <- linkedContractsJoinTable -< ()
      restrict -< name .== constant contractName
      returnA -< name2
    latest = proc () -> do
      (_,name) <- queryTable contractsTable -< ()
      restrict -< name .== constant contractName
      returnA -< constant ("Latest"::Text)

getContractsMetaDataId :: Text -> MaybeNamed Address -> Maybe ChainId -> Query (Column PGInt4)
getContractsMetaDataId contractName mContractId chainId = case mContractId of
  Named "Latest" ->
    getContractsMetaDataIdByLatestQuery contractName
  Unnamed contractAddress ->
    getContractsMetaDataIdByAddressQuery contractName contractAddress chainId
  Named name -> if contractName == name
    then getContractsMetaDataIdBySameNameQuery contractName
    else getContractsMetaDataIdByNameQuery contractName name

getContractsMetaDataIdExhaustive :: Text -> Address -> Maybe ChainId -> Bloc Int32
getContractsMetaDataIdExhaustive contractName contractAddr chainId = do
  -- cmIds <- catchError byAddress $ \ _ ->
  --   catchError byLatest $ \ _ ->
  --     bySameName
  cmIdsByAddress <- byAddress
  cmIdsByLatest <- byLatest
  cmIdsBySameName <- bySameName
  let cmIds = cmIdsByAddress ++ cmIdsByLatest ++ cmIdsBySameName
  -- cmIds <- catchError byAddress (\ _ -> (catchError byLatest (\ _ -> bySameName)))
  case cmIds of
    [] -> do
      mcmId <- addContractMetaDatafromStrato
      case mcmId of
        Nothing -> throwError $ UserError "getContractsMetaDataIdExhaustive: couldn't find contract metadata id"
        Just (cmId,_) -> return cmId
    cmId:_ -> return cmId
  where
    byAddress = blocQuery $ getContractsMetaDataIdByAddressQuery contractName contractAddr chainId
    byLatest = blocQuery $ getContractsMetaDataIdByLatestQuery contractName
    bySameName = blocQuery $ getContractsMetaDataIdBySameNameQuery contractName
    addContractMetaDatafromStrato = do
      mSrcHash <- getSourceFromStrato contractAddr chainId
      case mSrcHash of
        Nothing -> do
          return Nothing

        Just (src, codeHash) -> do
          cmIds <- compileContract src
          let valid cd = codeHash == contractdetailsCodeHash (snd cd) ||
                         contractName == contractdetailsName (snd cd)
          return . listToMaybe . filter valid . Map.elems $ cmIds
    getSourceFromStrato addr cid = do
      let afp = accountsFilterParams{qaAddress=Just addr, qaChainId = cid}
      mAcc <- listToMaybe <$> blocStrato (getAccountsFilter afp)
      return ((arr accountSource &&& arr accountCodeHash) <$> mAcc)

getContractDetailsByAddressOnly :: Address -> Maybe ChainId -> Bloc ContractDetails
getContractDetailsByAddressOnly contractAddr chainId = do
  mName <- blocQuery $ contractNameFromAddress contractAddr chainId
  case mName of
    [] -> do
      mDetails <- addContractMetaDatafromStrato
      case mDetails of
        Nothing -> throwError $ UserError "getContractDetailsByAddressOnly: couldn't find contract metadata id"
        Just (cmId,details) -> do
          xs::[Int32] <- blocQuery $ proc () -> do
            (cmId',_,_,_,_,_,_,_,_) <- contractByAddress (contractdetailsName details) contractAddr chainId -< ()
            returnA -< cmId'
          when (isNothing $ listToMaybe xs) $ do
            void . blocModify $ \conn -> runInsertMany conn contractsInstanceTable [
              ( Nothing
              , constant cmId
              , constant contractAddr
              , Nothing
              , constant chainId
              )]
          return details{contractdetailsAddress = Just $ Unnamed contractAddr}
    name:_ -> getContractDetails (ContractName name) (Unnamed contractAddr) chainId
  where
    addContractMetaDatafromStrato = do
      mSrcHash <- getSourceFromStrato contractAddr chainId
      case mSrcHash of
        Nothing -> do
          return Nothing

        Just acct -> do
          cds <- compileContract (accountSource acct)
          let valid cd = accountCodeHash acct == contractdetailsCodeHash (snd cd) ||
                         accountContractName acct == Just (contractdetailsName (snd cd))
          return . listToMaybe . filter valid . Map.elems $ cds
    getSourceFromStrato addr cid = do
      let afp = accountsFilterParams{qaAddress=Just addr, qaChainId = cid}
      listToMaybe <$> blocStrato (getAccountsFilter afp)

insertXabiFunctionArg
  :: Int32
  -> Map Text Xabi.IndexedType
  -> Bloc Int64
insertXabiFunctionArg funcId args = do
  argsWithIds <- for args $ \ (Xabi.IndexedType index xt) -> do
    xtid <- insertXabiType xt
    return (index,xtid)
  blocModify $ \conn ->
    runInsertMany conn xabiFunctionArgumentsTable
      [ ( Nothing
        , constant funcId
        , constant xtid
        , constant name
        , constant index
        )
      | (name,(index,xtid)) <- Map.toList argsWithIds
      ]

insertXabiFunctionRet
  :: Int32
  -> [Xabi.IndexedType]
  -> Bloc Int64
insertXabiFunctionRet funcId vals = do
  valIds <- for vals $ \ (Xabi.IndexedType index xt) -> do
    xtid <- insertXabiType xt
    return (index,xtid)
  blocModify $ \conn ->
    runInsertMany conn xabiFunctionReturnsTable
      [ ( Nothing
        , constant funcId
        , constant index
        , constant xtid
        )
      | (index,xtid) <- valIds
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
  -> Maybe ChainId
  -> Query (Column PGInt4)
getContractsMetaDataIdByAddressQuery contractName contractAddress chainId =
  proc () -> do
    (cmId,_,_,_,_,_,_,_,_) <-
      contractByAddress contractName contractAddress chainId -< ()
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
  -> Maybe ChainId
  -> Query
    ( Column PGBytea
    , Column PGBytea
    , ( Column PGBytea
      , Column PGBytea
      , Column PGBytea
      , Column PGBytea
      , Column PGText
      , Column PGInt4
    ) )
getContractsContractByAddressQuery contractName contractAddress chainId =
  limit 1 $ proc () -> do
    (cmId,name,addr,_,bin,binRuntime,codeHash,xcodeHash,cid) <-
      contractByAddress contractName contractAddress chainId -< ()
    returnA -< (addr,cid,(bin,binRuntime,codeHash,xcodeHash,name,cmId))

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
  limit 1 . orderBy (desc id) $ proc () -> do
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
    , Column PGInt4
    )
getContractsContractByNameQuery contractName1 contractName2 =
  limit 1 $ proc () -> do
    (b,br,ch,xch,name1,name2,cm2Id) <- linkedContractsJoinTable -< ()
    restrict -< name1 .== constant contractName1
    restrict -< name2 .== constant contractName2
    returnA -< (b,br,ch,xch,name2,cm2Id)

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
  limit 1 . orderBy (desc id) $ proc () -> do
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
    , Column PGInt4
    )
getContractsContractBySameNameQuery contractName =
  limit 1 $ proc () -> do
    (b,br,ch,xch,name,cmId) <- joinTable -< ()
    restrict -< name .== constant contractName
    returnA -< (b,br,ch,xch,name,cmId)
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
  (_,_,_,_,_,cmId) <-
    getContractsContractLatestQuery contractName -< ()
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
    , Column PGInt4
    )
getContractsContractLatestQuery contractName = limit 1 $ proc () -> do
  (cmId,name,b,br,ch,xch) <-
    orderBy (desc (\ (cmId,_,_,_,_,_) -> cmId))
      joinTable -< ()
  restrict -< name .== constant contractName
  returnA -< (b,br,ch,xch,name,cmId)
  where
    joinTable = joinF
      (\ (cmId,_,b,br,ch,xch) (_,n) -> (cmId,n,b,br,ch,xch))
      (\ (_,contractId,_,_,_,_) (cid,_) -> cid .== contractId)
      (queryTable contractsMetaDataTable)
      (queryTable contractsTable)
{- |
SELECT
  XF.id
 ,XF.name
 ,XF.selector
FROM xabi_functions XF
WHERE XF.is_constructor = false AND XF.contract_metadata_id = $1;
-}
getXabiFunctionsQuery :: HasCallStack =>
                         Int32 -> Bloc (Map Text Func)
getXabiFunctionsQuery cmId = do
  funcsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (xfId,contractmetadataId,isConstr,name,mut) <-
      queryTable xabiFunctionsTable -< ()
    restrict -< contractmetadataId .== constant cmId .&& Opaleye.not isConstr
    returnA -< (name,(xfId, mut))
  for funcsWithIds $ \ (xfId, mut) -> do --TODO remove the selector from the DB
    args <- getXabiFunctionsArgsQuery xfId
    let
      valMap valList = Map.fromList
        [ ( "#" <> Text.pack (show (Xabi.indexedTypeIndex val)), val)
        | val <- valList
        ]
    vals <- valMap <$> getXabiFunctionsReturnValuesQuery xfId
    return  Func { funcArgs = args
                 , funcVals = vals
                 , funcContents = Nothing
                 , funcStateMutability = mut
                 , funcVisibility = Nothing
                 , funcModifiers = Nothing
                 }

{- |
SELECT
  XF.id
 ,XF.name
 ,XF.selector
FROM xabi_functions XF
WHERE XF.is_constructor = false AND XF.contract_metadata_id = $1;
-}
getXabiConstrQuery :: HasCallStack =>
                         Int32 -> Bloc (Map Text Func)
getXabiConstrQuery cmId = do
  funcsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (xfId,contractmetadataId,isConstr,name, _) <-
      queryTable xabiFunctionsTable -< ()
    restrict -< contractmetadataId .== constant cmId .&& isConstr
    returnA -< (name,xfId)
  if (length funcsWithIds /= 1)
    then return Map.empty
    else do
      let (fname,xfId) = head . Map.toList $ funcsWithIds
      args <- getXabiFunctionsArgsQuery xfId
      let
        valMap valList = Map.fromList
          [ ( "#" <> Text.pack (show (Xabi.indexedTypeIndex val)), val)
          | val <- valList
          ]
      vals <- valMap <$> getXabiFunctionsReturnValuesQuery xfId
      let func = Func { funcArgs = args
                      , funcVals = vals
                      , funcStateMutability = Nothing
                      , funcContents = Nothing
                      , funcVisibility = Nothing
                      , funcModifiers = Nothing
                      }
      return $ Map.singleton fname func

getXabiFunctionNamesQuery :: Int32 -> Query ( Column PGText)
getXabiFunctionNamesQuery metadataId = proc () -> do
  (_,cmid,isc,name,_) <-
    queryTable xabiFunctionsTable -< ()
  restrict -< cmid .== constant metadataId .&& Opaleye.not isc
  returnA -< name


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
  -> Bloc (Map Text Xabi.IndexedType)
getXabiFunctionsArgsQuery funcId = do
  argsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (_,functionId,tyid,name,index) <-
      queryTable xabiFunctionArgumentsTable -< ()
    restrict -< functionId .== constant funcId
    returnA -< (name,(index,tyid))
  for argsWithIds $ \ (index,tyid) -> do
    ty <- getXabiType tyid
    return $ Xabi.IndexedType index ty

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
getXabiFunctionsReturnValuesQuery :: HasCallStack =>
                                     Int32 -> Bloc [Xabi.IndexedType]
getXabiFunctionsReturnValuesQuery funcId = do
  valsWithIds <- blocQuery $ proc () -> do
    (_,functionId,index,tyid) <-
      queryTable xabiFunctionReturnsTable -< ()
    restrict -< functionId .== constant funcId
    returnA -< (index,tyid)
  for valsWithIds $ \ (index,tyid) -> do
    ty <- getXabiType tyid
    return $ Xabi.IndexedType index ty

{- |
SELECT
   XV.name
  ,XV.at_bytes
  ,XV.type_id
FROM
  xabi_variables XV
WHERE XV.contract_metadata_id = $1;
-}
getXabiVariablesQuery :: Int32 -> Bloc (Map Text Xabi.VarType)
getXabiVariablesQuery cmId = do
  varsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (_,cmid,typeid,name,atbytes,ispublic,isconstant,value)
      <- queryTable xabiVariablesTable -< ()
    restrict -< cmid .== constant cmId
    returnA -< (name,(atbytes,ispublic,isconstant,value,typeid))
  for varsWithIds $ \ (atbytes,ispublic,isconstant, value,typeid) -> do
    ty <- getXabiType typeid
    return $ Xabi.VarType atbytes (Just ispublic) (Just isconstant) value ty


getXabiVariableNamesQuery :: Int32 -> Query ( Column PGText )
getXabiVariableNamesQuery metadataId = proc () -> do
  (_,cmid,_,varName,_,_,_,_) <-
    queryTable xabiVariablesTable -< ()
  restrict -< cmid .== constant metadataId
  returnA -< varName


getContractDetails :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc ContractDetails
getContractDetails contract@(ContractName contractName) contractId chainId = do
    xabi <- getContractXabi contract contractId chainId
    let
      detailsWith detailsAddr cid (bin,binRuntime,codeHash,_ :: ByteString,name,_ :: Int32) =
        ContractDetails
          { contractdetailsBin = Text.decodeUtf8 bin
          , contractdetailsAddress = detailsAddr
          , contractdetailsBinRuntime = Text.decodeUtf8 binRuntime
          , contractdetailsCodeHash = codeHash
          , contractdetailsName = name
          , contractdetailsXabi = xabi
          , contractdetailsChainId = cid
          }
    case contractId of
      Named "Latest" -> do
        tuple <- blocQuery1 $
          getContractsContractLatestQuery contractName
        return $ detailsWith Nothing chainId tuple
      Unnamed addr -> do
        (addr',cid,tuple) <- blocQuery1 $
          getContractsContractByAddressQuery contractName addr chainId
        return $ detailsWith (Just (Unnamed addr')) cid tuple
      Named name -> if contractName == name
        then do
          tuple <- blocQuery1 $
            getContractsContractBySameNameQuery name
          return $ detailsWith (Just (Named name)) chainId tuple
        else do
          tuple <- blocQuery1 $
            getContractsContractByNameQuery contractName name
          return $ detailsWith (Just (Named name)) chainId tuple

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
  -> Bloc Int32
insertContractMetaDataQuery
  contractId bin binRuntime codeHash xcodeHash = blocModify1 $ \ conn ->
    runInsertManyReturning conn contractsMetaDataTable [
      ( Nothing
      , constant contractId
      , constant (Text.encodeUtf8 bin)
      , constant (Text.encodeUtf8 binRuntime)
      , constant codeHash
      , constant xcodeHash
      )]
      (\ (contractmetadataId,_,_,_,_,_) -> contractmetadataId)

{- |
INSERT INTO contracts_lookup (contract_metadata_id, linked_metadata_id)
SELECT $1,$2  WHERE NOT EXISTS
(SELECT contract_metadata_id, linked_metadata_id FROM contracts_lookup
WHERE contract_metadata_id = $1 AND linked_metadata_id = $2);
-}
insertContractLookup :: Int32 -> Int32 -> Connection -> IO ()
insertContractLookup metadataId linkedId conn = do
  rows <- runQuery conn $ proc () -> do
    row@(contractmetadataId,linkedmetadataId) <-
      queryTable contractsLookupTable -< ()
    restrict -< contractmetadataId .== constant metadataId
      .&& linkedmetadataId .== constant linkedId
    returnA -< row
  when (null (rows::[(Int32,Int32)])) . void $
    runInsertMany conn contractsLookupTable
      [(constant metadataId,constant linkedId)]



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

insertXabiVariables
  :: Int32
  -> Map Text Xabi.VarType
  -> Bloc Int64
insertXabiVariables metadataId vars = do
  varsWithIds <- for (Map.toList vars) $ \ (name,Xabi.VarType atBytes ispublic isconstant value xt) -> do
    varIds :: [Int32] <- blocQuery $ proc () -> do
      (vId,cmId,_,vname,_,_,_,_) <- queryTable xabiVariablesTable -< ()
      restrict -< cmId .== constant metadataId
        .&& vname .== constant name
      returnA -< vId
    if null varIds
    then do
      xtid <- insertXabiType xt
      return $ Just (name,atBytes,ispublic,isconstant,value,xtid)
    else
      return Nothing
  blocModify $ \conn ->
    runInsertMany conn xabiVariablesTable
      [ ( Nothing
        , constant metadataId
        , constant xtid
        , constant name
        , constant atBytes
        , constant (fromMaybe False ispublic)
        , constant (fromMaybe False isconstant)
        , constant value
        )
      | Just (name,atBytes,ispublic,isconstant,value,xtid) <- varsWithIds
      ]

{- |
INSERT INTO xabi_functions
  (contract_metadata_id,name,selector,is_constructor)
  VALUES ($1,$2,$3,$4) RETURNING id;
-}
insertXabiFunction
  :: Int32
  -> (Text, Func)
  -> Bloc ()
insertXabiFunction metadataId (name,Func{..}) = do
  funcIds :: [Int32] <- blocQuery $ proc () -> do
    (fId,cmId,_,fname,_) <- queryTable xabiFunctionsTable -< ()
    restrict -< cmId .== constant metadataId
      .&& fname .== constant name
    returnA -< fId
  when (null funcIds) $ do
    funcId <- blocModify1 $ \ conn -> runInsertManyReturning conn xabiFunctionsTable [
      ( Nothing
      , constant metadataId
      , constant False
      , constant name
      , constant funcStateMutability
      )]
      (\ (xfId,_,_,_,_) -> xfId)
    void $ insertXabiFunctionArg funcId funcArgs
    void $ insertXabiFunctionRet funcId (toList funcVals)

insertXabiConstr
  :: Int32
  -> Text
  -> Map Text Xabi.IndexedType
  -> Bloc ()
insertXabiConstr metadataId contractName constrArgs = unless (Map.null constrArgs) $ do
  funcId <- blocModify1 $ \ conn -> runInsertManyReturning conn xabiFunctionsTable [
    ( Nothing
    , constant metadataId
    , constant True
    , constant contractName
    , constant (Nothing :: Maybe StateMutability)
    )]
    (\ (xfId,_,_,_, _) -> xfId)
  void $ insertXabiFunctionArg funcId constrArgs

insertXabi :: Int32 -> Text -> Xabi -> Bloc ()
insertXabi metadataId contractName Xabi{..} = do
  traverse_ (insertXabiFunction metadataId) (Map.toList xabiFuncs)
  case Map.lookup contractName xabiConstr of
    Just constr -> insertXabiConstr metadataId contractName (funcArgs constr)
    Nothing -> return ()
  void $ insertXabiVariables metadataId xabiVars
  void $ insertXabiTypeDefs metadataId xabiTypes

insertContract
  :: Text
  -> Text
  -> Text
  -> Text
  -> Xabi
  -> Bloc Int32
insertContract parentContr contr bin binRuntime xabi = do
  let
    codeHash = binRuntimeToCodeHash binRuntime
    xcodeHash = keccak256 (Text.encodeUtf8 bin)
  contrId <- createContractQuery contr
  metadataId <- insertContractMetaDataQuery
    contrId bin binRuntime codeHash xcodeHash
  insertXabi metadataId parentContr xabi
  return metadataId

compileContract :: Text -> Bloc (Map Text (Int32, ContractDetails))
compileContract source' = do
  source <- addFuncsToSource source'
  eabiBins <- fromJSON <$> compileSolc source
  abiBins <- case eabiBins of
    Error err -> blocError . UserError . Text.pack $ err
    -- Starting with 0.4.9, solc prepends a filename to abi keys.
    -- Bloc should too, but this change is easier :^)
    Success res -> return . Map.mapKeys (snd . Text.breakOnEnd ":") $ res
  --TODO - clean this up, what should filename be instead of "-"
  --       get rid of error
  --       name nicer, mabye merge with next let
  let maybeXabis = parseXabi "-" $ Text.unpack source
  xabis <- either (blocError . UserError . Text.pack) (return . Map.fromList) maybeXabis
  let contracts = Map.intersectionWith (,) xabis abiBins
      details = flip Map.mapWithKey contracts $ \ contrName (xabi,AbiBin{..}) ->
        ContractDetails
        { contractdetailsBin = bin
        , contractdetailsAddress = Just (Named "Latest")
        , contractdetailsBinRuntime = binRuntime
        , contractdetailsCodeHash =  binRuntimeToCodeHash binRuntime
        , contractdetailsName = contrName
        , contractdetailsXabi = xabi
        , contractdetailsChainId = Nothing
        }

  metadataIds <- flip Map.traverseWithKey details $ \ contrName (detail@ContractDetails{..}) -> do
    let
      xcodeHash = keccak256 (Text.encodeUtf8 contractdetailsBin)
    contrId <- createContractQuery contrName
    metadataId <- insertContractMetaDataQuery
      contrId
      contractdetailsBin
      contractdetailsBinRuntime
      contractdetailsCodeHash
      xcodeHash
    insertXabi metadataId contrName contractdetailsXabi
    return (metadataId,detail)

  for_ metadataIds $ \ (leftmetadataId,_) ->
    for_ metadataIds $ \ (rightmetadataId,_) -> blocModify $
      insertContractLookup leftmetadataId rightmetadataId

  return metadataIds
  where
    addFuncsToSource src =
      case addToSource src [addGetSource (formatSrc src), addGetName] of
        Left err -> blocError . UserError .Text.pack $ err
        Right msg' -> return msg'

insertXabiType :: Xabi.Type -> Bloc Int32
insertXabiType = \case
  Xabi.Int signed bytes ->
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Int"::Text)
        , Opaleye.null
        , constant False
        , constant $ fromMaybe False signed
        , constant bytes
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
  Xabi.String dynamic ->
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("String"::Text)
        , Opaleye.null
        , constant $ fromMaybe False dynamic
        , constant False
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
  Xabi.Bytes dynamic bytes ->
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Bytes"::Text)
        , Opaleye.null
        , constant $ fromMaybe False dynamic
        , constant False
        , constant bytes
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
  Xabi.Bool ->
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Bool"::Text)
        , Opaleye.null
        , constant False
        , constant False
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
  Xabi.Address ->
    blocModify1 $ \ conn->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Address"::Text)
        , Opaleye.null
        , constant False
        , constant False
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
  Xabi.Struct bytes typedef ->
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Struct"::Text)
        , constant $ Just typedef
        , constant False
        , constant False
        , constant bytes
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
    -- parentTypeId <- blocModify1 $ \ conn -> do
    --   runInsertManyReturning conn xabiTypesTable [
    --     ( Nothing
    --     , constant ("Struct"::Text)
    --     , constant $ Just typedef
    --     , constant False
    --     , constant False
    --     , constant bytes
    --     , Opaleye.null
    --     , Opaleye.null
    --     , Opaleye.null
    --     , Opaleye.null
    --     )]
    --     (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
    -- void $ blocModify $ \ conn -> do
    --   runInsertMany conn xabiStructFieldsTable
    --     [ ( Nothing
    --       , constant name
    --       , constant atby
    --       , constant parentTypeId
    --       , constant tyid
    --       )
    --     | (name,(atby,tyid)) <- Map.toList fieldsWithIds]
    -- return parentTypeId
  Xabi.Enum bytes typedef _ ->
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Enum"::Text)
        , constant $ Just typedef
        , constant False
        , constant False
        , constant bytes
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
    -- void $ blocModify $ \ conn -> do
    --   runInsertMany conn xabiEnumNamesTable
    --     [ ( Nothing
    --       , constant name
    --       , constant value
    --       , constant tyid
    --       )
    --     | (name,value) <- zip names [(0::Int32)..]]
    -- return tyid
  Xabi.Array entry len -> do
    entryId <- insertXabiType entry
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Array"::Text)
        , Opaleye.null
        , constant $ isNothing len
        , constant False
        , Opaleye.null
        , constant (fmap fromIntegral len :: Maybe Int32)
        , constant $ Just entryId
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
  Xabi.Contract typedef ->
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Contract"::Text)
        , constant $ Just typedef
        , constant False
        , constant False
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
  Xabi.Mapping dynamic key value -> do
    keyId <- insertXabiType key
    valueId <- insertXabiType value
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Mapping"::Text)
        , Opaleye.null
        , constant $ fromMaybe False dynamic
        , constant False
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , constant $ Just valueId
        , constant $ Just keyId
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)
  Xabi.Label name ->
    blocModify1 $ \conn ->
      runInsertManyReturning conn xabiTypesTable [
        ( Nothing
        , constant ("Label"::Text)
        , constant $ Just name
        , constant False
        , constant False
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        , Opaleye.null
        )]
        (\ (xtid,_,_,_,_,_,_,_,_,_) -> xtid)

getXabiType :: HasCallStack =>
               Int32 -> Bloc Xabi.Type
getXabiType typeId = do
  (xtty,xttd,xtdy,xtsi,xtby,xtlen,xtetid,xtvtid,xtktid)
    <- blocQuery1 $ proc () -> do
      (xtid,xtty,xttd,xtdy,xtsi,xtby,xtlen,xtet,xtvt,xtkt)
        <- queryTable xabiTypesTable -< ()
      restrict -< xtid .== constant typeId
      returnA -< (xtty,xttd,xtdy,xtsi,xtby,xtlen,xtet,xtvt,xtkt)
  case xtty::Text of
    "Int" ->
      return $ Xabi.Int (Just xtsi) xtby
    "String" ->
      return $ Xabi.String (Just xtdy)
    "Bytes" ->
      return $ Xabi.Bytes (Just xtdy) xtby
    "Bool" ->
      return Xabi.Bool
    "Address" ->
      return Xabi.Address
    "Struct" -> do
      xttd' <- blocMaybe "Missing typedef in type Struct" xttd
      return $ Xabi.Struct xtby xttd'
    "Enum" -> do
      xttd' <- blocMaybe "Missing typedef in type Enum" xttd
      return $ Xabi.Enum xtby xttd' Nothing
    "Array" -> do
      xtetid' <- blocMaybe "Missing entry type id in type Array" xtetid
      xtet <- getXabiType xtetid'
      return $ Xabi.Array xtet (fmap fromIntegral (xtlen :: Maybe Int32))
    "Contract" -> do
      xttd' <- blocMaybe "Missing typedef in type Struct" xttd
      return $ Xabi.Contract xttd'
    "Mapping" -> do
      xtktid' <- blocMaybe "Missing key type id in type Mapping" xtktid
      xtvtid' <- blocMaybe "Missing value type id in type Mapping" xtvtid
      xtkt <- getXabiType xtktid'
      xtvt <- getXabiType xtvtid'
      return $ Xabi.Mapping (Just xtdy) xtkt xtvt
    "Label" -> do
      xttd' <- blocMaybe "Missing typedef in type Enum" xttd
      return $ Xabi.Label $ Text.unpack xttd'
    _ -> throwError $ DBError "Could not match type"

getXabiStructFields :: Int32 -> Bloc [(Text, Xabi.FieldType)]
getXabiStructFields typeDefId = do
  fieldsWithIds <- blocQuery $ proc () -> do
    (_,name,atbytes,tdid,ftid)
      <- queryTable xabiStructFieldsTable -< ()
    restrict -< tdid .== constant typeDefId
    returnA -< (name,(atbytes,ftid))
  for fieldsWithIds $ \ (name,(atbytes,ftid)) -> do
    ty <- getXabiType ftid
    return (name, Xabi.FieldType atbytes ty)

insertXabiStructFields :: Int32 ->  [(Text, Xabi.FieldType)] -> Bloc Int64
insertXabiStructFields typeDefId fields = do
  fieldsWithIds <- for fields $ \ (name,(Xabi.FieldType atBytes xt)) -> do
    xtid <- insertXabiType xt
    return (name,(atBytes,xtid))
  blocModify $ \ conn ->
    runInsertMany conn xabiStructFieldsTable
      [ ( Nothing
        , constant name
        , constant atBytes
        , constant typeDefId
        , constant xtid
        )
      | (name,(atBytes,xtid)) <- fieldsWithIds
      ]

getXabiEnumNames :: Int32 -> Bloc [Text]
getXabiEnumNames typeDefId = blocQuery $ proc () -> do
  (_,name,_,tdid) <-
    orderBy (asc (\ (_,_,value,_) -> value))
      (queryTable xabiEnumNamesTable) -< ()
  restrict -< tdid .== constant typeDefId
  returnA -< name

insertXabiEnumNames :: Int32 -> [Text] -> Bloc Int64
insertXabiEnumNames typeDefId names = blocModify $ \ conn ->
  runInsertMany conn xabiEnumNamesTable
    [ ( Nothing
      , constant name
      , constant value
      , constant typeDefId
      )
    | (name,value) <- zip names [0::Int32 ..]
    ]

getXabiTypeDefs :: Int32 -> Bloc (Map Text Xabi.Def.Def)
getXabiTypeDefs metadataId = do
  typedefsWithIds <- fmap Map.fromList . blocQuery $ proc () -> do
    (tdid,name,cmid,ty,by) <- queryTable xabiTypeDefsTable -< ()
    restrict -< cmid .== constant metadataId
    returnA -< (name,(tdid,ty,by))
  for typedefsWithIds $ \ (tdid,ty,by::Int32) -> case ty of
      "Struct" -> do
        fields <- getXabiStructFields tdid
        return $ Xabi.Def.Struct fields (fromIntegral by)
      "Enum" -> do
        names <- getXabiEnumNames tdid
        return $ Xabi.Def.Enum names (fromIntegral by)
      "Contract" ->
        return $ Xabi.Def.Contract $ fromIntegral by
      _ -> throwError $ DBError $
        "Invalid type def. Expected Struct or Enum, saw " <> ty

insertXabiTypeDefs :: Int32 -> Map Text Xabi.Def.Def -> Bloc ()
insertXabiTypeDefs metadataId typeDefs = do
  typeDefIds <- fmap Map.fromList . blocModify $ \ conn -> do
    let
      tyOf :: Xabi.Def.Def -> Text
      tyOf = \case
        Xabi.Def.Enum _ _ -> "Enum"
        Xabi.Def.Struct _ _ -> "Struct"
        Xabi.Def.Contract _ -> "Contract"
      byOf :: Xabi.Def.Def -> Int32
      byOf = fromIntegral . Xabi.Def.bytes
    runInsertManyReturning conn xabiTypeDefsTable
      [ ( Nothing
        , constant name
        , constant metadataId
        , constant (tyOf enumOrStruct)
        , constant (byOf enumOrStruct)
        )
      | (name,enumOrStruct) <- Map.toList typeDefs
      ]
      (\ (tdId,name,_,_,_) -> (name,tdId))
  for_ (Map.intersectionWith (,) typeDefs typeDefIds) $ \case
    (Xabi.Def.Struct fields _, tdId) -> insertXabiStructFields tdId fields
    (Xabi.Def.Enum names _, tdId) -> insertXabiEnumNames tdId names
    (Xabi.Def.Contract _, _) -> return 0

getContractXabiByMetadataId :: HasCallStack => Int32 -> Bloc Xabi
getContractXabiByMetadataId metadataId = do
  funcs <- getXabiFunctionsQuery metadataId
  constr <- getXabiConstrQuery metadataId
  vars <- getXabiVariablesQuery metadataId
  typeDefs <- getXabiTypeDefs metadataId
  -- TODO: Add modifiers table and pull modifiers from there
  return xabiEmpty{ xabiFuncs = funcs
                  , xabiConstr = constr
                  , xabiVars = vars
                  , xabiTypes = typeDefs
                  }

getContractContractByMetadataId :: HasCallStack => Int32 -> Bloc Contract
getContractContractByMetadataId metadataId = getContractRetry 0
  where
  -- Impatient clients may have submitted a contract and immediately issued
  -- a function call against it. Here we give a basic defense against it.
  -- A much nicer way to handle that is to return cookies to the client
  -- after writes, and use that cookie on subsequent calls to block until
  -- their write will be visible.
  -- In the case of a true failure, the total sleep is (2^10 - 1)* 5ms = 5s
      sleep t = liftIO . threadDelay . (1000*) $ t
      getContractRetry :: Int -> Bloc Contract
      getContractRetry t = do
        x <- getContractXabiByMetadataId metadataId
        case xAbiToContract x of
          Right c -> return c
          Left err ->
            if t < 5000
              then sleep t >> getContractRetry (1 + 2 * t)
              else throwError . UserError $
                    "getContractContractByMetadataId: invalid types in contract: " <> (Text.pack . show $ err)

getContractXabi :: HasCallStack =>
                   ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc Xabi
getContractXabi (ContractName contractName) contractId chainId = do
  -- metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
  metadataId <- case contractId of
    Named _ -> blocQuery1 $ getContractsMetaDataId contractName contractId chainId
    Unnamed contractAddr -> getContractsMetaDataIdExhaustive contractName contractAddr chainId
  getContractXabiByMetadataId metadataId

getContractXabiAndMetadataId :: HasCallStack =>
                   ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc (Int32, Xabi)
getContractXabiAndMetadataId (ContractName contractName) contractId chainId = do
  -- metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
  metadataId <- case contractId of
    Named _ -> blocQuery1 $ getContractsMetaDataId contractName contractId chainId
    Unnamed contractAddr -> getContractsMetaDataIdExhaustive contractName contractAddr chainId
  xabi <- getContractXabiByMetadataId metadataId
  return (metadataId, xabi)

getContractMetadataAndBin :: Text -> Bloc (Int32, ByteString)
getContractMetadataAndBin contract = blocTransaction $ do
  cmIds_bins <- blocQuery $ proc () -> do
    (cmId,name,bin) <- joinF
      (\ (cmId,_,bin,_,_,_) (_,name) -> (cmId,name,bin))
      (\ (_,contractId,_,_,_,_) (cid,_) -> cid .== contractId)
      (queryTable contractsMetaDataTable)
      (queryTable contractsTable) -< ()
    restrict -< name .== constant contract
    returnA -< (cmId,bin)
  blocMaybe
    "No contract metadata id found. Likely, contract did not compile successfully"
    (listToMaybe cmIds_bins)

getConstructorId :: Int32 -> Bloc (Maybe Int32)
getConstructorId cmId = do
  functionIds <- blocQuery $ proc () -> do
    (xfId,contractMetaDataId,isConstr,_,_)
      <- queryTable xabiFunctionsTable -< ()
    restrict -< contractMetaDataId .== constant cmId .&& isConstr
    returnA -< xfId
  return $ listToMaybe functionIds

getFunctionId :: Int32 -> Text -> Bloc Int32
getFunctionId cmId funcName = blocQuery1 $ proc () -> do
  (xfId,contractMetaDataId,isConstr,name,_)
    <- queryTable xabiFunctionsTable -< ()
  restrict -< contractMetaDataId .== constant cmId
    .&& name .== constant funcName
    .&& Opaleye.not isConstr
  returnA -< xfId

getEnumValues :: Int32 -> Text -> Bloc [(Text,Int)]
getEnumValues cmId enumName = blocQuery $
  orderBy (asc snd) $ proc () -> do
    (name,enumValue,enumIndex,contractMetaDataId,ty) <- joinTable -< ()
    restrict -< contractMetaDataId .== constant cmId
      .&& name .== constant enumName
      .&& ty .== constant ("Enum" :: Text)
    returnA -< (enumValue,enumIndex)
  where
    joinTable = joinF
      (\ (_,name,contractMetaDataId,ty,_) (_,enumValue,enumIndex,_) -> (name,enumValue,enumIndex,contractMetaDataId,ty))
      (\ (tdId,_,_,_,_) (_,_,_,typedefId) -> tdId .== typedefId)
      (queryTable xabiTypeDefsTable)
      (queryTable xabiEnumNamesTable)
