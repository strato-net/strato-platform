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

module BlockApps.Bloc22.Database.Queries (
  getContractDetailsByMetadataId,
  getContractXabiByMetadataId,
  contractByTxHash,
  getContractXabi,
  getContractDetailsAndMetadataId,
  sourceToContractDetails,
  getContractsAddressesQuery,
  getContractDetails,
  getContractsDataAddressesQuery,
  getContractDetailsForContract,
  getContractDetailsByCodeHash,
  insertContractInstance,
  deserializeXabi,
  getContractsContractLatestQuery,
  getContractsContractByAddressQuery,
  evmContractSolidVMError
  ) where

import           Control.Arrow
import           Control.Monad
import           Control.Monad.Logger
import qualified Crypto.Saltine.Class            as Saltine
import qualified Crypto.Saltine.Core.SecretBox   as SecretBox
import           Data.Aeson                      (Result(..), fromJSON, decode, encode)
import           Data.ByteString                 (ByteString)
import qualified Data.ByteString                 as B
import           Data.ByteString.Lazy            (fromStrict, toStrict)
import qualified Data.Cache                      as Cache
import           Data.Either                     (fromRight)
import           Data.Foldable                   (for_)
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
import           GHC.Stack
import           Opaleye                         hiding (not, null, index)
import           System.Clock
import           Text.Format
import           UnliftIO

import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Database.Solc
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.SolidityVarReader     (byteStringToWord256, word256ToByteString)
import           BlockApps.Solidity.Parse.Parser
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types hiding (Account(..))
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Data.Source.Map

import           Control.Monad.Composable.BlocSQL
import           SQLM

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

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

contractByAccount
  :: Account
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
contractByAccount (Account contractAddress chainId) = proc () -> do
  contract@(_,_,_,addr,_,_,_,_,_,cid,_) <- contractsJoinTable -< ()
  restrict -< addr .== constant contractAddress
  restrict -< cid .== constant (ChainId <$> chainId)
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

contractByTxHash :: Keccak256 -> Query (Column PGInt4, Column PGInt4, Column PGText)
contractByTxHash txHash = limit 1 $ proc () -> do
  (_,tx_hash,cmId,ttype,name) <- queryTable hashNameTable -< ()
  restrict -< tx_hash .== constant txHash
  returnA -< (cmId,ttype,name)

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
getContractsAddressesQuery :: Int -> Int -> Maybe ChainId -> Query
  ( Column PGText
  , Column PGBytea
  , Column PGTimestamptz
  , Column PGBytea
  )
getContractsAddressesQuery o l chainId = limit l . offset o $ proc () -> do
  (_,name,_,addr,timestamp,_,_,_,_,cid,_) <- contractsJoinTable -< ()
  restrict -< cid .== constant chainId
  returnA -< (name,addr,timestamp,cid)

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
  :: Account
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
getContractsContractByAddressQuery contractAcct =
  limit 1 $ proc () -> do
    (cmId,name,src,_,_,bin,binRuntime,codeHash,xcodeHash,_,xabi) <-
      contractByAccount contractAcct -< ()
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

deserializeXabi :: MonadIO m => ByteString -> m Xabi
deserializeXabi = decodeXabiJSON

decodeXabiJSON :: MonadIO m => ByteString -> m Xabi
decodeXabiJSON xabi' = case decode (fromStrict xabi') of
  Nothing -> throwIO $ DBError "Corrupted Xabi stored in database"
  Just x -> return x

