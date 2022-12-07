{-# LANGUAGE Arrows              #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE Rank2Types          #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeOperators       #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}

module BlockApps.Bloc22.Server.TransactionResult (
  getBlocTransactionResult,
  postBlocTransactionResults,
  getBatchBlocTransactionResult',
  getBlocTransactionResult',
  forStateT,
  constructArgValuesAndSource,
  recurseTRDs,
  TRD(..)
  ) where

import           Control.Concurrent
import           Control.Arrow
import           Control.Lens                      hiding (from, ix)
import           Control.Monad
import qualified Control.Monad.Change.Alter        as A
import           Control.Monad.Except
import           Control.Monad.Trans.State.Lazy
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Base16            as Base16
import           Data.ByteString.Short             (fromShort)
import           Data.Either
import           Data.Foldable
import           Data.Int                          (Int32)
import           Data.List                         (sortOn)
import           Data.Map.Strict                   (Map)
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.Set                          (isSubsetOf)
import           Data.Source.Map
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Traversable
import           Text.Format
import           Text.Read                         (readMaybe)
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
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.DataDefs
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.Keccak256
import qualified BlockApps.Bloc22.API.DeprecatedPostTransaction as Deprecated
import           BlockApps.Bloc22.API.TypeWrappers
import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.SQL
import           SQLM

data TRD = TRD -- transaction resolution data
  { trdStatus :: BlocTransactionStatus
  , trdHash   :: Keccak256
  , trdIndex  :: Integer
  , trdResult :: Maybe (RawTransaction, TransactionResult)
  }

data BatchState = BatchState
  { _contractDetailsMap :: Map.Map ContractName ContractDetails
  , _functionXabiMap    :: Map.Map (Account, Text) Xabi
  }
makeLenses ''BatchState


emptyBatchState :: BatchState
emptyBatchState = BatchState Map.empty Map.empty

-- getBlocTransactionResult' will return only one of the results
-- when multiple hashes are provided. This is a glass-half-full
-- function, and if one TX succeeds then the result is a success.
getBlocTransactionResult' :: ( MonadIO m
                             , (Keccak256 `A.Alters` SourceMap) m
                             , A.Selectable Account AddressState m
                             , MonadLogger m
                             , HasBlocSQL m
                             , HasBlocEnv m
                             , HasSQL m
                             )
                          => [Keccak256] -> Bool -> m BlocTransactionResult
getBlocTransactionResult' [] _ = throwIO $ AnError "getBlockTransactionResult': no TX hashes"
getBlocTransactionResult' hashes@(txh:_) resolve =
  if resolve
    then do
      promises <- forM hashes $ \h -> async (getBlocTransactionResult h True)
      results <- mapM wait promises
      $logDebugLS "getBlocTransactionResult'/results" results
      case results of 
        [] -> throwIO $ AnError "Empty list provided: results is empty"
        (fstResult:_) -> case filter ((== Success) . blocTransactionStatus) results of
          (winner:_) -> return winner
          [] -> return $ fstResult
        
    else return $ BlocTransactionResult Pending txh Nothing Nothing

getBlocTransactionResult :: ( MonadIO m
                            , (Keccak256 `A.Alters` SourceMap) m
                            , A.Selectable Account AddressState m
                            , MonadLogger m
                            , HasBlocSQL m
                            , HasBlocEnv m
                            , HasSQL m
                            )
                         => Keccak256 -> Bool -> m BlocTransactionResult
getBlocTransactionResult txHash resolve = fmap head $ postBlocTransactionResults resolve [txHash]


getBatchBlocTransactionResult' :: ( MonadIO m
                                  , (Keccak256 `A.Alters` SourceMap) m
                                  , A.Selectable Account AddressState m
                                  , MonadLogger m
                                  , HasBlocSQL m
                                  , HasBlocEnv m
                                  , HasSQL m
                                  )
                               => [Keccak256] -> Bool -> m [BlocTransactionResult]
getBatchBlocTransactionResult' hashes resolve =
  if resolve
    then postBlocTransactionResults True hashes
    else return $ map (\h -> BlocTransactionResult Pending h Nothing Nothing) hashes

postBlocTransactionResults :: ( MonadIO m
                              , (Keccak256 `A.Alters` SourceMap) m
                              , A.Selectable Account AddressState m
                              , MonadLogger m
                              , HasBlocSQL m
                              , HasBlocEnv m
                              , HasSQL m
                              )
                           => Bool -> [Keccak256] -> m [BlocTransactionResult]
