{-# LANGUAGE Arrows              #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE Rank2Types          #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Users (
  TRD(..),

  getBatchBlocTransactionResult',
  constructArgValuesAndSource,
  TransactionHeader(..),
  genNonces,
  constructArgValues,
  forStateT,
  getAccountTxParams,
  
  getBlocTransactionResult,
  getBlocTransactionResult',
  postBlocTransactionResults
--  postUsersContractMethodList'
  ) where

import           ClassyPrelude                     ((<>), Hashable)
import           Control.Concurrent
import           Control.Applicative               ((<|>), liftA2)
import           Control.Arrow
import           Control.Lens                      hiding (from, ix)
import           Control.Monad
import           Control.Monad.Except
import           Control.Monad.Extra
import           Control.Monad.Reader
import           Control.Monad.Trans.State.Lazy
import qualified Data.Aeson                        as Aeson
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Lazy              as BL
import qualified Data.ByteString.Base16            as Base16
import           Data.ByteString.Short             (fromShort)
import qualified Data.Cache                        as Cache
import qualified Data.Cache.Internal               as Cache
import           Data.Either
import           Data.Foldable
import           Data.Int                          (Int32)
import           Data.List                         (partition, sortOn)
import           Data.Map.Strict                   (Map)
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.Semigroup                    (Max(..))
import           Data.Set                          (isSubsetOf)
import qualified Data.Set                          as S
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Traversable
import           System.Clock
import           UnliftIO

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Logging
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract()
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Storage
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Type      as Xabi
import           BlockApps.SolidityVarReader
import           BlockApps.XAbiConverter
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Wei
import           Handlers.AccountInfo

data TransactionHeader = TransactionHeader
  { transactionheaderToAddr   :: Maybe Address
  , transactionheaderFromAddr :: Address
  , transactionheaderTxParams :: TxParams
  , transactionheaderValue    :: Wei
  , transactionheaderCode     :: ByteString
  , transactionheaderChainId  :: Maybe ChainId
  }

data TRD = TRD -- transaction resolution data
  { trdStatus :: BlocTransactionStatus
  , trdHash   :: Keccak256
  , trdIndex  :: Integer
  , trdResult :: Maybe TransactionResult
  }

data BatchState = BatchState
  { _contractDetailsMap :: Map.Map ContractName ContractDetails
  , _functionXabiMap    :: Map.Map Int32 Xabi
  }
makeLenses ''BatchState

forStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m [b]
forStateT s as = flip evalStateT s . for as



cacheLookup :: (Eq k, Hashable k)
            => Cache.Cache k v
            -> TimeSpec
            -> k
            -> STM (Maybe v)
cacheLookup c t k = Cache.lookupSTM True k c t

genNonces :: Show a
          => Should CacheNonce
          -> Address
          -> Lens' a (Maybe ChainId)
          -> Lens' a (Maybe TxParams)
          -> [a]
          -> Bloc [a]
