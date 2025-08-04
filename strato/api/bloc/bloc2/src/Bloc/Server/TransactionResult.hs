{-# LANGUAGE Arrows #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE Rank2Types #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}

module Bloc.Server.TransactionResult
  ( getBlocTransactionResult,
    postBlocTransactionResults,
    getBatchBlocTransactionResult',
    getBlocTransactionResult',
    forStateT,
    constructArgValuesAndSource,
    recurseTRDs,
    TRD (..),
  )
where


import qualified Bloc.API.DeprecatedPostTransaction as Deprecated
import Bloc.API.TypeWrappers
import Bloc.API.Users
import Bloc.Monad
import Bloc.Server.Utils
import BlockApps.Logging
import BlockApps.Solidity.ArgValue
import BlockApps.Solidity.Contract ()
import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Storage
import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import qualified BlockApps.Solidity.Xabi.Type as Xabi
import BlockApps.SolidityVarReader
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.Arrow
import Control.Concurrent
import Control.Lens hiding (from, ix)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Trans.Class
import Control.Monad.Trans.State.Lazy
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import Data.Either
import Data.Foldable
import Data.Int (Int32)
import Data.List (sortOn)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.Set (isSubsetOf)
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Text.Encoding (encodeUtf8)
import Data.Traversable
import Handlers.AccountInfo
import Handlers.Transaction
import SQLM
import SolidVM.Model.CodeCollection.Contract
import SolidVM.Model.CodeCollection.Statement
import SolidVM.Solidity.Parse.ParserTypes (initialParserState)
import SolidVM.Solidity.Parse.Statement
import Text.Format
import Text.Parsec (runParser)
import UnliftIO

--import           Debug.Trace

data TRD = TRD -- transaction resolution data
  { trdStatus :: BlocTransactionStatus,
    trdHash :: Keccak256,
    trdIndex :: Integer,
    trdResult :: Maybe (RawTransaction, TransactionResult)
  }

data BatchState = BatchState
  { _functionXabiMap :: Map.Map (Address, Text) Contract
  }

makeLenses ''BatchState

emptyBatchState :: BatchState
emptyBatchState = BatchState Map.empty

-- getBlocTransactionResult' will return only one of the results
-- when multiple hashes are provided. This is a glass-half-full
-- function, and if one TX succeeds then the result is a success.
getBlocTransactionResult' ::
  ( MonadUnliftIO m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    MonadLogger m
  ) =>
  [Keccak256] ->
  Bool ->
  m BlocTransactionResult
getBlocTransactionResult' [] _ = throwIO $ AnError "getBlockTransactionResult': no TX hashes"
getBlocTransactionResult' hashes@(txh : _) resolve =
  if resolve
    then do
      results <- forM hashes $ \h -> withAsync (getBlocTransactionResult h True) $ \e -> wait e
      $logDebugLS "getBlocTransactionResult'/results" results
      case results of
        [] -> throwIO $ AnError "Empty list provided: results is empty"
        (fstResult : _) -> case filter ((== Success) . blocTransactionStatus) results of
          (winner : _) -> return winner
          [] -> return $ fstResult
    else return $ BlocTransactionResult Pending txh Nothing Nothing

getBlocTransactionResult ::
  ( MonadIO m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    MonadLogger m
  ) =>
  Keccak256 ->
  Bool ->
  m BlocTransactionResult
getBlocTransactionResult txHash resolve = unsafeHead =<< postBlocTransactionResults resolve [txHash]
  where unsafeHead [] = throwIO $ AnError "getBlocTransactionResult: No results returned"
        unsafeHead (x:_) = pure x

getBatchBlocTransactionResult' ::
  ( MonadIO m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    MonadLogger m
  ) =>
  [Keccak256] ->
  Bool ->
  m [BlocTransactionResult]
getBatchBlocTransactionResult' hashes resolve =
  if resolve
    then postBlocTransactionResults True hashes
    else return $ map (\h -> BlocTransactionResult Pending h Nothing Nothing) hashes

postBlocTransactionResults ::
  ( MonadIO m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    MonadLogger m
  ) =>
  Bool ->
  [Keccak256] ->
  m [BlocTransactionResult]
postBlocTransactionResults resolve hashes = recurseTRDs resolve hashes >>= evalAndReturn

recurseTRDs ::
  ( MonadIO m
  , MonadLogger m
  , A.Selectable Keccak256 [TransactionResult] m
  , A.Selectable TxsFilterParams [RawTransaction] m
  ) =>
  Bool ->
  [Keccak256] ->
  m [TRD]
recurseTRDs resolve hashes = go (0 :: Integer) (toPending hashes)
  where
    go num list = do
      let his = map (trdHash &&& trdIndex) list
      statusAndMtxrs <- zip his <$> getBatchBlocTxStatus (map fst his)
      let (pending', done) =
            partitionEithers $
              flip
                map
                statusAndMtxrs
                ( \((h, i), (s, r)) ->
                    if s == Pending
                      then Left $ TRD s h i r
                      else Right $ TRD s h i r
                )
      pending <-
        if not resolve || null pending'
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
    toPending = zipWith (\i h -> TRD Pending h i Nothing) [0 ..]

    merge :: [a] -> [a] -> (a -> a -> Bool) -> [a]
    merge [] ps _ = ps
    merge ds [] _ = ds
    merge (d : ds) (p : ps) c =
      if c d p
        then (d : merge ds (p : ps) c)
        else (p : merge (d : ds) ps c)

forStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m [b]
forStateT s as = flip evalStateT s . for as

rawTx2PostTx :: RawTransaction -> Deprecated.PostTransaction
rawTx2PostTx RawTransaction {..} =
  Deprecated.PostTransaction
    { Deprecated.posttransactionHash = rawTransactionTxHash,
      Deprecated.posttransactionGasLimit = fromInteger rawTransactionGasLimit,
      Deprecated.posttransactionCodeOrData = "", -- this is only for send txs anyway
      Deprecated.posttransactionTo = rawTransactionToAddress,
      Deprecated.posttransactionFrom = rawTransactionFromAddress,
      Deprecated.posttransactionR = Hex $ fromInteger rawTransactionR,
      Deprecated.posttransactionS = Hex $ fromInteger rawTransactionS,
      Deprecated.posttransactionV = Hex rawTransactionV,
      Deprecated.posttransactionNonce = fromInteger rawTransactionNonce
    }

evalAndReturn ::
  ( MonadIO m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    MonadLogger m
  ) =>
  [TRD] ->
  m [BlocTransactionResult]
evalAndReturn list = forStateT emptyBatchState list $
  \(TRD status txHash _ mtxr) -> case status of
    Pending -> return $ BlocTransactionResult Pending txHash Nothing Nothing
    Failure -> return $ BlocTransactionResult Failure txHash (snd <$> mtxr) Nothing
    Success -> case mtxr of
      Nothing -> return $ BlocTransactionResult Pending txHash Nothing Nothing
      Just (r@RawTransaction {..}, txr) -> case (rawTransactionToAddress, rawTransactionCode) of
        (Nothing, _) -> contractResult txHash txr (fromJust rawTransactionContractName)
        (_, Just _) -> return $ BlocTransactionResult Success txHash (Just txr) (Just . Send $ rawTx2PostTx r)
        (Just addr, _) -> functionResult txHash txr (fromJust rawTransactionFuncName) addr

nth :: Integer -> Text
nth n
  | n `mod` 10 == 0 = Text.pack (show $ n + 1) <> "st"
  | n `mod` 10 == 1 = Text.pack (show $ n + 1) <> "nd"
  | n `mod` 10 == 2 = Text.pack (show $ n + 1) <> "rd"
  | otherwise = Text.pack (show $ n + 1) <> "th"

contractResult ::
  ( MonadIO m
  , A.Selectable AccountsFilterParams [AddressStateRef] m
  ) =>
  Keccak256 ->
  TransactionResult ->
  Text ->
  StateT BatchState m BlocTransactionResult
contractResult txHash txResult@TransactionResult {..} name = do
  let accountMaybe = listToMaybe transactionResultContractsCreated
  case accountMaybe of
    Nothing -> case transactionResultMessage of
      "Success!" -> do
        let mDelAddr = listToMaybe transactionResultContractsDeleted
        case mDelAddr of
          Just _ -> lift . throwIO . UserError $ "Contract failed to upload, likely because the constructor threw"
          Nothing -> lift . throwIO . UserError $ Text.pack $ "Transaction succeeded, but contract was neither created, nor destroyed, transactionResultContractsDeleted=" ++ show transactionResultContractsDeleted ++ ", transactionResultContractsCreated=" ++ show transactionResultContractsCreated
      stratoMsg -> lift . throwIO . UserError $ Text.pack stratoMsg
    Just acct -> do
      -- Checks if account exists in the address state ref table before returning results
      details <- lift $ go acct name (0 :: Integer)
      return $ BlocTransactionResult Success txHash (Just txResult) (Just $ Upload details)
  where
    go address name' num = do
      if num >= 100 
        then throwIO . UserError $ Text.pack $ "Transaction succeeded, but contract was neither created, nor destroyed, num=" ++ show num
        else do
          void . liftIO $ threadDelay 100000
          addressRefs <- 
            getAccount' 
              accountsFilterParams
                { _qaAddress = Just address,
                  _qaContractName = Just name',
                  _qaIgnoreChain = Just True
                }
          case addressRefs of
            [] -> go address name (num + 1)
            _ -> return $ UploadContractDetails {contractName = name, contractAddress = Just address}


functionResult ::
  ( MonadIO m,
    MonadLogger m
  ) =>
  Keccak256 ->
  TransactionResult ->
  Text ->
  Address ->
  StateT BatchState m BlocTransactionResult
functionResult txHash txResult@TransactionResult {..} _ _ = do
  case transactionResultMessage of
      "Success!" -> do
        let txResp = transactionResultResponse
        mFormattedResponse <- convertSvmResultResToVals txResp
        formattedResponse <- lift $ blocMaybe ("Failed to parse response: " <> Text.pack txResp) mFormattedResponse
        return $ BlocTransactionResult Success txHash (Just txResult) (Just $ Call formattedResponse)
      stratoMsg -> throwIO $ UserError $ Text.pack stratoMsg

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType $ TypeInt False $ Just 32
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty

-- works for EVM only
convertResultResToVals :: ByteString -> [Type] -> Maybe [SolidityValue]
convertResultResToVals byteResp responseTypes =
  map valueToSolidityValue <$> bytestringToValues byteResp responseTypes

-- works for SolidVM only
convertSvmResultResToVals :: MonadLogger m => String -> m (Maybe [SolidityValue])
convertSvmResultResToVals resp = do
  $logDebugS "convertSvmResultResToVals" . Text.pack $ "response: " ++ resp
  let args = runParser parseArgs initialParserState "" resp
  $logDebugS "convertSvmResultResToVals" . Text.pack $ "args: " ++ show args
  case args of
    Left _ -> pure Nothing
    Right y -> do
      let values = traverse expressionToValue y
      $logDebugS "convertSvmResultResToVals" . Text.pack $ "values: " ++ show values
      let solVals = fmap valueToSolidityValue <$> values
      $logDebugS "convertSvmResultResToVals" . Text.pack $ "solVals: " ++ show solVals
      pure solVals

expressionToValue :: Expression -> Maybe Value
expressionToValue (NumberLiteral _ n _) = Just $ SimpleValue $ ValueInt False Nothing n
expressionToValue (BoolLiteral _ n) = Just $ SimpleValue $ ValueBool n
expressionToValue (StringLiteral _ n) = Just $ SimpleValue $ ValueString $ Text.pack n
expressionToValue (DecimalLiteral _ n) = Just $ SimpleValue $ ValueDecimal (encodeUtf8 $ Text.pack $ show $ unwrapDecimal n)
expressionToValue (ArrayExpression _ n) = ValueArrayFixed (fromIntegral $ length n) <$> traverse expressionToValue n
expressionToValue _ = Nothing

-- TODO: implement expressionToValue for tuples, arrays, structs, and mappings
--expressionToValue (TupleExpression _ n) = Just $ SMV.STuple $ traverse expressionToValue n -- [SMV.Value]
--expressionToValue (ObjectLiteral _ n) = Just $ SMV.SStruct _ n --SStruct _ theMap

constructArgValuesAndSource ::
  (MonadIO m, MonadLogger m) =>
  Maybe (Map Text ArgValue) ->
  Map Text Xabi.IndexedType ->
  m (ByteString, Text)
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
        ( toStorage (ValueArrayFixed (fromIntegral (length vals)) vals),
          "(" <> Text.intercalate "," valsAsText <> ")"
        )

getArgValues ::
  (MonadIO m, MonadLogger m) =>
  Map Text ArgValue ->
  Map Text Xabi.IndexedType ->
  m [Value]
getArgValues argsMap argNamesTypes = do
  let determineValue ::
        (MonadIO m, MonadLogger m) =>
        ArgValue ->
        Xabi.IndexedType ->
        m (Int32, Value)
      determineValue argVal (Xabi.IndexedType ix xabiType) =
        let typeM = case xabiType of
              Xabi.Int (Just True) b -> Right . SimpleType . TypeInt True $ fmap toInteger b
              Xabi.Int _ b -> Right . SimpleType . TypeInt False $ fmap toInteger b
              Xabi.String _ -> Right . SimpleType $ TypeString
              Xabi.Decimal -> Right . SimpleType $ TypeDecimal
              Xabi.Bytes _ b -> Right . SimpleType . TypeBytes $ fmap toInteger b
              Xabi.Bool -> Right . SimpleType $ TypeBool
              Xabi.Address -> Right . SimpleType $ TypeAddress
              Xabi.Account -> Right . SimpleType $ TypeAccount
              Xabi.Struct _ name -> Right $ TypeStruct name
              Xabi.Enum _ name _ -> Right $ TypeEnum name
              Xabi.Array ety len ->
                let ettyty = case ety of
                      Xabi.Int (Just True) b -> Right . SimpleType . TypeInt True $ fmap toInteger b
                      Xabi.Int _ b -> Right . SimpleType . TypeInt False $ fmap toInteger b
                      Xabi.String _ -> Right . SimpleType $ TypeString
                      Xabi.Decimal -> Right . SimpleType $ TypeDecimal
                      Xabi.Bytes _ b -> Right . SimpleType . TypeBytes $ fmap toInteger b
                      Xabi.Bool -> Right . SimpleType $ TypeBool
                      Xabi.Address -> Right . SimpleType $ TypeAddress
                      Xabi.Account -> Right . SimpleType $ TypeAccount
                      Xabi.Struct _ name -> Right $ TypeStruct name
                      Xabi.Enum _ name _ -> Right $ TypeEnum name
                      Xabi.Array {} -> Left "Arrays of arrays are not allowed as function arguments"
                      Xabi.Contract name -> Right $ TypeContract name
                      Xabi.Mapping {} -> Left "Arrays of mappings are not allowed as function arguments"
                      Xabi.UnknownLabel {} -> Right $ SimpleType typeUInt
                      Xabi.Variadic -> Left "Arrays of variadics are not allowed as function arguments"
                 in case len of
                      Just l -> TypeArrayFixed l <$> ettyty
                      Nothing -> TypeArrayDynamic <$> ettyty
              Xabi.Contract name -> Right $ TypeContract name
              Xabi.Mapping _ _ _ -> Left "Mappings are not allowed as function arguments"
              Xabi.UnknownLabel _ -> Right $ SimpleType typeUInt -- since Enums are converted to Ints
              Xabi.Variadic -> Right $ TypeVariadic
         in do
              ty <- either (blocError . UserError) return typeM
              either (blocError . UserError) (return . (ix,)) (argValueToValue Nothing ty argVal)
  argsVals <-
    if not (Map.keysSet argNamesTypes `isSubsetOf` Map.keysSet argsMap)
      then do
        let argNames1 = "(" <> Text.intercalate ", " (Map.keys argNamesTypes) <> ")"
            argNames2 = "(" <> Text.intercalate ", " (Map.keys argsMap) <> ")"
        throwIO (UserError ("Argument names don't match - Expected Arguments: " <> argNames1 <> "; Received Arguments: " <> argNames2))
      else sequence $ Map.intersectionWith determineValue argsMap argNamesTypes
  return $ map snd (sortOn fst (toList argsVals))