getContractDetailsByMetadataId :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                                  Int32 -> Account -> m ContractDetails
getContractDetailsByMetadataId cmId acct = do
  (bin,binRuntime,codeHash,_ :: ByteString,_ :: Keccak256,name,src,_ :: Int32,xabi') <-
    blocQuery1 "getContractDetailsByMetadataId" $ contractByMetadataId cmId
  xabi <- deserializeXabi xabi'
  return ContractDetails
    { contractdetailsBin = Text.decodeUtf8 bin
    , contractdetailsAccount = Just acct
    , contractdetailsBinRuntime = Text.decodeUtf8 binRuntime
    , contractdetailsCodeHash = codeHash
    , contractdetailsName = name
    , contractdetailsSrc = deserializeSourceMap src
    , contractdetailsXabi = xabi
    }

getContractDetails :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                      Account -> m (Maybe ContractDetails)
getContractDetails = fmap (fmap snd) . getContractDetailsAndMetadataId

getContractDetailsAndMetadataId :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                                   Account -> m (Maybe (Int32, ContractDetails))
getContractDetailsAndMetadataId acct = do
    let
      detailsWith detailsAcct (bin,binRuntime,codeHash,_ :: ByteString,name,src,cmId,xabi') = do
        xabi <- deserializeXabi xabi'
        return (cmId, ContractDetails
          { contractdetailsBin = Text.decodeUtf8 bin
          , contractdetailsAccount = detailsAcct
          , contractdetailsBinRuntime = Text.decodeUtf8 binRuntime
          , contractdetailsCodeHash = codeHash
          , contractdetailsName = name
          , contractdetailsSrc = deserializeSourceMap src
          , contractdetailsXabi = xabi
          })
    tuple <- fmap listToMaybe . blocQuery $
      getContractsContractByAddressQuery acct
    case tuple of
      Just t -> Just <$> detailsWith (Just acct) t
      Nothing -> throwIO $ UserError $ Text.pack $ "Contract " ++ show acct ++ " doesn't exist"

getContractDetailsByCodeHash :: (MonadIO m, MonadLogger m, HasBlocSQL m, HasBlocEnv m) =>
                                CodePtr -> m (Maybe (Int32, ContractDetails))
getContractDetailsByCodeHash codePtr = do
  srcCache <- fmap globalCodePtrCache getBlocEnv
  now <- liftIO $ getTime Monotonic
  let later = (now +) <$> Cache.defaultExpiration srcCache
  mCachedDetails <- atomically $ do
    Cache.purgeExpiredSTM srcCache now -- todo: this should probably go somewhere else, like a worker thread,
                                       --       but we need this to prevent the cache growing unboundedly
    r <- Cache.lookupSTM True codePtr srcCache now
    for_ r $ \v -> Cache.insertSTM codePtr v srcCache later -- refresh to timestamp of this item
    pure r

  case mCachedDetails of
    Just cachedDetails -> pure $ Just cachedDetails
    Nothing -> do
      mIdAndDetails <- case codePtr of
        CodeAtAccount acct _ -> getContractDetailsAndMetadataId acct
        codeHash -> do
          mDetails <- fmap listToMaybe . blocQuery $ getContractsContractByCodeHashQuery codeHash
          for mDetails $ \(bin,binr,ch,_ :: ByteString,_ :: ByteString,name,src,cmId,xabi') -> do
            xabi <- deserializeXabi xabi'
            return (cmId, ContractDetails
              { contractdetailsBin = Text.decodeUtf8 bin
              , contractdetailsAccount = Nothing
              , contractdetailsBinRuntime = Text.decodeUtf8 binr
              , contractdetailsCodeHash = ch
              , contractdetailsName = name
              , contractdetailsSrc = deserializeSourceMap src
              , contractdetailsXabi = xabi
              })
      liftIO . for_ mIdAndDetails $ Cache.insert srcCache codePtr
      pure mIdAndDetails

createContractBatchQuery :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                            [Text] -> m (Map Text Int32)
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
  :: (MonadLogger m, HasBlocSQL m)
  => SourceMap
  -> m (Int32, Keccak256)
insertContractSourceQuery src' = do
  let src = serializeSourceMap src'
      srcHash = (hash $ Text.encodeUtf8 src)
  blocModify1 $ \ conn ->
    runInsertManyReturning conn contractsSourceTable [
      ( Nothing
      , constant srcHash
      , constant src
      )]
      (\ (csId,sh,_) -> (csId,sh))

insertContractMetaDataBatchQuery
  :: (MonadLogger m, HasBlocSQL m) =>
     Keccak256
  -> [(Int32, ContractDetails)]
  -> m (Map Int32 Int32)
insertContractMetaDataBatchQuery srcHash details = blocModify $ \ conn ->
  let inserts = flip map details $ \(contractId, ContractDetails{..}) ->
        ( Nothing
        , constant contractId
        , constant (Text.encodeUtf8 contractdetailsBin)
        , constant (Text.encodeUtf8 contractdetailsBinRuntime)
        , constant contractdetailsCodeHash
        , constant $ hash (Text.encodeUtf8 contractdetailsBin)
        , constant srcHash
        , constant (serializeXabi contractdetailsXabi)
        )
   in Map.fromList <$> runInsertManyReturning conn contractsMetaDataTable inserts
        (\(contractmetadataId,cId,_,_,_,_,_,_) -> (cId,contractmetadataId))

instance QueryRunnerColumnDefault PGBytea Address where
  queryRunnerColumnDefault = queryRunnerColumn id
    (Address . bytesToWord160 . B.unpack)
    queryRunnerColumnDefault
instance Default Constant Address (Column PGBytea) where
  def = lmap getBytes def
    where
      getBytes (Address x) = B.pack . word160ToBytes $ x

instance QueryRunnerColumnDefault PGBytea SecretBox.Nonce where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode nonce") . Saltine.decode)
    queryRunnerColumnDefault
instance Default Constant SecretBox.Nonce (Column PGBytea) where
  def = lmap Saltine.encode def
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
        = unsafeCreateKeccak256FromByteString

instance Default Constant Keccak256 (Column PGBytea) where
  def = lmap keccak256ToByteString def

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
        = if B.null bs
            then Nothing
            else Just
               . ChainId
               . byteStringToWord256
               $ bs

instance Default Constant (Maybe ChainId) (Column PGBytea) where
  def = lmap fromChainId def
        where fromChainId = \case
                Nothing -> B.empty
                Just cid -> word256ToByteString $ unChainId cid

insertContractInstance :: (HasBlocSQL m, MonadLogger m) =>
                          Int32 -> Account -> m Int32
insertContractInstance cmId (Account address chainId) = blocModify1 $ \conn -> runInsertManyReturning conn contractsInstanceTable
  [
  ( Nothing
  , constant cmId
  , constant address
  , Nothing
  , constant (ChainId <$> chainId)
  )
  ]
  (\ (contractInstanceId,_,_,_,_) -> contractInstanceId)

evmContractSolidVMError :: Text
evmContractSolidVMError = Text.concat
  [ "Upload Contract (EVM): The given contracts were previously uploaded for "
  , "SolidVM. Please retry your request specifying SolidVM as the VM type. "
  , "If you are intending to use EVM, please modify your contracts and try again."
  ]

getContractDetailsForContract :: (MonadIO m, MonadLogger m,
                                  HasBlocSQL m, HasBlocEnv m) =>
                                 Text -> SourceMap -> Maybe Text -> m (Maybe (Text, (Int32, ContractDetails)))
getContractDetailsForContract theVM src mContract = do
  let shouldCompile = if theVM == "EVM" then Do Compile else Don't Compile
      cacheKey = (theVM, src)
  srcCache <- fmap globalSourceCache getBlocEnv
  now <- liftIO $ getTime Monotonic
  let later = (now +) <$> Cache.defaultExpiration srcCache
  mCachedDetails <- atomically $ do
    Cache.purgeExpiredSTM srcCache now -- todo: this should probably go somewhere else, like a worker thread,
                                       --       but we need this to prevent the cache growing unboundedly
    r <- Cache.lookupSTM True cacheKey srcCache now
    for_ r $ \v -> Cache.insertSTM cacheKey v srcCache later -- refresh to timestamp of this item
    pure r

  idsAndDetails <- case mCachedDetails of
    Just cachedDetails -> pure cachedDetails
    Nothing -> do
      details <- if hasAnyNonEmptySources src
                   then sourceToContractDetails shouldCompile src
                   else return Map.empty
      liftIO $ Cache.insert srcCache cacheKey details
      pure details
  case mContract of
    Nothing ->
      case Map.toList idsAndDetails of
        [] -> pure Nothing
        [x] -> Just <$> checkCodeHash x
        _ -> throwIO $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
    Just contract -> do
      x <- let srcStr = serializeSourceMap src
            in blocMaybe ("Could not find global contract metadataId for " <> contract <> " in source " <> srcStr)  (Map.lookup contract idsAndDetails)
      Just <$> checkCodeHash (contract, x)
  where checkCodeHash x@(_,(_,cd)) = case contractdetailsCodeHash cd of
          (EVMCode _) -> pure x
          (SolidVMCode _ _) -> case theVM of
            "EVM" -> throwIO $ UserError evmContractSolidVMError
            _ -> pure x
          (CodeAtAccount acct name) -> do
            mCmIdDetails <- getContractDetailsAndMetadataId acct
            case mCmIdDetails of
              Nothing -> throwIO . UserError . Text.pack $ "Could not find contract details for " ++ name ++ " at address " ++ format acct
              Just cmIdDetails -> pure (Text.pack name, cmIdDetails)
 


sourceToContractDetails :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                           Should Compile -> SourceMap -> m (Map Text (Int32, ContractDetails))
sourceToContractDetails shouldCompile sourceList = do
  let source = serializeSourceMap sourceList
      createContractDetails =
        case shouldCompile of
          Do Compile -> compileContract
          Don't Compile -> createMetadataNoCompile
  details <- blocQuery . contractBySourceHash . hash $ Text.encodeUtf8 source
  if null details
    then createContractDetails sourceList
    else fmap Map.fromList . forM details $
      \(bin,binr,ch,_ :: ByteString,_ :: ByteString,name,src,cmId,xabi') -> do
        xabi <- deserializeXabi xabi'
        return (name,(cmId, ContractDetails
          { contractdetailsBin = Text.decodeUtf8 bin
          , contractdetailsAccount = Nothing
          , contractdetailsBinRuntime = Text.decodeUtf8 binr
          , contractdetailsCodeHash = ch
          , contractdetailsName = name
          , contractdetailsSrc = deserializeSourceMap src
          , contractdetailsXabi = xabi
          }))

compileContract :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                   SourceMap -> m (Map Text (Int32, ContractDetails))
compileContract sourceList = do
  let source = sourceBlob sourceList
      eVerXabis = parseXabi "-" $ Text.unpack source
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
        , contractdetailsAccount = Nothing
        , contractdetailsBinRuntime = binRuntime
        , contractdetailsCodeHash =  EVMCode $ binRuntimeToCodeHash binRuntime
        , contractdetailsName = contrName
        , contractdetailsSrc = sourceList
        , contractdetailsXabi = xabi
        }

  (_,srcHash) <- insertContractSourceQuery sourceList
  contractIdMap <- createContractBatchQuery $ Map.keys details
  let idDetails = Map.elems $ Map.intersectionWith (,) contractIdMap details
  mdIdMap <- insertContractMetaDataBatchQuery srcHash idDetails
  let cmIdDetails = Map.elems . Map.intersectionWith (,) mdIdMap $ Map.fromList idDetails
  return . Map.fromList $ map ((contractdetailsName . snd) &&& id) cmIdDetails

-- SolidVM only
createMetadataNoCompile :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                           SourceMap -> m (Map Text (Int32, ContractDetails))
createMetadataNoCompile sourceList = do
  let source = sourceBlob sourceList
      encodedSrc = serializeSourceMap sourceList
      eVerXabis = parseXabi "-" $ Text.unpack source
  xabis <- case eVerXabis of
    Left err -> blocError . UserError . Text.pack $ err
    Right (_, xs) -> return $ Map.fromList xs
  let contracts = xabis
      details = flip Map.mapWithKey contracts $ \ contrName (xabi) ->
        ContractDetails
        { contractdetailsBin = source
        , contractdetailsAccount = Nothing
        , contractdetailsBinRuntime = contrName `Text.append` source
        , contractdetailsCodeHash = SolidVMCode (Text.unpack contrName) $ hash (Text.encodeUtf8 encodedSrc)
        , contractdetailsName = contrName
        , contractdetailsSrc = sourceList
        , contractdetailsXabi = xabi
        }

  (_,srcHash) <- insertContractSourceQuery sourceList
  contractIdMap <- createContractBatchQuery $ Map.keys details

  let idDetails = Map.elems $ Map.intersectionWith (,) contractIdMap details
  mdIdMap <- insertContractMetaDataBatchQuery srcHash idDetails
  let cmIdDetails = Map.elems . Map.intersectionWith (,) mdIdMap $ Map.fromList idDetails
  return . Map.fromList $ map ((contractdetailsName . snd) &&& id) cmIdDetails

getContractXabiByMetadataId :: (MonadIO m, MonadLogger m,
                                HasBlocSQL m, HasCallStack) =>
                               Int32 -> m Xabi
getContractXabiByMetadataId cmId = do
  xabi' <- blocQuery1 "getContractXabiByMetadataId" . fmap ninth $ contractByMetadataId cmId
  deserializeXabi xabi'
  where ninth (_,_,_,_,_,_,_,_,x) = x

getContractXabi :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                   Account -> m (Maybe Xabi)
getContractXabi =
  fmap (fmap contractdetailsXabi) . getContractDetails