genNonces cacheNonce fromAddr chainLens l unindexedAs = do
  let getChainId = view chainLens
      chainIdsList = S.toList . S.fromList $ getChainId <$> unindexedAs
      cacheKeys = (fromAddr,) <$> chainIdsList
      viewNonce = txparamsNonce <=< view l
  let indexedByChainId = indexedPartitionWith getChainId unindexedAs
  nonceCache <- asks globalNonceCounter
  now <- liftIO $ getTime Monotonic
  let lookupCached = case cacheNonce of
        Do CacheNonce -> atomically (traverse (cacheLookup nonceCache now) cacheKeys)
        Don't CacheNonce -> pure $ repeat Nothing
  chainNonceVals <- zip chainIdsList <$> lookupCached
  let ~(chainsWithNonces, chainsWithoutNonces) = partition (isJust . snd) chainNonceVals
      cachedNonceMap = Map.fromList $ fmap fromJust <$> chainsWithNonces
  fetchedNonceMap <- getAccountNonce fromAddr . S.fromList $ fst <$> chainsWithoutNonces
  let nonceMap = Map.union cachedNonceMap fetchedNonceMap
  liftIO . atomically $ fmap mergePartitions . forM indexedByChainId $ \(chainId, indexedAs) -> do
    let noncesInUse = S.fromList $ mapMaybe (viewNonce . snd) indexedAs
    now' <- Cache.nowSTM
    nonce <- if S.size noncesInUse == length indexedAs
               then pure . Nonce . error $
                      "internal error: unused nonce when already specified " ++ show indexedAs
               else do
                 mmNonce <- cacheLookup nonceCache now' (fromAddr, chainId)
                 let mNonce = case cacheNonce of
                       Do CacheNonce -> mmNonce
                       Don't CacheNonce -> Nothing
                     sNonce = Map.lookup chainId nonceMap
                 pure . fromMaybe 0 $ liftA2 max mNonce sNonce <|> mNonce <|> sNonce
    let txs = runIdentity . forStateT nonce indexedAs $ \(i,a) -> do
                let params' = fromMaybe emptyTxParams (a ^. l)
                newNonce <- case txparamsNonce params' of
                  Just v -> return v
                  Nothing -> do
                    whileM $ do
                      inUse <- gets (`S.member` noncesInUse)
                      when inUse $ id += 1
                      return inUse
                    id <<+= 1
                return (i, (l .~ Just params'{txparamsNonce = Just newNonce}) a)
        newCachedNonce = 1 + getMax (foldMap (Max . fromMaybe 0 . viewNonce . snd) txs)
        expTime = (now' +) <$> Cache.defaultExpiration nonceCache
    Cache.insertSTM (fromAddr, chainId) newCachedNonce nonceCache expTime
    pure (chainId, txs)




emptyBatchState :: BatchState
emptyBatchState = BatchState Map.empty Map.empty

-- getBlocTransactionResult' will return only one of the results
-- when multiple hashes are provided. This is a glass-half-full
-- function, and if one TX succeeds then the result is a success.
getBlocTransactionResult' :: [Keccak256] -> Bool -> Bloc BlocTransactionResult
getBlocTransactionResult' [] _ = throwIO $ AnError "getBlockTransactionResult': no TX hashes"
getBlocTransactionResult' hashes@(txh:_) resolve =
  if resolve
    then do
      promises <- forM hashes $ \h -> async (getBlocTransactionResult h True)
      results <- mapM wait promises
      $logDebugLS "getBlockTransactionResult'/results" results
      case filter ((== Success) . blocTransactionStatus) results of
        (winner:_) -> return winner
        [] -> return $ head results
    else return $ BlocTransactionResult Pending txh Nothing Nothing

getBlocTransactionResult :: Keccak256 -> Bool -> Bloc BlocTransactionResult
getBlocTransactionResult txHash resolve = fmap head $ postBlocTransactionResults resolve [txHash]

getBatchBlocTransactionResult' :: [Keccak256] -> Bool -> Bloc [BlocTransactionResult]
getBatchBlocTransactionResult' hashes resolve =
  if resolve
    then postBlocTransactionResults True hashes
    else return $ map (\h -> BlocTransactionResult Pending h Nothing Nothing) hashes

postBlocTransactionResults :: Bool -> [Keccak256] -> Bloc [BlocTransactionResult]
postBlocTransactionResults resolve hashes = recurseTRDs resolve hashes >>= evalAndReturn

recurseTRDs :: Bool
            -> [Keccak256]
            -> Bloc [TRD]
recurseTRDs resolve hashes = go 0 (toPending hashes)
  where
    go :: Int -> [TRD] -> Bloc [TRD]
    go num list = do
      let his = map (trdHash &&& trdIndex) list
      statusAndMtxrs <- flip zip his <$> getBatchBlocTxStatus (map fst his)
      let (pending', done) = partitionEithers $
                      flip map statusAndMtxrs
                        (\((s,r),(h,i)) ->
                          if s == Pending
                            then Left $ TRD s h i r
                            else Right $ TRD s h i r)
      pending <- if not resolve || null pending'
        then return pending'
        else
          if num >= 600
            then return pending'
            else do
              $logDebugLS "recurseTRDs/pending'" $ map trdHash pending'
              void . liftIO $ threadDelay 100000
              go (num + 1) pending'
      return $ merge pending done (\(TRD _ _ i _) (TRD _ _ j _) -> i < j)

    toPending :: [Keccak256] -> [TRD]
    toPending = zipWith (\i h -> TRD Pending h i Nothing) [0..]

    merge :: [a] -> [a] -> (a -> a -> Bool) -> [a]
    merge [] ps _ = ps
    merge ds [] _ = ds
    merge (d:ds) (p:ps) c =
      if c d p
        then (d : merge ds (p:ps) c)
        else (p : merge (d:ds) ps c)

evalAndReturn :: [TRD] -> Bloc [BlocTransactionResult]
evalAndReturn list = forStateT emptyBatchState list $
    \(TRD status txHash _ mtxr) -> case status of
        Pending -> return $ BlocTransactionResult Pending txHash Nothing Nothing
        Failure -> return $ BlocTransactionResult Failure txHash mtxr Nothing
        Success -> do
          (cmId,ttype,tdata)::(Int32,Int32,Text) <- lift $ blocQuery1 "evalAndReturn" $ contractByTxHash txHash
          case ttype of
            0 -> return $ BlocTransactionResult Success txHash mtxr (Just . Send . fromJust . Aeson.decode . BL.fromStrict $ Text.encodeUtf8 tdata)
            1 -> contractResult txHash mtxr cmId tdata
            2 -> functionResult txHash mtxr cmId tdata
            _ -> throwIO $ InternalError $ Text.pack $ "Unexpected transaction type: got" ++ show ttype

contractResult :: Keccak256
               -> Maybe TransactionResult
               -> Int32
               -> Text
               -> StateT BatchState Bloc BlocTransactionResult
contractResult txHash mtxr cmId name = do
  let
    Just txResult = mtxr
    chainId = transactionResultChainId txResult
    addressMaybe = do
      str <- listToMaybe $
        Text.splitOn "," (Text.pack $ transactionResultContractsCreated txResult)
      stringAddress $ Text.unpack str
  case addressMaybe of
    Nothing -> case transactionResultMessage txResult of
      "Success!" -> do
        let mDelAddr = stringAddress . Text.unpack =<<
              (listToMaybe . Text.splitOn "," . Text.pack $ transactionResultContractsDeleted txResult)
        case mDelAddr of
          Just _ -> lift $ throwIO $ UserError "Contract failed to upload, likely because the constructor threw"
          Nothing -> lift $ throwIO $ UserError "Transaction succeeded, but contract was neither created, nor destroyed"
      stratoMsg  -> lift $ throwIO $ UserError $ Text.pack stratoMsg
    Just addr' -> do
      let cn = ContractName name
      mdetails <- use $ contractDetailsMap . at cn
      details <- case mdetails of
        Just details' -> return details'{contractdetailsAddress = Just addr'}
        Nothing -> do
          cds <- lift $ getContractDetailsByMetadataId cmId addr' (ChainId <$> chainId)
          contractDetailsMap . at cn <?= cds
      return $ BlocTransactionResult Success txHash mtxr (Just $ Upload details)

functionResult :: Keccak256
               -> Maybe TransactionResult
               -> Int32
               -> Text
               -> StateT BatchState Bloc BlocTransactionResult
functionResult txHash mtxr cmId funcName = do
  let Just txResult = mtxr
  mxabi <- use $ functionXabiMap . at cmId
  xabi <- case mxabi of
    Just xabi' -> return xabi'
    Nothing -> do
      xabi' <- lift $ getContractXabiByMetadataId cmId
      functionXabiMap . at cmId <?= xabi'
  let resultXabiTypes = maybe [] (Map.elems . funcVals) . Map.lookup funcName $ xabiFuncs xabi
      orderedResultIndexedXT = sortOn Xabi.indexedTypeIndex resultXabiTypes
  orderedResultTypes <- lift $
    for orderedResultIndexedXT $ \Xabi.IndexedType{..} ->
      either (throwIO . UserError . Text.pack) return $
        xabiTypeToType xabi indexedTypeType
  let mappedResultTypes = map convertEnumTypeToInt orderedResultTypes
      txResp = fromShort $ transactionResultResponse txResult
    -- TODO::(map convertEnumTypeToInt orderedResultTypes) is currenlty a
    -- workaround for enums
      mFormattedResponse = convertResultResToVals txResp mappedResultTypes
  case transactionResultMessage txResult of
    "Success!" -> do
      let r = Text.decodeUtf8 $ Base16.encode txResp
      formattedResponse <- lift $ blocMaybe ("Failed to parse response: " <> r) mFormattedResponse
      return $ BlocTransactionResult Success txHash mtxr (Just $ Call formattedResponse)
    stratoMsg  -> throwIO $ UserError $ Text.pack stratoMsg

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType $ TypeInt False $ Just 32
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty

convertResultResToVals :: ByteString -> [Type] -> Maybe [SolidityValue]
convertResultResToVals byteResp responseTypes =
  map valueToSolidityValue <$> bytestringToValues byteResp responseTypes

getArgValues :: Map Text ArgValue -> Map Text Xabi.IndexedType -> Bloc [Value]
getArgValues argsMap argNamesTypes = do
    let
      determineValue :: ArgValue -> Xabi.IndexedType -> Bloc (Int32, Value)
      determineValue argVal (Xabi.IndexedType ix xabiType) =
        let
          typeM = case xabiType of
            Xabi.Int (Just True) b -> Right . SimpleType . TypeInt True $ fmap toInteger b
            Xabi.Int _           b -> Right . SimpleType . TypeInt False $ fmap toInteger b
            Xabi.String _          -> Right . SimpleType $ TypeString
            Xabi.Bytes _ b         -> Right . SimpleType . TypeBytes $ fmap toInteger b
            Xabi.Bool              -> Right . SimpleType $ TypeBool
            Xabi.Address           -> Right . SimpleType $ TypeAddress
            Xabi.Struct _ name     -> Right $ TypeStruct name
            Xabi.Enum _ name _     -> Right $ TypeEnum name
            Xabi.Array ety len ->
              let
                ettyty = case ety of
                  Xabi.Int (Just True) b -> Right . SimpleType . TypeInt True $ fmap toInteger b
                  Xabi.Int _           b -> Right . SimpleType . TypeInt False $ fmap toInteger b
                  Xabi.String _          -> Right . SimpleType $ TypeString
                  Xabi.Bytes _ b         -> Right . SimpleType . TypeBytes $ fmap toInteger b
                  Xabi.Bool              -> Right . SimpleType $ TypeBool
                  Xabi.Address           -> Right . SimpleType $ TypeAddress
                  Xabi.Struct _ name     -> Right $ TypeStruct name
                  Xabi.Enum _ name _     -> Right $ TypeEnum name
                  Xabi.Array{}           -> Left "Arrays of arrays are not allowed as function arguments"
                  Xabi.Contract name     -> Right $ TypeContract name
                  Xabi.Mapping{}         -> Left "Arrays of mappings are not allowed as function arguments"
                  Xabi.Label{}           -> Right $ SimpleType typeUInt
              in case len of
                   Just l                -> TypeArrayFixed l <$> ettyty
                   Nothing               -> TypeArrayDynamic <$> ettyty
            Xabi.Contract name           -> Right $ TypeContract name
            Xabi.Mapping _ _ _           -> Left "Mappings are not allowed as function arguments"
            Xabi.Label _                 -> Right $ SimpleType typeUInt -- since Enums are converted to Ints
        in do
          ty <- either (blocError . UserError) return typeM
          either (blocError . UserError) (return . (ix,)) (argValueToValue Nothing ty argVal)
    argsVals <-
      if not (Map.keysSet argNamesTypes `isSubsetOf` Map.keysSet argsMap)
      then do
        let
          argNames1 = "(" <> Text.intercalate ", " (Map.keys argNamesTypes) <> ")"
          argNames2 = "(" <> Text.intercalate ", " (Map.keys argsMap) <> ")"
        throwIO (UserError ("argument names don't match: " <> argNames1 <> " " <> argNames2))
      else sequence $ Map.intersectionWith determineValue argsMap argNamesTypes
    return $ map snd (sortOn fst (toList argsVals))

constructArgValues :: Maybe (Map Text ArgValue) -> Map Text Xabi.IndexedType -> Bloc ByteString
constructArgValues args argNamesTypes = do
    case args of
      Nothing ->
        if Map.null argNamesTypes
          then return ByteString.empty
          else throwIO (UserError "no arguments provided to function.")
      Just argsMap -> do
        vals <- getArgValues argsMap argNamesTypes
        return $ toStorage (ValueArrayFixed (fromIntegral (length vals)) vals)

constructArgValuesAndSource :: Maybe (Map Text ArgValue) -> Map Text Xabi.IndexedType -> Bloc (ByteString, Text)
constructArgValuesAndSource args argNamesTypes = do
    case args of
      Nothing ->
        if Map.null argNamesTypes
          then return (ByteString.empty, "()")
          else throwIO (UserError "no arguments provided to function.")
      Just argsMap -> do
        vals <- getArgValues argsMap argNamesTypes
        let valsAsText = map valueToText vals
        return $
          (
            toStorage (ValueArrayFixed (fromIntegral (length vals)) vals),
            "(" <> Text.intercalate "," valsAsText <> ")"
          )

getAccountTxParams :: Should CacheNonce -> Address -> Maybe ChainId -> Maybe TxParams -> Bloc TxParams
getAccountTxParams cacheNonce addr chainId mTxParams = do
  let params = fromMaybe emptyTxParams mTxParams
      cacheKey = (addr, chainId)
  nonceCache <- asks globalNonceCounter
  now <- liftIO $ getTime Monotonic
  mCachedNonce <- case cacheNonce of
    Do CacheNonce -> atomically $ cacheLookup nonceCache now cacheKey
    Don't CacheNonce -> pure Nothing
  nonceMap <- case mCachedNonce of
                Just n -> pure $ Map.singleton chainId n
                Nothing -> getAccountNonce addr (S.singleton chainId)
  liftIO . atomically $ do
    now' <- Cache.nowSTM
    mmNonce <- cacheLookup nonceCache now' cacheKey
    let mNonce = case cacheNonce of
          Do CacheNonce -> mmNonce
          Don't CacheNonce -> Nothing
        sNonce = Map.lookup chainId nonceMap
        maxNonce = liftA2 max mNonce sNonce
        newNonce = fromMaybe 0 $ txparamsNonce params <|> maxNonce <|> mNonce <|> sNonce
        expTime = (now' +) <$> Cache.defaultExpiration nonceCache
    Cache.insertSTM cacheKey (newNonce + 1) nonceCache expTime
    pure params{ txparamsNonce = Just newNonce }

getAccountNonce :: Address -> S.Set (Maybe ChainId) -> Bloc (Map (Maybe ChainId) Nonce)
getAccountNonce addr chainIds = do
  let chainIds' = map (fromMaybe (ChainId 0)) $ S.toList chainIds
  let params = accountsFilterParams{qaAddress = Just addr, qaChainId = chainIds'}
  mAccts <- fmap (map (\(AddressStateRef' a _) -> a)) . blocStrato $ getAccountsFilter params
  $logInfoLS "getAccountNonce/req" params
  $logInfoLS "getAccountNonce/resp" mAccts
  case mAccts of
    [] -> throwIO . UserError $ "User does not have a balance"
    accts -> do
      let mkCid AddressStateRef{..} = ChainId <$> toMaybe 0 addressStateRefChainId
          mkNonce AddressStateRef{..} = Nonce $ fromInteger addressStateRefNonce
      return . Map.fromList $ map (mkCid &&& mkNonce) accts

