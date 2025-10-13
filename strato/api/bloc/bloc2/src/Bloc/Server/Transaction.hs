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

{-# LANGUAGE BlockArguments #-}

module Bloc.Server.Transaction
  ( postBlocTransaction,
    postBlocTransactionBody,
    postBlocTransactionUnsigned,
    postBlocTransactionParallel
  )
where

import Bloc.API.Transaction
import Bloc.API.Users
import Bloc.API.Utils
import Core.ApiContext (ApiContext)
import qualified Control.Monad.Change.Modify as Mod
import Bloc.Database.Queries (getContractByAddress, getContractDetailsForContract)
import Bloc.Monad
import Bloc.Server.TransactionResult
import Bloc.Server.Utils
import BlockApps.Logging
import BlockApps.Solidity.ArgValue
import BlockApps.Solidity.Contract ()
import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import qualified BlockApps.Solidity.Xabi.Type as Xabi
import BlockApps.Solidity.XabiContract
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.CirrusDefs
import Blockchain.Data.DataDefs
import Blockchain.DB.SQLDB
import Blockchain.Data.TXOrigin
import Control.Monad.Catch (MonadCatch)
import Blockchain.Data.Transaction (Transaction(..), rawTX2TX, transactionHash, transactionTo, partialTransactionHash, txAndTime2RawTX)
import Blockchain.Model.JsonBlock
import Blockchain.Model.SyncState (BestBlock (..), WorldBestBlock(..))
import Blockchain.Sequencer.Event (IngestEvent)
import Blockchain.Strato.Model.Address hiding (unAddress)
--import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256 hiding (rlpHash)
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Secp256k1
import Blockchain.SyncDB
import Control.Applicative ((<|>))
import Control.Arrow
import Control.Lens hiding (from, ix)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Extra
import Control.Monad.Reader
import Control.Monad.Trans.State.Lazy
import Data.Bool
import qualified Data.Cache as Cache
import qualified Data.Cache.Internal as Cache
import Data.Foldable
import Data.Hashable hiding (hash)
import Data.Int (Int32)
import Data.List (sortOn)
import qualified Data.Map as M
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.Semigroup (Max (..))
import Data.Set (isSubsetOf)
import qualified Data.Set as S
import Data.Source.Map
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Time.Clock
import qualified Data.Vector as V
import Handlers.AccountInfo
import Handlers.Storage
import Handlers.Transaction
import SQLM
import SolidVM.Model.CodeCollection.Contract
import SolidVM.Model.CodeCollection.Function
import qualified SolidVM.Model.Value as SMV
import System.Clock
import Text.Format

import UnliftIO

mergeTxParams :: Maybe TxParams -> Maybe TxParams -> Maybe TxParams
mergeTxParams (Just inner) (Just outer) =
  Just $
    TxParams
      (txparamsGasLimit inner <|> txparamsGasLimit outer)
      (txparamsGasPrice inner <|> txparamsGasPrice outer)
      (txparamsNonce inner <|> txparamsNonce outer)
mergeTxParams inner outer = inner <|> outer

--------------------------------- RAW (PRE-SIGNED) TRANSACTIONS ------------------------------------

postBlocTransactionBody ::
  ( MonadIO m,
    MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    A.Selectable Address AddressState m,
    A.Selectable Keccak256 SourceMap m,
    HasCodeDB m,
    HasBlocEnv m,
    HasVault m
  ) =>
  -- | SolidVM transactions
  PostBlocTransactionRequest ->
  -- | tx hash & raw tx data
  m [BlocTransactionBodyResult]
postBlocTransactionBody (PostBlocTransactionRequest _ [] _ _) = return []
postBlocTransactionBody (PostBlocTransactionRequest mAddr txList txParams msrcs) = do
  addr <- case mAddr of
    Nothing -> fromPublicKey <$> getPub
    Just addr' -> return addr'
  fmap join . forM (partitionWith transactionType txList) $ \(ttype, txs) -> case ttype of
    TRANSFER -> do
      txs' <- mapM fromTransfer txs
      let ts = map (\(TransferPayload t x m) -> SendTransaction t (mergeTxParams x txParams) m) txs'
      txsWithParams <- genNonces (Don't CacheNonce) addr sendtransactionTxParams ts
      txs'' <-
        mapM
          ( \(SendTransaction toAddr params _) -> do
              let header =
                    TransactionHeader
                      (Just toAddr)
                      addr
                      Nothing
                      Nothing
                      []
                      "mercata"
                      (fromMaybe emptyTxParams params)
                      (Just $ Code "")
              signAndPrepare addr header
          )
          txsWithParams
      forM txs'' (\r -> return $ BlocTransactionBodyResult (hash' r) (Just r))
    CONTRACT -> do
      ps <- mapM fromContract txs
      let srcMap :: ContractPayload -> Maybe SourceMap
          srcMap p = join $ liftA2 Map.lookup (contractpayloadContract p) msrcs
          src' :: ContractPayload -> Maybe SourceMap
          src' p =
            if contractpayloadSrc p == mempty
              then Nothing
              else Just $ contractpayloadSrc p
          getSrc p = fromMaybe mempty $ src' p <|> srcMap p
          mapUploadList =
            map
              ( \p@(ContractPayload _ c a x _) -> do
                  UploadListContract
                    (fromJust c)
                    (getSrc p)
                    (fromMaybe Map.empty a)
                    (mergeTxParams x txParams)
                    Nothing
              )
              ps
      txsWithParams <- genNonces (Don't CacheNonce) addr uploadlistcontractTxParams mapUploadList
      forStateT Map.empty txsWithParams $
        \(UploadListContract name srcs args params _) -> do
          (src, contract) <- do
            cd <-
              fmap snd . lift $
                getContractDetailsForContract srcs (Just name) >>= \case
                  Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
                  Just x -> pure x
            at name <?= (srcs, cd)

          let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
              xabiArgs = Map.fromList . catMaybes . maybe [] (map f . _funcArgs) $ _constructor contract
          argsAsSource <- lift $ constructArgValuesAndSource (Just args) xabiArgs
          
          tx <- lift . signAndPrepare addr $
              TransactionHeader
                Nothing
                addr
                Nothing
                (Just name)
                argsAsSource
                "mercata"
                (fromMaybe emptyTxParams params)
                (Just $ Code $ serializeSourceMap src)
          return $ BlocTransactionBodyResult (hash' tx) (Just tx)
    FUNCTION -> do
      p <- mapM fromFunction txs
      let mapMethodCalls = map (\(FunctionPayload a m r x md) -> MethodCall a m r (mergeTxParams x txParams) md) p
      txsWithParams <- genNonces (Don't CacheNonce) addr methodcallTxParams mapMethodCalls
      forStateT Map.empty txsWithParams $
        \MethodCall{..} -> do
          mContract <- use $ at methodcallContractAddress
          contract <- case mContract of
            Just x -> pure x
            Nothing -> do
              mContract' <- lift $ getContractByAddress methodcallContractAddress
              x <- case mContract' of
                Nothing -> lift $ throwIO . UserError $ "Could not find contract " <> Text.pack (format methodcallContractAddress)
                Just x -> pure x
              at methodcallContractAddress <?= x
          case M.lookup (Text.unpack methodcallMethodName) (contract ^. functions) of
            Just _ -> pure ()
            Nothing -> throwIO . UserError $ "Contract doesn't have a method named '" <> methodcallMethodName <> "'"

          let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
              xabiArgs = Map.fromList . catMaybes . maybe [] (map f . _funcArgs) . Map.lookup (Text.unpack methodcallMethodName) $ contract ^. functions
          argsAsSource <- lift $ constructArgValuesAndSource (Just methodcallArgs) xabiArgs
          tx <- lift . signAndPrepare addr $
            TransactionHeader
              (Just methodcallContractAddress)
              addr
              (Just methodcallMethodName)
              Nothing
              argsAsSource
              "mercata"
              (fromMaybe emptyTxParams _methodcallTxParams)
              Nothing
--              (Just $ Code $ sel <> argsBin)
          return $ BlocTransactionBodyResult (hash' tx) (Just tx)
  where
    hash' = transactionHash . rawTX2TX . rtPrimeToRt
    fromTransfer = \case
      BlocTransfer t -> return t
      _ -> throwIO $ UserError "Could not decode transfer arguments from body"
    fromContract = \case
      BlocContract c -> return c
      _ -> throwIO $ UserError "Could not decode contract arguments from body"
    fromFunction = \case
      BlocFunction f -> return f
      _ -> throwIO $ UserError "Could not decode function arguments from body"

-- | postBlocTransactionUnsigned
postBlocTransactionUnsigned ::
  ( MonadIO m,
    MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    A.Selectable Address AddressState m,
    A.Selectable Keccak256 SourceMap m,
    HasCodeDB m,
    HasBlocEnv m,
    HasVault m
  ) =>
  -- | SolidVM transactions
  PostBlocTransactionRequest ->
  -- | tx hash & raw tx data
  m [BlocTransactionUnsignedResult]
postBlocTransactionUnsigned (PostBlocTransactionRequest _ [] _ _) = return []
postBlocTransactionUnsigned (PostBlocTransactionRequest mAddr txList txParams msrcs) = do
  addr <- case mAddr of -- This is just to get the user's nonce if they didn't supply one
    Nothing -> fromPublicKey <$> getPub
    Just addr' -> return addr'
  fmap join . forM txList $ \tx -> case transactionType tx of
    TRANSFER -> do
      tx' <- fromTransfer tx
      let t = (\(TransferPayload t' x m) -> SendTransaction t' (mergeTxParams x txParams) m) tx'
      txsWithParams <- genNonces (Don't CacheNonce) addr sendtransactionTxParams [t]
      mapM
        ( \(SendTransaction toAddr params _) -> do
            let header =
                  TransactionHeader
                    (Just toAddr)
                    addr
                    Nothing
                    Nothing
                    []
                    "mercata"
                    (fromMaybe emptyTxParams params)
                    (Just $ Code "")
            prepareUnsignedRawTx "" [] header
        )
        txsWithParams
    CONTRACT -> do
      ps <- fromContract tx
      let srcMap :: ContractPayload -> Maybe SourceMap
          srcMap p = join $ liftA2 Map.lookup (contractpayloadContract p) msrcs
          src' :: ContractPayload -> Maybe SourceMap
          src' p =
            if contractpayloadSrc p == mempty
              then Nothing
              else Just $ contractpayloadSrc p
          getSrc p = fromMaybe mempty $ src' p <|> srcMap p
          upload =
            ( \p@(ContractPayload _ c a x _) -> do
                UploadListContract
                  (fromJust c)
                  (getSrc p)
                  (fromMaybe Map.empty a)
                  (mergeTxParams x txParams)
                  Nothing
            )
              ps
      txsWithParams <- genNonces (Don't CacheNonce) addr uploadlistcontractTxParams [upload]
      forStateT Map.empty txsWithParams $
        \(UploadListContract name srcs args params _) -> do
          (src, contract) <- do
            cd <-
              fmap snd . lift $
                getContractDetailsForContract srcs (Just name) >>= \case
                  Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
                  Just x -> pure x
            at name <?= (srcs, cd)

          let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
              xabiArgs = Map.fromList . catMaybes . maybe [] (map f . _funcArgs) $ _constructor contract
          argsAsSource <- lift $ constructArgValuesAndSource (Just args) xabiArgs
          
          lift . prepareUnsignedRawTx name argsAsSource $
              TransactionHeader
                Nothing
                addr
                Nothing
                (Just name)
                argsAsSource
                "network"
                (fromMaybe emptyTxParams params)
                (Just $ Code $ serializeSourceMap src)
    FUNCTION -> do
      p <- fromFunction tx
      let mapMethodCalls = (\(FunctionPayload a m r x md) -> MethodCall a m r (mergeTxParams x txParams) md) p
      txsWithParams <- genNonces (Don't CacheNonce) addr methodcallTxParams [mapMethodCalls]
      forStateT Map.empty txsWithParams $
        \MethodCall{..} -> do
          mContract <- use $ at methodcallContractAddress
          contract <- case mContract of
            Just x -> pure x
            Nothing -> do
              mContract' <- lift $ getContractByAddress methodcallContractAddress
              x <- case mContract' of
                Nothing -> lift $ throwIO . UserError $ "Could not find contract " <> Text.pack (format methodcallContractAddress)
                Just x -> pure x
              at methodcallContractAddress <?= x
          case M.lookup (Text.unpack methodcallMethodName) (contract ^. functions) of
            Just _ -> pure ()
            Nothing -> throwIO . UserError $ "Contract doesn't have a method named '" <> methodcallMethodName <> "'"
          
          let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
              xabiArgs = Map.fromList . catMaybes . maybe [] (map f . _funcArgs) . Map.lookup (Text.unpack methodcallMethodName) $ contract ^. functions
          argsAsSource <- lift $ constructArgValuesAndSource (Just methodcallArgs) xabiArgs
          lift . prepareUnsignedRawTx methodcallMethodName argsAsSource $
            TransactionHeader
              (Just methodcallContractAddress)
              addr
              (Just methodcallMethodName)
              Nothing
              argsAsSource
              "mercata"
              (fromMaybe emptyTxParams _methodcallTxParams)
              Nothing
--              (Just $ Code $ sel <> argsBin)
  where fromTransfer = \case
          BlocTransfer t -> return t
          _ -> throwIO $ UserError "Could not decode transfer arguments from body"
        fromContract = \case
          BlocContract c -> return c
          _ -> throwIO $ UserError "Could not decode contract arguments from body"
        fromFunction = \case
          BlocFunction f -> return f
          _ -> throwIO $ UserError "Could not decode function arguments from body"

---------------------------------- REGULAR TRANSACTIONS ---------------------------------------

postBlocTransactionParallel ::
  ( MonadLogger m,
    Mod.Accessible (Maybe SyncStatus) m,
    Mod.Accessible (Maybe BestBlock) m,
    Mod.Accessible (Maybe WorldBestBlock) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    A.Selectable Address AddressState m,
    A.Selectable Address Certificate m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    m `Mod.Outputs` [IngestEvent],
    HasBlocEnv m,
    HasVault m,
    Mod.Accessible ApiContext m,
    HasSQLDB m,
    MonadCatch m
  ) =>
  Maybe Bool -> -- use_wallet
  Bool -> -- resolve
  PostBlocTransactionRequest ->
  m [BlocTransactionResult]
postBlocTransactionParallel = postBlocTransaction' (Do CacheNonce)

postBlocTransaction ::
  ( MonadLogger m,
    Mod.Accessible (Maybe SyncStatus) m,
    Mod.Accessible (Maybe BestBlock) m,
    Mod.Accessible (Maybe WorldBestBlock) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    A.Selectable Address AddressState m,
    A.Selectable Address Certificate m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    m `Mod.Outputs` [IngestEvent],
    HasBlocEnv m,
    HasVault m,
    Mod.Accessible ApiContext m,
    HasSQLDB m,
    MonadCatch m
  ) =>
  Maybe Bool -> -- use_wallet
  Bool ->
  PostBlocTransactionRequest ->
  m [BlocTransactionResult]
postBlocTransaction = postBlocTransaction' (Don't CacheNonce)

postBlocTransaction' ::
  ( MonadLogger m,
    Mod.Accessible (Maybe SyncStatus) m,
    Mod.Accessible (Maybe BestBlock) m,
    Mod.Accessible (Maybe WorldBestBlock) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    A.Selectable Address AddressState m,
    A.Selectable Address Certificate m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    m `Mod.Outputs` [IngestEvent],
    HasBlocEnv m,
    HasVault m,
    Mod.Accessible ApiContext m,
    HasSQLDB m,
    MonadCatch m
  ) =>
  Should CacheNonce ->
  Maybe Bool -> -- use_wallet
  Bool ->
  PostBlocTransactionRequest ->
  m [BlocTransactionResult]
postBlocTransaction' cacheNonce mUseWallet resolve (PostBlocTransactionRequest mAddr txs' txParams msrcs) = do
  checkIsSynced
  userRegistry <- fmap userRegistryAddress getBlocEnv
  userRegistryHash <- fmap userRegistryCodeHash getBlocEnv
  addr <- case mAddr of
    Nothing -> fromPublicKey <$> getPub
    Just addr' -> return addr'
  walletFlag <- useWalletsByDefault <$> getBlocEnv
  let useWallet = fromMaybe walletFlag mUseWallet
  userContractAddr <- if useWallet
    then do
      let err = CouldNotFind $ Text.concat
                [ "postBlocTransaction': Couldn't find common name for user address "
                , Text.pack $ formatAddressWithoutColor addr
                ]
      userCert <- maybe (throwIO err) pure =<<
        A.select (A.Proxy @Certificate) addr
      pure $ deriveAddressWithSalt (Just userRegistry) (certificateCommonName userCert) userRegistryHash (Just $ show [SMV.SString $ certificateCommonName userCert])
    else pure addr
  let src' :: ContractPayload -> Maybe SourceMap
      src' p =
        if contractpayloadSrc p == mempty
          then Nothing
          else Just $ contractpayloadSrc p
      srcMap :: ContractPayload -> Maybe SourceMap
      srcMap p = join $ liftA2 Map.lookup (contractpayloadContract p) msrcs
      getSrc p = fromMaybe mempty $ src' p <|> srcMap p
  fmap join . forM (partitionWith transactionType txs') $ \(ttype, txs) -> case ttype of
    TRANSFER -> case txs of
      [] -> return []
      [x] -> do
        p <- fromTransfer x
        let btp =
              TransferParameters
                addr
                (transferpayloadToAddress p)
                (mergeTxParams (transferpayloadTxParams p) txParams)
                (transferpayloadMetadata p)
                resolve
        fmap (:[]) $ postUsersSend' cacheNonce btp
      xs -> do
        p <- mapM fromTransfer xs
        let btlp =
              TransferListParameters
                addr
                (map (\(TransferPayload t x m) -> SendTransaction t (mergeTxParams x txParams) m) p)
                resolve
        postUsersSendList' cacheNonce btlp
    CONTRACT -> case txs of
      [] -> return []
      [x] -> do
        p <- fromContract x
        let md = contractpayloadMetadata p
            cn = fromMaybe "unnamed_contract" (contractpayloadContract p)
        case useWallet of
          True -> do
            let contractSrc = getSrc p
                contractSrcText = sourceBlob $ contractSrc
                srcLength = Text.length contractSrcText
                contractArgs = contractpayloadArgs p
                contractName' = contractpayloadContract p
                metadata = Map.fromList [("history", cn), ("useWallet", Text.pack "true"), ("srcLength", Text.pack $ show srcLength)]

            (_, Contract {..}) <-
              getContractDetailsForContract contractSrc contractName' >>= \case
                Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
                Just x' -> pure x'

            let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
                xabiArgs = Map.fromList . catMaybes $ maybe [] (map f . _funcArgs) _constructor
            argsAsSource <- constructArgValuesAndSource contractArgs xabiArgs

            let bcp =
                  FunctionParameters
                    addr
                    userContractAddr
                    "createContract"
                    (M.fromList $ [("contractName", ArgString cn), ("contractSrc", ArgString $ contractSrcText), ("args", ArgString $ "(" <> Text.intercalate "," argsAsSource <> ")")])
                    (mergeTxParams (contractpayloadTxParams p) txParams)
                    (maybe (Just metadata) (\m -> Just $ metadata `Map.union` m) md)
                    resolve
            fmap (:[]) $ postUsersContractMethod' cacheNonce bcp
          False -> do
            let bcp =
                  ContractParameters
                    addr
                    (getSrc p)
                    (contractpayloadContract p)
                    (contractpayloadArgs p)
                    (mergeTxParams (contractpayloadTxParams p) txParams)
                    -- History tables are always enabled. 'contractpayloadContract p' should
                    -- always return a name but in the case that it doesn't it will go in the
                    -- history table unnamed.
                    ( case md of
                        Nothing -> Just $ Map.insert "VM" "SolidVM" (Map.singleton "history" cn)
                        Just m -> Just $ Map.insert "VM" "SolidVM" (Map.insert "history" cn m)
                    )
                    resolve
            fmap (:[]) $ postUsersContractSolidVM' cacheNonce bcp
      xs -> do
        ps <- mapM fromContract xs
        case useWallet of
          True -> do
            methodList <- mapM (\p@(ContractPayload _ c a x m) -> do
                              let contractSrc = getSrc p
                                  contractSrcText = sourceBlob $ contractSrc
                                  srcLength = Text.length contractSrcText
                                  cn = fromMaybe "unnamed_contract" c
                                  metadata = Map.fromList [("history", cn), ("useWallet", Text.pack "true"), ("srcLength", Text.pack $ show srcLength)]
                              (_, Contract {..}) <-
                                getContractDetailsForContract contractSrc c >>= \case
                                  Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
                                  Just x' -> pure x'

                              let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
                                  xabiArgs = Map.fromList . catMaybes $ maybe [] (map f . _funcArgs) _constructor
                              argsAsSource <- constructArgValuesAndSource a xabiArgs
                              pure $ MethodCall 
                                userContractAddr 
                                "createContract"  
                                (M.fromList $ [("contractName", ArgString cn), ("contractSrc", ArgString $ sourceBlob $ contractSrc), ("args", ArgString $ "(" <> Text.intercalate "," argsAsSource <> ")")])
                                (mergeTxParams x txParams) 
                                (maybe (Just metadata) (\m' -> Just $ metadata `Map.union` m') m)
                          ) ps
            let bcp = 
                  FunctionListParameters
                    addr
                    methodList
                    resolve
            postUsersContractMethodList' cacheNonce bcp
          False -> do
            payloadList <-
              mapM
                  ( \p@(ContractPayload _ c a x m) -> do
                      let cn = fromMaybe "unnamed_contract" c
                      return $
                        UploadListContract
                          (fromJust c)
                          (getSrc p)
                          (fromMaybe Map.empty a)
                          (mergeTxParams x txParams)
                          ( case m of
                              Nothing -> Just $ Map.insert "VM" "SolidVM" (Map.singleton "history" cn)
                              Just h -> Just $ Map.insert "VM" "SolidVM" (Map.insert "history" cn h)
                          )
                  )
                  ps
            let bclp = 
                  ContractListParameters
                    addr
                    payloadList
                    resolve
                poster = postUsersUploadListSolidVM'
            poster cacheNonce bclp
    FUNCTION -> case txs of
      [] -> return []
      [x] -> do
        p <- fromFunction x
        let bfp = FunctionParameters
                    addr
                    (functionpayloadContractAddress p)
                    (functionpayloadMethod p)
                    (functionpayloadArgs p)
                    (mergeTxParams (functionpayloadTxParams p) txParams)
                    (functionpayloadMetadata p)
                    resolve
        let bfpWallet = FunctionParameters
                    addr
                    userContractAddr
                    "callContract"
                    (M.fromList $ [("contractToCall",ArgString $ Text.pack $ show $ functionpayloadContractAddress p), ("functionName",ArgString $ functionpayloadMethod p), ("args", ArgArray $ V.fromList $ M.elems $ functionpayloadArgs p)])
                    (mergeTxParams (functionpayloadTxParams p) txParams)
                    (functionpayloadMetadata p)
                    resolve
        let bfp' = bool bfp bfpWallet useWallet
        fmap (:[]) $ postUsersContractMethod' cacheNonce bfp'
      xs -> do
        p <- mapM fromFunction xs
        let bflp = FunctionListParameters
                    addr
                    (map (\(FunctionPayload a m r x md) ->
                      MethodCall a m r (mergeTxParams x txParams) md) p)
                    resolve
        let bflpWallet = FunctionListParameters
                    addr
                    (map (\(FunctionPayload a m r x md) ->
                            MethodCall 
                              userContractAddr 
                              "callContract"  
                              (M.fromList $ [("contractToCall",ArgString $ Text.pack $ show a), ("functionName",ArgString m), ("args", ArgArray $ V.fromList $ M.elems r)])
                              (mergeTxParams x txParams) 
                              md
                          ) p)
                    resolve
        let bflp' = bool bflp bflpWallet useWallet
        postUsersContractMethodList' cacheNonce bflp'
  where
    fromTransfer = \case
      BlocTransfer t -> return t
      _ -> throwIO $ UserError "Could not decode transfer arguments from body"
    fromContract = \case
      BlocContract c -> return c
      _ -> throwIO $ UserError "Could not decode contract arguments from body"
    fromFunction = \case
      BlocFunction f -> return f
      _ -> throwIO $ UserError "Could not decode function arguments from body"

callSignature ::
  (MonadIO m, HasVault m) =>
  Transaction ->
  m Transaction
callSignature unsigned = do
  let msgHash = keccak256ToByteString $ partialTransactionHash unsigned
  sig <- sign msgHash
  let (r, s, v) = getSigVals sig
  return $ unsigned{transactionV = fromIntegral v, transactionR = fromIntegral r, transactionS = fromIntegral s}

------------------------------------------------------------------

data TransactionHeader = TransactionHeader
  { transactionheaderToAddr :: Maybe Address,
    transactionheaderFromAddr :: Address,
    transactionheaderFuncName :: Maybe Text,
    transactionheaderContractName :: Maybe Text,
    transactionheaderArgs :: [Text],
    transactionheaderNetwork :: Text,
    transactionheaderTxParams :: TxParams,
    transactionheaderCode :: Maybe Code
  }



{-
    nonce Integer sqltype=numeric(1000,0)
    gasLimit Integer sqltype=numeric(1000,0)
    toAddress Address Maybe
    funcName Text Maybe
    contractName Text Maybe
    args [Text]
    network Text
    code Code Maybe
    r Integer
    s Integer
    v Word8
    blockNumber Int
    txHash Keccak256
    origin TXOrigin
    UniqueTXHash txHash
    deriving Eq Generic Read Show
-}

postUsersSend' ::
  ( A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    m `Mod.Outputs` [IngestEvent],
    MonadLogger m,
    HasBlocEnv m,
    HasVault m,
    Mod.Accessible ApiContext m,
    HasSQLDB m,
    MonadCatch m
  ) =>
  Should CacheNonce ->
  TransferParameters ->
  m BlocTransactionResult
postUsersSend' cacheNonce TransferParameters {..} = do
  params <- getAccountTxParams cacheNonce fromAddress txParams
  txSizeLimit <- fmap txSizeLimit getBlocEnv
  tx <-
    signAndPrepare fromAddress $
      TransactionHeader
        (Just toAddress)
        fromAddress
        Nothing
        Nothing
        []
        "mercata"
        params
        (Just $ Code "")
  txHash <- postTransaction (Just txSizeLimit) tx
  getResultAndRespond [txHash] resolve

postUsersContractSolidVM' ::
  ( MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Address AddressState m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    m `Mod.Outputs` [IngestEvent],
    HasCodeDB m,
    HasBlocEnv m,
    HasVault m,
    Mod.Accessible ApiContext m,
    HasSQLDB m,
    MonadCatch m
  ) =>
  Should CacheNonce ->
  ContractParameters ->
  m BlocTransactionResult
postUsersContractSolidVM' cacheNonce ContractParameters {..} = do
  params <- getAccountTxParams cacheNonce fromAddr txParams
  txSizeLimit <- fmap txSizeLimit getBlocEnv
  --We might be able to get rid of the metadata for SolidVM, but that will require a change in the API, and needs to be discussed
  $logInfoLS "postUsersContractSolidVM'/args" args
  (_, Contract {..}) <-
    getContractDetailsForContract src contract >>= \case
      Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
      Just x -> pure x

  let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
      xabiArgs = Map.fromList . catMaybes $ maybe [] (map f . _funcArgs) _constructor
  argsAsSource <- constructArgValuesAndSource args xabiArgs

  tx <-
    signAndPrepare fromAddr $
      TransactionHeader
        Nothing
        fromAddr
        Nothing
        (Just $ Text.pack _contractName)
        argsAsSource
        "mercata"
        params
        (Just $ Code $ serializeSourceMap src)
        -- (Code $ Text.encodeUtf8 $ serializeSourceMap src)
  $logDebugLS "postUsersContractSolidVM'/tx" tx

  txHash <- postTransaction (Just txSizeLimit) tx
  $logInfoLS "postUsersContractSolidVM'/hash" txHash
  getResultAndRespond [txHash] resolve

postUsersUploadListSolidVM' ::
  ( MonadUnliftIO m,
    MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Address AddressState m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    m `Mod.Outputs` [IngestEvent],
    HasCodeDB m,
    HasBlocEnv m,
    HasVault m
  ) =>
  Should CacheNonce ->
  ContractListParameters ->
  m [BlocTransactionResult]
postUsersUploadListSolidVM' cacheNonce ContractListParameters {..} = do
  txSizeLimit <- fmap txSizeLimit getBlocEnv
  txsWithParams <- genNonces cacheNonce fromAddr uploadlistcontractTxParams contracts
  namesTxs <- forStateT Map.empty txsWithParams $
    \(UploadListContract name srcs args params _) -> do
      (src, contract) <- do
        cd <-
          fmap snd . lift $
            getContractDetailsForContract srcs (Just name) >>= \case
              Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
              Just x -> pure x
        at name <?= (srcs, cd)

      let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
          xabiArgs = Map.fromList . catMaybes . maybe [] (map f . _funcArgs) $ _constructor contract
      argsAsSource <- lift $ constructArgValuesAndSource (Just args) xabiArgs
      
      tx <-
        lift . signAndPrepare fromAddr $
          TransactionHeader
            Nothing
            fromAddr
            Nothing
            (Just name)
            argsAsSource
            "mercata"
            (fromMaybe emptyTxParams params)
            (Just $ Code $ serializeSourceMap src)
      return (name, tx)
  let txs = map snd namesTxs
  hashes <- postTransactionList (Just txSizeLimit) txs
  getBatchBlocTransactionResult' hashes resolve

postUsersSendList' ::
  ( MonadUnliftIO m,
    MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    m `Mod.Outputs` [IngestEvent],
    HasBlocEnv m,
    HasVault m
  ) =>
  Should CacheNonce ->
  TransferListParameters ->
  m [BlocTransactionResult]
postUsersSendList' cacheNonce TransferListParameters {..} = do
  txsWithParams <- genNonces cacheNonce fromAddr sendtransactionTxParams txs
  txSizeLimit <- fmap txSizeLimit getBlocEnv
  txs'' <-
    mapM
      ( \(SendTransaction toAddr params _) -> do
          let header =
                TransactionHeader
                  (Just toAddr)
                  fromAddr
                  Nothing
                  Nothing
                  []
                  "mercata"
                  (fromMaybe emptyTxParams params)
                  (Just $ Code "")
          signAndPrepare fromAddr header
      )
      txsWithParams
  hashes <- postTransactionList (Just txSizeLimit) txs''
  getBatchBlocTransactionResult' hashes resolve

postUsersContractMethodList' ::
  ( MonadUnliftIO m,
    MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    A.Selectable Address AddressState m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    m `Mod.Outputs` [IngestEvent],
    HasBlocEnv m,
    HasVault m
  ) =>
  Should CacheNonce ->
  FunctionListParameters ->
  m [BlocTransactionResult]
postUsersContractMethodList' cacheNonce FunctionListParameters {..} = do
  if null txs
    then return []
    else do
      txsWithParams <- genNonces cacheNonce fromAddr methodcallTxParams txs
      txSizeLimit <- fmap txSizeLimit getBlocEnv
      txsFuncNames <- forStateT Map.empty txsWithParams $
        \(MethodCall {..}) -> do
          mContract <- use $ at methodcallContractAddress
          contract <- case mContract of
            Just x -> pure x
            Nothing -> do
              mContract' <- lift $ getContractByAddress methodcallContractAddress
              x <- case mContract' of
                Nothing -> lift $ throwIO . UserError $ "Could not find contract " <> Text.pack (show methodcallContractAddress)
                Just x -> pure x
              at methodcallContractAddress <?= x
          case M.lookup (Text.unpack methodcallMethodName) (contract ^. functions) of
            Just _ -> pure ()
            Nothing -> throwIO . UserError $ "Contract doesn't have a method named '" <> methodcallMethodName <> "'"

          let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
              xabiArgs = Map.fromList . catMaybes . maybe [] (map f . _funcArgs) . Map.lookup (Text.unpack methodcallMethodName) $ contract ^. functions
          argsAsSource <- lift $ constructArgValuesAndSource (Just methodcallArgs) xabiArgs
          tx <- lift . signAndPrepare fromAddr $
            TransactionHeader
              (Just methodcallContractAddress)
              fromAddr
              (Just methodcallMethodName)
              Nothing
              argsAsSource
              "mercata"
              (fromMaybe emptyTxParams _methodcallTxParams)
              Nothing
--              (Just $ Code $ sel <> argsBin)
          -- resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
          return (tx, methodcallMethodName)
      let finalTxs = fst <$> txsFuncNames
      mapM_ ($logDebugLS "postUsersContractMethodList'/txs") finalTxs
      hashes <- postTransactionList (Just txSizeLimit) finalTxs
      mapM_ ($logInfoLS "postUsersContractMethodList'/hashes") hashes
      getBatchBlocTransactionResult' hashes resolve

postUsersContractMethod' ::
  ( MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    A.Selectable Address AddressState m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    m `Mod.Outputs` [IngestEvent],
    HasBlocEnv m,
    HasVault m,
    Mod.Accessible ApiContext m,
    HasSQLDB m,
    MonadCatch m
  ) =>
  Should CacheNonce ->
  FunctionParameters ->
  m BlocTransactionResult
postUsersContractMethod' cacheNonce FunctionParameters {..} = do
  params <- getAccountTxParams cacheNonce fromAddr txParams
  txSizeLimit <- fmap txSizeLimit getBlocEnv

  let err =
        CouldNotFind $
          Text.concat
            [ "postUsersContractMethod': Couldn't find contract details for contract at address ",
              Text.pack $ formatAddressWithoutColor contractAddr
            ]
  contract <-
    maybe (throwIO err) pure
      =<< getContractByAddress contractAddr
  case M.lookup (Text.unpack funcName) (contract ^. functions) of
    Just _ -> pure ()
    Nothing -> throwIO . UserError $ "Contract doesn't have a method named '" <> funcName <> "'"

  let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
      xabiArgs = Map.fromList . catMaybes . maybe [] (map f . _funcArgs) . Map.lookup (Text.unpack funcName) $ contract ^. functions
  argsAsSource <- constructArgValuesAndSource (Just args) xabiArgs

  let network = "mercata"

  tx <-
    signAndPrepare fromAddr $
      TransactionHeader
        (Just contractAddr)
        fromAddr
        (Just funcName)
        Nothing
        argsAsSource
        network
        params
        Nothing
--        (Just $ Code $ (sel::ByteString) <> (argsBin::ByteString))

  $logDebugLS "postUsersContractMethod'/tx" tx
  txHash <- postTransaction (Just txSizeLimit) tx
  $logInfoLS "postUsersContractMethod'/hash" txHash
  getResultAndRespond [txHash] resolve

prepareUnsignedTx :: Integer -> TransactionHeader -> Transaction
prepareUnsignedTx gasLimit TransactionHeader {..} =
  case transactionheaderToAddr of
    Nothing ->
      ContractCreationTX
      { transactionNonce = fromIntegral $ fromMaybe 0 (txparamsNonce transactionheaderTxParams),
        transactionGasLimit = fromIntegral $ fromMaybe (Gas gasLimit) (txparamsGasLimit transactionheaderTxParams),
        transactionContractName = fromMaybe (error "prepareUnsignedTx: contractName missing in ContractCreationTX") transactionheaderContractName,
        transactionArgs = transactionheaderArgs,
        transactionNetwork = transactionheaderNetwork,
        transactionCode = fromMaybe (error "prepareUnsignedTx: code missing in ContractCreationTX") transactionheaderCode,
        transactionR = 0,
        transactionS = 0,
        transactionV = 0
      }
    Just _ ->
      MessageTX
      { transactionNonce = fromIntegral $ fromMaybe 0 (txparamsNonce transactionheaderTxParams),
        transactionGasLimit = fromIntegral $ fromMaybe (Gas gasLimit) (txparamsGasLimit transactionheaderTxParams),
        transactionTo = fromMaybe (error "prepareUnsignedTx: transactionTo missing in MessageTX") transactionheaderToAddr,
        transactionFuncName = fromMaybe (error "prepareUnsignedTx: funcName missing in MessageTX") transactionheaderFuncName,
        transactionArgs = transactionheaderArgs,
        transactionNetwork = transactionheaderNetwork,
        transactionR = 0,
        transactionS = 0,
        transactionV = 0
      }

preparePostTx ::
  UTCTime ->
  Address ->
  Transaction ->
  RawTransaction'
preparePostTx time _ tx =
  flip RawTransaction' "" $
    txAndTime2RawTX API tx 0 time

preparePostUnsignedRawTx ::
  UTCTime ->
  Transaction ->
  Text ->
  [Text] ->
  UnsignedRawTransaction'
preparePostUnsignedRawTx time tx contractName' args =
  UnsignedRawTransaction' $
    RawTransaction
      time
      (Address 0)
      (fromIntegral nonce')
      (fromIntegral gasLimit)
      (Just toAddr)
      (Just $ transactionFuncName tx)
      (Just contractName')
      args
      network
      (Just $ transactionCode tx)
      0
      0
      0
      0
      zeroHash
      API
  where
    gasLimit = transactionGasLimit tx
    network = transactionNetwork tx
    nonce' = transactionNonce tx
    toAddr = transactionTo tx

signAndPrepare ::
  (MonadIO m, HasVault m, HasBlocEnv m) =>
  Address ->
  TransactionHeader ->
  m RawTransaction'
signAndPrepare from th = do
  gasLimit <- fmap gasLimit getBlocEnv
  time <- liftIO getCurrentTime
  fmap (preparePostTx time from) . callSignature $ prepareUnsignedTx gasLimit th

prepareUnsignedRawTx ::
  (MonadIO m, HasBlocEnv m) =>
  Text ->
  [Text] ->
  TransactionHeader ->
  m BlocTransactionUnsignedResult
prepareUnsignedRawTx contractName' args th = do
  gasLimit <- fmap gasLimit getBlocEnv
  time <- liftIO getCurrentTime
  let unsigned = prepareUnsignedTx gasLimit th
      msgHash = unsafeCreateKeccak256FromByteString $ keccak256ToByteString $ partialTransactionHash unsigned
      unsignedRawTx = preparePostUnsignedRawTx time unsigned contractName' args
  pure $ BlocTransactionUnsignedResult msgHash (Just unsignedRawTx)

constructArgValuesAndSource ::
  (MonadIO m, MonadLogger m) =>
  Maybe (Map Text ArgValue) ->
  Map Text Xabi.IndexedType ->
  m [Text]
constructArgValuesAndSource args argNamesTypes = do
  case args of
    Nothing ->
      if Map.null argNamesTypes
        then return []
        else throwIO (UserError "no arguments provided to function.")
    Just argsMap -> concatMap valueToTexts <$> getArgValues argsMap argNamesTypes

getAccountTxParams ::
  ( MonadIO m
  , MonadLogger m
  , HasBlocEnv m
  , A.Selectable AccountsFilterParams [AddressStateRef] m
  ) =>
  Should CacheNonce ->
  Address ->
  Maybe TxParams ->
  m TxParams
getAccountTxParams cacheNonce addr mTxParams = do
  let params = fromMaybe emptyTxParams mTxParams
      cacheKey = addr
  nonceCache <- fmap globalNonceCounter getBlocEnv
  now <- liftIO $ getTime Monotonic
  mCachedNonce <- case cacheNonce of
    Do CacheNonce -> atomically $ cacheLookup nonceCache now cacheKey
    Don't CacheNonce -> pure Nothing
  theNonce <- case mCachedNonce of
    Just n -> pure n
    Nothing -> getAccountNonce addr
  liftIO . atomically $ do
    now' <- Cache.nowSTM
    mmNonce <- cacheLookup nonceCache now' cacheKey
    let mNonce = case cacheNonce of
          Do CacheNonce -> mmNonce
          Don't CacheNonce -> Nothing
        sNonce = Just theNonce
        maxNonce = liftA2 max mNonce sNonce
        newNonce = fromMaybe 0 $ txparamsNonce params <|> maxNonce <|> mNonce <|> sNonce
        expTime = (now' +) <$> Cache.defaultExpiration nonceCache
    Cache.insertSTM cacheKey (newNonce + 1) nonceCache expTime
    pure params {txparamsNonce = Just newNonce}

cacheLookup ::
  (Hashable k) =>
  Cache.Cache k v ->
  TimeSpec ->
  k ->
  STM (Maybe v)
cacheLookup c t k = do
  Cache.purgeExpiredSTM c t
  Cache.lookupSTM True k c t

genNonces :: forall a m.
  ( MonadIO m
  , MonadLogger m
  , HasBlocEnv m
  , A.Selectable AccountsFilterParams [AddressStateRef] m
  , Show a
  ) =>
  Should CacheNonce ->
  Address ->
  Lens' a (Maybe TxParams) ->
  [a] ->
  m [a]
genNonces cacheNonce fromAddr l items = do
  let cacheKey :: Address
      cacheKey = fromAddr
      viewNonce :: a -> Maybe Nonce
      viewNonce = txparamsNonce <=< view l
      
  nonceCache <- fmap globalNonceCounter getBlocEnv
  now <- liftIO $ getTime Monotonic
  cachedItem <- case cacheNonce of
                  Do CacheNonce -> atomically $ cacheLookup nonceCache now cacheKey
                  Don't CacheNonce -> pure $ Nothing

  (sNonce :: Maybe Nonce) <-
    case cachedItem of
      Nothing -> fmap Just $ getAccountNonce fromAddr
      Just val -> return $ Just val

  liftIO . atomically $ do
      let noncesInUse = S.fromList $ mapMaybe (viewNonce) items
      now' <- Cache.nowSTM
      nonce <-
        if S.size noncesInUse == length items
          then
            pure . Nonce . error $
              "internal error: unused nonce when already specified " ++ show items
          else do
            mmNonce <- cacheLookup nonceCache now' fromAddr
            let mNonce = case cacheNonce of
                  Do CacheNonce -> mmNonce
                  Don't CacheNonce -> Nothing
            pure . fromMaybe 0 $ liftA2 max mNonce sNonce <|> mNonce <|> sNonce
      let txs = runIdentity . forStateT nonce items $ \a -> do
            let params' = fromMaybe emptyTxParams (a ^. l)
            newNonce <- case txparamsNonce params' of
              Just v -> return v
              Nothing -> do
                whileM $ do
                  inUse <- gets (`S.member` noncesInUse)
                  when inUse $ id += 1
                  return inUse
                id <<+= 1
            return $ (l .~ Just params' {txparamsNonce = Just newNonce}) a
          newCachedNonce = 1 + getMax (foldMap (Max . fromMaybe 0 . viewNonce) txs)
          expTime = (now' +) <$> Cache.defaultExpiration nonceCache
      Cache.insertSTM fromAddr newCachedNonce nonceCache expTime
      pure txs

getAccountNonce ::
  ( MonadIO m
  , MonadLogger m
  , A.Selectable AccountsFilterParams [AddressStateRef] m
  )
  => Address -> m Nonce
getAccountNonce addr = do
  mAccts <- getAccount' accountsFilterParams{_qaAddress = Just addr}
  $logInfoLS "getAccountNonce lookup" addr
  $logInfoLS "getAccountNonce results" mAccts
  case mAccts of
    [] -> return $ Nonce $ fromInteger 0
    [act] -> do
      let mkNonce (AddressStateRef' AddressStateRef{..} _) = Nonce $ fromInteger addressStateRefNonce
      return $ mkNonce act
    _ -> error "returned more than one account with a single address in getAccountNonce"
{-
constructArgValues ::
  (MonadIO m, MonadLogger m) =>
  Maybe (Map Text ArgValue) ->
  Map Text Xabi.IndexedType ->
  m ByteString
constructArgValues args argNamesTypes = do
  case args of
    Nothing ->
      if Map.null argNamesTypes
        then return ByteString.empty
        else throwIO (UserError "no arguments provided to function.")
    Just argsMap -> do
      vals <- getArgValues argsMap argNamesTypes
      return $ toStorage (ValueArrayFixed (fromIntegral (length vals)) vals)
-}
getArgValues ::
  (MonadIO m, MonadLogger m) =>
  Map Text ArgValue ->
  Map Text Xabi.IndexedType ->
  m [Value]
getArgValues argsMap argNamesTypes = do
  argsVals <-
    if not (Map.keysSet argNamesTypes `isSubsetOf` Map.keysSet argsMap)
      then do
        let argNames1 = "(" <> Text.intercalate ", " (Map.keys argNamesTypes) <> ")"
            argNames2 = "(" <> Text.intercalate ", " (Map.keys argsMap) <> ")"
        throwIO (UserError ("Argument names don't match - Expected Arguments: " <> argNames1 <> "; Received Arguments: " <> argNames2))
      else sequence $ Map.intersectionWith determineValue argsMap argNamesTypes
  return $ map snd (sortOn fst (toList argsVals))

determineValue :: (MonadIO m, MonadLogger m) => ArgValue -> Xabi.IndexedType -> m (Int32, Value)
determineValue argVal (Xabi.IndexedType ix xabiType) =
  let typeM = getSolidityType argVal xabiType
   in do
        ty <- either (blocError . UserError) return typeM
        either (blocError . UserError) (return . (ix,)) (argValueToValue Nothing ty argVal)

getSolidityType :: ArgValue -> Xabi.Type -> Either Text Type
getSolidityType _ (Xabi.Int (Just True) b) = Right . SimpleType . TypeInt True $ fmap toInteger b
getSolidityType _ (Xabi.Int _ b) = Right . SimpleType . TypeInt False $ fmap toInteger b
getSolidityType _ (Xabi.String _) = Right . SimpleType $ TypeString
getSolidityType _ (Xabi.Bytes _ b) = Right . SimpleType . TypeBytes $ fmap toInteger b
getSolidityType _ Xabi.Bool = Right . SimpleType $ TypeBool
getSolidityType _ Xabi.Address = Right . SimpleType $ TypeAddress
getSolidityType _ Xabi.Account = Right . SimpleType $ TypeAccount
getSolidityType _ (Xabi.Struct _ name) = Right $ TypeStruct name
getSolidityType _ (Xabi.Enum _ name _) = Right $ TypeEnum name
getSolidityType _ (Xabi.Contract name) = Right $ TypeContract name
getSolidityType (ArgInt _) (Xabi.UnknownLabel _) = Right $ SimpleType typeUInt -- since Enums are converted to Ints
getSolidityType (ArgString _) (Xabi.UnknownLabel s) = Right $ TypeEnum $ Text.pack s
getSolidityType (ArgObject _) (Xabi.UnknownLabel s) = Right $ TypeStruct $ Text.pack s --interpret an object strictly as a struct
getSolidityType av (Xabi.UnknownLabel _) = Left $ Text.pack $ "Expected a string, int, or object, but recieved: " ++ show av
getSolidityType (ArgArray v) (Xabi.Array typ len) =
  let arrType = case len of
        Just l -> TypeArrayFixed l
        Nothing -> TypeArrayDynamic
      elType = getSolidityType (V.head v) typ
   in case elType of
        Right c -> Right (arrType c)
        e -> e
getSolidityType av (Xabi.Array _ _) = Left $ Text.pack $ "Expected Array but got " ++ show av
getSolidityType (ArgObject _) Xabi.Mapping {} = Right $ TypeStruct "s"
getSolidityType av Xabi.Mapping {} = Left $ Text.pack $ "Expected Object for Mapping type, but got " ++ show av
getSolidityType _ Xabi.Variadic = Right $ TypeVariadic
getSolidityType _ Xabi.Decimal = Right . SimpleType $ TypeDecimal

getResultAndRespond ::
  ( MonadUnliftIO m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Keccak256 [TransactionResult] m,
    A.Selectable TxsFilterParams [RawTransaction] m,
    MonadLogger m
  ) =>
  [Keccak256] ->
  Bool ->
  m BlocTransactionResult
getResultAndRespond txHashes resolve = do
  result <- getBlocTransactionResult' txHashes resolve
  case (blocTransactionStatus result, blocTransactionTxResult result, resolve) of
    (Success, _, _) -> return result
    (Failure, Nothing, _) -> throwIO (VMError "unknown reason")
    (Failure, Just tr, _) -> throwIO (VMError $ Text.pack $ "Error running the transaction: " ++ transactionResultMessage tr)
    (Pending, _, _) -> return result

checkIsSynced ::
  ( Mod.Accessible (Maybe SyncStatus) m
  , Mod.Accessible (Maybe BestBlock) m
  , Mod.Accessible (Maybe WorldBestBlock) m
  , MonadUnliftIO m
  ) => m ()
checkIsSynced = do
  status <- Mod.access (Mod.Proxy @(Maybe SyncStatus))
  nodeBestBlock <- Mod.access (Mod.Proxy @(Maybe BestBlock))
  worldBestBlock <- Mod.access (Mod.Proxy @(Maybe WorldBestBlock))
  let nodeNumber = bestBlockNumber <$> nodeBestBlock
      worldNumber = bestBlockNumber . unWorldBestBlock <$> worldBestBlock

  case (status, worldNumber, nodeNumber) of
    (Just (SyncStatus False), Just wtd, Just ntd) -> throwIO $ NotYetSynced ntd wtd
    _ -> pure ()