postBlocTransactionResults resolve hashes = recurseTRDs resolve hashes >>= evalAndReturn

recurseTRDs :: (MonadLogger m, HasSQL m) =>
               Bool
            -> [Keccak256]
            -> m [TRD]
recurseTRDs resolve hashes = go 0 (toPending hashes)
  where
    go :: (MonadLogger m, HasSQL m) => Int -> [TRD] -> m [TRD]
    go num list = do
      let his = map (trdHash &&& trdIndex) list
      statusAndMtxrs <- zip his <$> getBatchBlocTxStatus (map fst his)
      let (pending', done) = partitionEithers $
                      flip map statusAndMtxrs
                        (\((h,i),(s,r)) ->
                          if s == Pending
                            then Left $ TRD s h i r
                            else Right $ TRD s h i r)
      pending <- if not resolve || null pending'
        then return pending'
        else
          if num >= 100 -- poll for 10 seconds. With PBFT, a transaction that hasn't resolved by this point is almost certainly lost
            then return pending'
            else do
              $logDebugLS "recurseTRDs/pending'" $ map (format . trdHash) pending'
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

forStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m [b]
forStateT s as = flip evalStateT s . for as


rawTx2PostTx :: RawTransaction -> Deprecated.PostTransaction
rawTx2PostTx RawTransaction{..} = Deprecated.PostTransaction
  { Deprecated.posttransactionHash = rawTransactionTxHash
  , Deprecated.posttransactionGasLimit = fromInteger rawTransactionGasLimit
  , Deprecated.posttransactionCodeOrData = "" -- this is only for send txs anyway
  , Deprecated.posttransactionGasPrice = fromInteger rawTransactionGasPrice
  , Deprecated.posttransactionTo = rawTransactionToAddress
  , Deprecated.posttransactionFrom = rawTransactionFromAddress
  , Deprecated.posttransactionValue = Strung $ fromInteger rawTransactionValue
  , Deprecated.posttransactionR = Hex $ fromInteger rawTransactionR
  , Deprecated.posttransactionS = Hex $ fromInteger rawTransactionS
  , Deprecated.posttransactionV = Hex rawTransactionV
  , Deprecated.posttransactionNonce = fromInteger rawTransactionNonce
  , Deprecated.posttransactionChainId = ChainId <$> toMaybe 0 rawTransactionChainId
  , Deprecated.posttransactionMetadata = Map.fromList <$> rawTransactionMetadata
  }

evalAndReturn :: ( MonadIO m
                 , (Keccak256 `A.Alters` SourceMap) m
                 , A.Selectable Account AddressState m
                 , MonadLogger m
                 , HasBlocSQL m
                 , HasBlocEnv m
                 )
              => [TRD] -> m [BlocTransactionResult]
evalAndReturn list = forStateT emptyBatchState list $
    \(TRD status txHash i mtxr) -> case status of
        Pending -> return $ BlocTransactionResult Pending txHash Nothing Nothing
        Failure -> return $ BlocTransactionResult Failure txHash (snd <$> mtxr) Nothing
        Success -> case mtxr of
          Nothing -> return $ BlocTransactionResult Pending txHash Nothing Nothing
          Just (r@RawTransaction{..}, txr) -> case (rawTransactionToAddress, rawTransactionCodeOrData) of
            (Nothing, code) -> contractResult i txHash code txr (Map.fromList <$> rawTransactionMetadata)
            (_, Code "") -> return $ BlocTransactionResult Success txHash (Just txr) (Just . Send $ rawTx2PostTx r)
            (Just addr, _) -> functionResult i txHash txr (Map.fromList <$> rawTransactionMetadata) (Account addr $ toMaybe 0 rawTransactionChainId)

nth :: Integer -> Text
nth n | n `mod` 10 == 0 = Text.pack (show $ n + 1) <> "st"
      | n `mod` 10 == 1 = Text.pack (show $ n + 1) <> "nd"
      | n `mod` 10 == 2 = Text.pack (show $ n + 1) <> "rd"
      | otherwise       = Text.pack (show $ n + 1) <> "th"

contractResult :: ( MonadIO m
                  , A.Selectable Account AddressState m
                  , (Keccak256 `A.Alters` SourceMap) m
                  , MonadLogger m
                  , HasBlocSQL m
                  , HasBlocEnv m
                  )
               => Integer
               -> Keccak256
               -> Code
               -> TransactionResult
               -> Maybe (Map Text Text)
               -> StateT BatchState m BlocTransactionResult
contractResult i txHash code txResult mmd = do
  ~(name, src, vm) <- case mmd of
    Nothing -> lift . throwIO . UserError $ "Could not get the metadata of the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
    Just md -> case Map.lookup "name" md of
      Nothing -> lift . throwIO . UserError $ "Could not get the name of the contract for the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
      Just name -> case fromMaybe "EVM" $ Map.lookup "VM" md of
        "EVM" -> case Map.lookup "src" md of
          Nothing -> lift . throwIO . UserError $ "Could not get the source of the contract for the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
          Just src -> pure (name, src, "EVM")
        vm -> case code of
          Code bs -> pure (name, Text.decodeUtf8 bs, vm)
          PtrToCode codePtr -> lift $ getContractDetailsByCodeHash codePtr >>= \case
            Left e -> throwIO $ UserError e
            Right ContractDetails{..} -> pure (name, serializeSourceMap contractdetailsSrc, vm)
  let
    accountMaybe = do
      str <- listToMaybe $
        Text.splitOn "," (Text.pack $ transactionResultContractsCreated txResult)
      readMaybe (Text.unpack str)
  case accountMaybe of
    Nothing -> case transactionResultMessage txResult of
      "Success!" -> do
        let mDelAddr = readMaybe @Account . Text.unpack =<<
              (listToMaybe . Text.splitOn "," . Text.pack $ transactionResultContractsDeleted txResult)
        case mDelAddr of
          Just _ -> lift . throwIO . UserError $ "Contract failed to upload, likely because the constructor threw"
          Nothing -> lift . throwIO . UserError $ "Transaction succeeded, but contract was neither created, nor destroyed"
      stratoMsg  -> lift . throwIO . UserError $ Text.pack stratoMsg
    Just acct -> do
      let cn = ContractName name
      mdetails <- use $ contractDetailsMap . at cn
      details <- case mdetails of
        Just details' -> return details'{contractdetailsAccount = Just acct}
        Nothing -> do
          cds <- lift $ getContractDetailsForContract vm (deserializeSourceMap src) (Just name)
          case cds of
            Nothing -> lift . throwIO . UserError $ "Could not get details for contract" <> name
            Just (_, ds) -> contractDetailsMap . at cn <?= ds{contractdetailsAccount = Just acct}
      return $ BlocTransactionResult Success txHash (Just txResult) (Just $ Upload details)

functionResult :: ( MonadIO m
                  , A.Selectable Account AddressState m
                  , (Keccak256 `A.Alters` SourceMap) m
                  , MonadLogger m
                  , HasBlocSQL m
                  , HasBlocEnv m
                  )
               => Integer
               -> Keccak256
               -> TransactionResult
               -> Maybe (Map Text Text)
               -> Account
               -> StateT BatchState m BlocTransactionResult
functionResult i txHash txResult mmd toAccount = do
  funcName <- case mmd of
    Nothing -> lift . throwIO . UserError $ "Could not get the metadata of the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
    Just md -> case Map.lookup "funcName" md of
      Nothing -> lift . throwIO . UserError $ "Could not get the name of the contract for the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
      Just funcName -> pure funcName
  mxabi <- use $ functionXabiMap . at (toAccount, funcName)
  xabi <- case mxabi of
    Just xabi' -> return xabi'
    Nothing -> do
      mch <- lift $ fmap addressStateCodeHash <$> A.select (A.Proxy @AddressState) toAccount
      xabi' <- case mch of
        Nothing -> lift . throwIO . UserError $ "Could not find contract at " <> Text.pack (format toAccount)
        Just ch -> lift $ getContractDetailsByCodeHash ch >>= \case
          Left e -> throwIO $ UserError e
          Right d -> pure $ contractdetailsXabi d
      functionXabiMap . at (toAccount, funcName) <?= xabi'
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
      {- -- check if evm or svm is called 
      --(Map.fromList <$> rawTransactionMetadata)
      ~(name, src, vm) <- case mmd of
    Nothing -> lift . throwIO . UserError $ "Could not get the metadata of the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
    Just md -> case Map.lookup "name" md of
      Nothing -> lift . throwIO . UserError $ "Could not get the name of the contract for the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
      Just name -> case fromMaybe "EVM" $ Map.lookup "VM" md of
        "EVM" -> case Map.lookup "src" md of
          Nothing -> lift . throwIO . UserError $ "Could not get the source of the contract for the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
          Just src -> pure (name, src, "EVM")

      -}

      transcationMetadata=Map.fromList <$> rawTransactionMetadata
      case Map.lookup "name" transcationMetadata of
        Nothing -> lift . throwIO . UserError $ "Could not get the name of the contract for the " <> nth i <> " transaction in the list: " <> Text.pack (format txHash)
        Just name -> case fromMaybe "EVM" $ Map.lookup "VM" md of
          "EVM" -> mFormattedResponse = convertResultResToVals txResp mappedResultTypes
          "SVM" -> mFormattedResponse = convertSvmResultResToVals txResp 
      Nothing -> lift . throwIO . UserError $ "Could not get the VM type!"
      
  case transactionResultMessage txResult of
    "Success!" -> do
      let r = Text.decodeUtf8 $ Base16.encode txResp
      formattedResponse <- lift $ blocMaybe ("Failed to parse response: " <> r) mFormattedResponse
      return $ BlocTransactionResult Success txHash (Just txResult) (Just $ Call formattedResponse)
    stratoMsg  -> throwIO $ UserError $ Text.pack stratoMsg

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType $ TypeInt False $ Just 32
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty
-- this function works for EVM only
convertResultResToVals :: ByteString -> [Type] -> Maybe [SolidityValue]
convertResultResToVals byteResp responseTypes =
  map valueToSolidityValue <$> bytestringToValues byteResp responseTypes

-- this function works for SolidVM only
convertSvmResultResToVals :: Maybe [Value] ->  Maybe [SolidityValue]
convertSvmResultResToVals resp  =
  map valueToSolidityValue <$> resp 



---------------------------------

constructArgValuesAndSource :: (MonadIO m, MonadLogger m) =>
                               Maybe (Map Text ArgValue) -> Map Text Xabi.IndexedType -> m (ByteString, Text)
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

getArgValues :: (MonadIO m, MonadLogger m) =>
                Map Text ArgValue -> Map Text Xabi.IndexedType -> m [Value]
getArgValues argsMap argNamesTypes = do
    let
      determineValue :: (MonadIO m, MonadLogger m) =>
                        ArgValue -> Xabi.IndexedType -> m (Int32, Value)
      determineValue argVal (Xabi.IndexedType ix xabiType) =
        let
          typeM = case xabiType of
            Xabi.Int (Just True) b -> Right . SimpleType . TypeInt True $ fmap toInteger b
            Xabi.Int _           b -> Right . SimpleType . TypeInt False $ fmap toInteger b
            Xabi.String _          -> Right . SimpleType $ TypeString
            Xabi.Bytes _ b         -> Right . SimpleType . TypeBytes $ fmap toInteger b
            Xabi.Bool              -> Right . SimpleType $ TypeBool
            Xabi.Address           -> Right . SimpleType $ TypeAddress
            Xabi.Account           -> Right . SimpleType $ TypeAccount
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
                  Xabi.Account           -> Right . SimpleType $ TypeAccount
                  Xabi.Struct _ name     -> Right $ TypeStruct name
                  Xabi.Enum _ name _     -> Right $ TypeEnum name
                  Xabi.Array{}           -> Left "Arrays of arrays are not allowed as function arguments"
                  Xabi.Contract name     -> Right $ TypeContract name
                  Xabi.Mapping{}         -> Left "Arrays of mappings are not allowed as function arguments"
                  Xabi.UnknownLabel{}           -> Right $ SimpleType typeUInt
              in case len of
                   Just l                -> TypeArrayFixed l <$> ettyty
                   Nothing               -> TypeArrayDynamic <$> ettyty
            Xabi.Contract name           -> Right $ TypeContract name
            Xabi.Mapping _ _ _           -> Left "Mappings are not allowed as function arguments"
            Xabi.UnknownLabel _                 -> Right $ SimpleType typeUInt -- since Enums are converted to Ints
        in do
          ty <- either (blocError . UserError) return typeM
          either (blocError . UserError) (return . (ix,)) (argValueToValue Nothing ty argVal)
    argsVals <-
      if not (Map.keysSet argNamesTypes `isSubsetOf` Map.keysSet argsMap)
      then do
        let
          argNames1 = "(" <> Text.intercalate ", " (Map.keys argNamesTypes) <> ")"
          argNames2 = "(" <> Text.intercalate ", " (Map.keys argsMap) <> ")"
        throwIO (UserError ("Argument names don't match - Expected Arguments: " <> argNames1 <> "; Received Arguments: " <> argNames2))
      else sequence $ Map.intersectionWith determineValue argsMap argNamesTypes
    return $ map snd (sortOn fst (toList argsVals))
