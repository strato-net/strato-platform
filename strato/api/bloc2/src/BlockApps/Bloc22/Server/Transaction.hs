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

module BlockApps.Bloc22.Server.Transaction (
  postBlocTransaction,
  postBlocTransactionRaw,
  postBlocTransactionParallel,
  ) where


import           Control.Applicative               ((<|>), liftA2)
import           Control.Arrow
import           Control.Lens                      hiding (from, ix)
import           Control.Monad
import qualified Control.Monad.Change.Alter        as A
import           Control.Monad.Extra
import           Control.Monad.Reader
import           Control.Monad.Trans.State.Lazy
import qualified Crypto.Secp256k1                  as S
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Base16            as Base16
import qualified Data.ByteString.Short             as BSS
import qualified Data.Cache                        as Cache
import qualified Data.Cache.Internal               as Cache
import           Data.Conduit
import           Data.Conduit.TQueue
import           Data.Foldable
import           Data.Hashable                     hiding (hash)
import           Data.Int                          (Int32)
import           Data.List                         (partition, sortOn)
import qualified Data.Vector                       as V

import qualified Data.Map.Ordered                  as OMap
import           Data.Map.Strict                   (Map)
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.RLP
import           Data.Semigroup                    (Max(..))
import           Data.Set                          (isSubsetOf)
import qualified Data.Set                          as S
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Time.Clock
import           Data.Word
import qualified Database.Esqueleto                as E
import qualified Blockchain.DB.SQLDB               as SQLDB
import           System.Clock
import           UnliftIO


import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.TypeWrappers
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries  (getContractDetailsForContract)
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Chain
import           BlockApps.Bloc22.Server.TransactionResult     hiding (constructArgValuesAndSource)
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.Logging
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract()
import qualified BlockApps.Solidity.Contract       as C
import           BlockApps.Solidity.Storage
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Type      as Xabi
import           BlockApps.XAbiConverter
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.Data.TXOrigin
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address  hiding (unAddress)
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.ExtendedWord   (Word256, word256ToBytes)
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Keccak256  hiding (rlpHash)
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Secp256k1      hiding (HasVault)
import           Data.Source.Map
import           Blockchain.Strato.Model.Wei
import           Blockchain.Strato.RedisBlockDB         (runStratoRedisIO, getWorldBestBlockInfo, getBestBlockInfo, getSyncStatus)

import           Control.Monad.Composable.BlocSQL

import           Control.Monad.Composable.SQL
import           Control.Monad.Composable.Vault

import           Blockchain.Strato.RedisBlockDB.Models  (RedisBestBlock(..))

import           Handlers.AccountInfo()
import           Handlers.Transaction

import           Strato.Strato23.Client
import           Strato.Strato23.API.Types
import           SQLM

mergeTxParams :: Maybe TxParams -> Maybe TxParams -> Maybe TxParams
mergeTxParams (Just inner) (Just outer) = Just $
  TxParams (txparamsGasLimit inner <|> txparamsGasLimit outer)
           (txparamsGasPrice inner <|> txparamsGasPrice outer)
           (txparamsNonce inner <|> txparamsNonce outer)
mergeTxParams inner outer = inner <|> outer

txWorker :: ( MonadLogger m
            , A.Selectable Account ContractDetails m
            , A.Selectable Account AddressState m
            , (Keccak256 `A.Alters` SourceMap) m
            , HasBlocEnv m
            , HasBlocSQL m
            , HasVault m
            , HasSQL m
            )
         => m ()
txWorker = forever $ do
  tbqueue <- fmap txTBQueue getBlocEnv
  e <- try . runConduit $ sourceTBQueue tbqueue .| processTxs
  case e of
    Left (ex :: SomeException) -> $logErrorS "txWorker/error" . Text.pack $ show ex
    Right () -> error "txWorker returned a Right (). This should never happen. Please contact Simon Peyton Jones."
  where processTxs = awaitForever $ \(a,b,r,c) ->
          lift . void $ postBlocTransaction' (Do CacheNonce) a b r c



--------------------------------- RAW (PRE-SIGNED) TRANSACTIONS ------------------------------------

postBlocTransactionRaw :: (MonadLogger m, HasSQL m) =>
                          Maybe Text     -- username (unused)
                       -> Maybe ChainId  
                       -> Bool           -- resolve
                       -> PostBlocTransactionRawRequest
                       -> m BlocChainOrTransactionResult
postBlocTransactionRaw _ _ resolve PostBlocTransactionRawRequest{..} = do
  checkIsSynced
  -- as a requirement for Pepsi, we have to be able to accept non-rec sigs
  -- so, if 'v' is not provided, we have to figure out what 'v' is here

  v <- case postbloctransactionrawrequestV of 
        Just v' -> return v'
        Nothing -> do
          let makeSigFromVals :: (Word256, Word256, Word8) -> Signature
              makeSigFromVals (r', s', v') = Signature 
                (S.CompactRecSig
                  (BSS.toShort $ word256ToBytes r')
                  (BSS.toShort $ word256ToBytes s')
                  (v' - 0x1b))
              unsignedTX = UnsignedTransaction
                postbloctransactionrawrequestNonce
                postbloctransactionrawrequestGasPrice
                postbloctransactionrawrequestGasLimit
                postbloctransactionrawrequestTo
                postbloctransactionrawrequestValue
                postbloctransactionrawrequestInitOrData
                postbloctransactionrawrequestChainId
              txHash = rlpHash unsignedTX
          
          -- try both 27 and 28, see what matches
              sig1 = makeSigFromVals (postbloctransactionrawrequestR, postbloctransactionrawrequestS, 27)
              address1 = fromMaybe (Address 0x0) $ fmap fromPublicKey $ recoverPub sig1 txHash 
              sig2 = makeSigFromVals (postbloctransactionrawrequestR, postbloctransactionrawrequestS, 28)
              address2 = fromMaybe (Address 0x0) $ fmap fromPublicKey $ recoverPub sig2 txHash
          if address1 == postbloctransactionrawrequestAddress
            then return 27
          else if address2 == postbloctransactionrawrequestAddress
            then return 28
          else
            throwIO $ UserError $ Text.pack "Couldn't calculate 'v' for transaction signature - must be a bad signature"
  
  -- construct the Transaction
  time <- liftIO getCurrentTime
  let tx = Transaction
               postbloctransactionrawrequestNonce
               postbloctransactionrawrequestGasPrice
               postbloctransactionrawrequestGasLimit
               postbloctransactionrawrequestTo
               postbloctransactionrawrequestValue
               postbloctransactionrawrequestInitOrData
               postbloctransactionrawrequestChainId
               v
               postbloctransactionrawrequestR
               postbloctransactionrawrequestS
               postbloctransactionrawrequestMetadata
      rawTx = preparePostTx time postbloctransactionrawrequestAddress tx

  txHash <- postTransaction rawTx
  
  

  trds <- recurseTRDs resolve [txHash]
  case trds of
    [] -> throwIO $ AnError $ Text.pack "empty TRD response, which shouldn't happen"
    [x] -> return $ BlocTxResult $ BlocTransactionResult 
              { blocTransactionStatus   = trdStatus x
              , blocTransactionHash     = txHash
              , blocTransactionTxResult = snd <$> trdResult x
              , blocTransactionData     = Nothing   -- can we get this without the txHash table query?
              }
    _ -> throwIO $ UserError $ Text.pack "found multiple tx results for a single tx"




---------------------------------- REGULAR TRANSACTIONS ---------------------------------------



postBlocTransactionParallel :: ( MonadLogger m
                               , A.Selectable Account ContractDetails m
                               , A.Selectable Account AddressState m
                               , (Keccak256 `A.Alters` SourceMap) m
                               , HasBlocEnv m
                               , HasBlocSQL m
                               , HasVault m
                               , HasSQL m
                               )
                            => Maybe Text
                            -> Maybe ChainId
                            -> Bool -- resolve
                            -> Bool -- queue
                            -> PostBlocTransactionRequest
                            -> m [BlocChainOrTransactionResult]
postBlocTransactionParallel a b resolve queue c =
  if queue && not resolve
    then do
      checkIsSynced
      tbqueue <- fmap txTBQueue getBlocEnv
      atomically $ writeTBQueue tbqueue (a,b,resolve,c)
      pure []
    else postBlocTransaction' (Do CacheNonce) a b resolve c


postBlocTransaction :: ( MonadLogger m
                       , A.Selectable Account ContractDetails m
                       , A.Selectable Account AddressState m
                       , (Keccak256 `A.Alters` SourceMap) m
                       , HasBlocEnv m
                       , HasBlocSQL m
                       , HasVault m
                       , HasSQL m
                       )
                    => Maybe Text
                    -> Maybe ChainId
                    -> Bool
                    -> PostBlocTransactionRequest
                    -> m [BlocChainOrTransactionResult]
postBlocTransaction = postBlocTransaction' (Don't CacheNonce)


postBlocTransaction' :: ( MonadLogger m
                        , A.Selectable Account ContractDetails m
                        , A.Selectable Account AddressState m
                        , (Keccak256 `A.Alters` SourceMap) m
                        , HasBlocEnv m
                        , HasBlocSQL m
                        , HasVault m
                        , HasSQL m
                        )
                     => Should CacheNonce
                     -> Maybe Text
                     -> Maybe ChainId
                     -> Bool
                     -> PostBlocTransactionRequest
                     -> m [BlocChainOrTransactionResult]
postBlocTransaction' cacheNonce mUserName chainId resolve (PostBlocTransactionRequest mAddr txs' txParams msrcs) = do
  checkIsSynced
  evmCompatibleOn <- fmap evmCompatible getBlocEnv
  case mUserName of
    Nothing -> throwIO $ UserError $ Text.pack "Did not find X-USER-UNIQUE-NAME in the header"
    Just userName -> do
      addr <- case mAddr of
        Nothing -> fmap unAddress . blocVaultWrapper $ getKey userName Nothing
        Just addr' -> return addr'
      let src' :: ContractPayload -> Maybe SourceMap
          src' p = if contractpayloadSrc p == mempty
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
            let btp = TransferParameters
                        addr
                        (transferpayloadToAddress p)
                        (transferpayloadValue p)
                        (mergeTxParams (transferpayloadTxParams p) txParams)
                        (transferpayloadMetadata p)
                        (transferpayloadChainid p <|> chainId)
                        resolve
            fmap ((:[]) . BlocTxResult) $ postUsersSend' cacheNonce btp userName
          xs -> do
            p <- mapM fromTransfer xs
            let btlp = TransferListParameters
                        addr
                        (map (\(TransferPayload t v x c m) -> SendTransaction t v (mergeTxParams x txParams) c m) p)
                        chainId
                        resolve
            fmap BlocTxResult <$> postUsersSendList' cacheNonce btlp userName
        CONTRACT -> case txs of
          [] -> return []
          [x] -> do
            p <- fromContract x
            let md = contractpayloadMetadata p
                bcp = ContractParameters
                        addr
                        (getSrc p)
                        (contractpayloadContract p)
                        (contractpayloadArgs p)
                        (contractpayloadValue p)
                        (mergeTxParams (contractpayloadTxParams p) txParams)
                        (contractpayloadMetadata p)
                        (contractpayloadChainid p <|> chainId)
                        resolve
                poster = case Map.lookup "VM" =<< md of
                            Nothing -> postUsersContractEVM'
                            Just "EVM" -> postUsersContractEVM'
                            Just "SolidVM" -> postUsersContractSolidVM'
                            Just vm -> \_ _ _ -> throwIO $ UserError $ Text.pack
                                               $ "Invalid value for VM choice: " ++ show vm
            if evmCompatibleOn && (Map.lookup "VM" =<< md) == Just "SolidVM"
                then throwIO $ UserError $ Text.pack "Error: EVM Compatibility flag is On. This feature cannot be used."
            else do
                fmap ((:[]) . BlocTxResult) $ poster cacheNonce bcp userName
          xs -> do
            ps <- mapM fromContract xs
            let bclp = ContractListParameters
                        addr
                        (map (\p@(ContractPayload _ c a v x cid m) ->
                                UploadListContract (fromJust c)
                                                   (getSrc p)
                                                   (fromMaybe Map.empty a)
                                                   (mergeTxParams x txParams)
                                                   v cid m) ps)
                        chainId
                        resolve
                md = contractpayloadMetadata $ head ps --Determine VM option by the metadata of the first tx in list
                poster = case Map.lookup "VM" =<< md of
                  Nothing -> postUsersUploadListEVM'
                  Just "EVM" -> postUsersUploadListEVM'
                  Just "SolidVM" -> postUsersUploadListSolidVM'
                  Just vm -> \_ _ _ -> throwIO $ UserError $ Text.pack
                                     $ "Invalid value for VM choice: " ++ show vm
            if evmCompatibleOn && (Map.lookup "VM" =<< md) == Just "SolidVM"
              then throwIO $ UserError $ Text.pack "Error: EVM Compatibility flag is On. This feature cannot be used."
            else do
              fmap BlocTxResult <$> poster cacheNonce bclp userName
        FUNCTION -> case txs of
          [] -> return []
          [x] -> do
            p <- fromFunction x
            let bfp = FunctionParameters
                        addr
                        (functionpayloadContractAddress p)
                        (functionpayloadMethod p)
                        (functionpayloadArgs p)
                        (functionpayloadValue p)
                        (mergeTxParams (functionpayloadTxParams p) txParams)
                        (functionpayloadMetadata p)
                        (functionpayloadChainid p <|> chainId)
                        resolve
            fmap ((:[]) . BlocTxResult) $ postUsersContractMethod' cacheNonce bfp userName
          xs -> do
            p <- mapM fromFunction xs
            let bflp = FunctionListParameters
                        addr
                        (map (\(FunctionPayload a m r v x c md) ->
                                MethodCall a m r (fromMaybe (Strung 0) v) (mergeTxParams x txParams) c md) p)
                        chainId
                        resolve
            fmap BlocTxResult <$> postUsersContractMethodList' cacheNonce bflp userName
        GENESIS -> case txs of
          [] -> return []
          xs -> do
            chainInputs <- traverse fromGenesis xs
            let chainInputSrc :: ChainInput -> Maybe SourceMap
                chainInputSrc p = if chaininputSrc p == mempty
                                    then Nothing
                                    else Just $ chaininputSrc p
                chainInputSrcMap :: ChainInput -> Maybe SourceMap
                chainInputSrcMap p = join $ liftA2 Map.lookup (chaininputContract p) msrcs
                hydrate p = p{ chaininputSrc = fromMaybe mempty $ chainInputSrc p <|> chainInputSrcMap p }
            fmap (fmap BlocChainResult) . postChainInfos (Just userName) $ hydrate <$> chainInputs
  where fromTransfer = \case
          BlocTransfer t -> return t
          _ -> throwIO $ UserError "Could not decode transfer arguments from body"
        fromContract = \case
          BlocContract c -> return c
          _ -> throwIO $ UserError "Could not decode contract arguments from body"
        fromFunction = \case
          BlocFunction f -> return f
          _ -> throwIO $ UserError "Could not decode function arguments from body"
        fromGenesis = \case
          BlocGenesis f -> return f
          _ -> throwIO $ UserError "Could not decode function arguments from body"

callSignature :: (MonadIO m, MonadLogger m, HasVault m) =>
                 Text -> UnsignedTransaction -> m Transaction
callSignature userName unsigned@UnsignedTransaction{..} = do
  let msgHash = rlpHash unsigned
  sig <- blocVaultWrapper $ postSignature userName (MsgHash msgHash)
  let (r, s, v) = getSigVals sig
  return $ Transaction
    unsignedTransactionNonce
    unsignedTransactionGasPrice
    unsignedTransactionGasLimit
    unsignedTransactionTo
    unsignedTransactionValue
    unsignedTransactionInitOrData
    unsignedTransactionChainId
    v
    r
    s
    Nothing


------------------------------------------------------------------

data TransactionHeader = TransactionHeader
  { transactionheaderToAddr   :: Maybe Address
  , transactionheaderFromAddr :: Address
  , transactionheaderTxParams :: TxParams
  , transactionheaderValue    :: Wei
  , transactionheaderCode     :: Code
  , transactionheaderChainId  :: Maybe ChainId
  }


postUsersSend' :: ( A.Selectable Account AddressState m
                  , (Keccak256 `A.Alters` SourceMap) m
                  , MonadLogger m
                  , HasBlocEnv m
                  , HasBlocSQL m
                  , HasVault m
                  , HasSQL m
                  )
               => Should CacheNonce -> TransferParameters -> Text -> m BlocTransactionResult
postUsersSend' cacheNonce TransferParameters{..} userName = do
    params <- getAccountTxParams cacheNonce fromAddress chainId txParams
    tx <- signAndPrepare userName fromAddress metadata $
      TransactionHeader
        (Just toAddress)
        fromAddress
        params
        (Wei (fromIntegral $ unStrung value))
        (Code ByteString.empty)
        chainId
    txHash <- postTransaction tx
    getResultAndRespond [txHash] resolve

postUsersContractEVM' :: ( MonadLogger m
                         , A.Selectable Account AddressState m
                         , (Keccak256 `A.Alters` SourceMap) m
                         , HasBlocEnv m
                         , HasBlocSQL m
                         , HasVault m
                         , HasSQL m
                         )
                      => Should CacheNonce -> ContractParameters -> Text -> m BlocTransactionResult
postUsersContractEVM' cacheNonce ContractParameters{..} userName = blocTransaction $ do
  params <- getAccountTxParams cacheNonce fromAddr chainId txParams
  --TODO: check what happens with mismatching args
  $logInfoLS "postUsersContractEVM'/args" args
  (cName,ContractDetails{..}) <- getContractDetailsForContract "EVM" src contract >>= \case
    Nothing -> throwIO $ UserError "You need to supply at least one contract in the source"
    Just x -> pure x
  let
    (bin,leftOver) = Base16.decode $ Text.encodeUtf8 contractdetailsBin
    metadata' = Just $ fromMaybe Map.empty metadata `Map.union` Map.fromList [("src", serializeSourceMap contractdetailsSrc),("name", cName)]
  unless (ByteString.null leftOver) $ throwIO $ AnError "Couldn't decode binary"
  let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
  argsBin <- constructArgValues args xabiArgs
  tx <- signAndPrepare userName fromAddr metadata' $
    TransactionHeader
      Nothing
      fromAddr
      params
      (Wei (fromIntegral (maybe 0 unStrung value)))
      (Code $ bin <> argsBin)
      chainId
  $logDebugLS "postUsersContractEVM'/tx" tx
  txHash <- postTransaction tx
  $logInfoLS "postUsersContractEVM'/hash" txHash
  getResultAndRespond [txHash] resolve

postUsersContractSolidVM' :: ( MonadLogger m
                             , A.Selectable Account AddressState m
                             , (Keccak256 `A.Alters` SourceMap) m
                             , HasBlocEnv m
                             , HasBlocSQL m
                             , HasVault m
                             , HasSQL m
                             )
                          => Should CacheNonce -> ContractParameters -> Text -> m BlocTransactionResult
postUsersContractSolidVM' cacheNonce ContractParameters{..} userName = blocTransaction $ do
  params <- getAccountTxParams cacheNonce fromAddr chainId txParams
  --We might be able to get rid of the metadata for SolidVM, but that will require a change in the API, and needs to be discussed
  $logInfoLS "postUsersContractSolidVM'/args" args
  (cName,ContractDetails{..}) <- getContractDetailsForContract "SolidVM"  src contract >>= \case
    Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
    Just x -> pure x

  let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
  (_, argsAsSource) <- constructArgValuesAndSource args xabiArgs

  let metadata' = Just $ fromMaybe Map.empty metadata `Map.union` Map.fromList [("name", cName), ("args", argsAsSource)]

  tx <- signAndPrepare userName fromAddr metadata' $
    TransactionHeader
      Nothing
      fromAddr
      params
      (Wei (fromIntegral (maybe 0 unStrung value)))
      (Code $ Text.encodeUtf8 $ serializeSourceMap contractdetailsSrc)
      chainId
  $logDebugLS "postUsersContractSolidVM'/tx" tx

  txHash <- postTransaction tx
  $logInfoLS "postUsersContractSolidVM'/hash" txHash
  getResultAndRespond [txHash] resolve

postUsersUploadListSolidVM' :: ( MonadLogger m
                               , A.Selectable Account AddressState m
                               , (Keccak256 `A.Alters` SourceMap) m
                               , HasBlocEnv m
                               , HasBlocSQL m
                               , HasVault m
                               , HasSQL m
                               )
                            => Should CacheNonce -> ContractListParameters -> Text -> m [BlocTransactionResult]
postUsersUploadListSolidVM' cacheNonce ContractListParameters{..} userName = do
  let contracts' = map (uploadlistcontractChainid %~ (<|> chainId)) contracts
  txsWithParams <- genNonces cacheNonce fromAddr uploadlistcontractChainid uploadlistcontractTxParams contracts'
  namesTxs <- forStateT Map.empty txsWithParams $
    \(UploadListContract name srcs args params value cid md) -> do
      (src, xabi) <- do
        cd <- fmap snd . lift $ getContractDetailsForContract "SolidVM" srcs (Just name) >>= \case
          Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
          Just x -> pure x
        at name <?= (contractdetailsSrc cd, contractdetailsXabi cd)
                  
      let xabiArgs = maybe Map.empty funcArgs $ xabiConstr xabi
      (_, argsAsSource) <- lift $ constructArgValuesAndSource (Just args) xabiArgs

      let metadata' = Just $ fromMaybe Map.empty md `Map.union` Map.fromList [("name", name), ("args", argsAsSource)]
      tx <- lift . signAndPrepare userName fromAddr metadata' $
          TransactionHeader
            Nothing
            fromAddr
            (fromMaybe emptyTxParams params)
            (Wei (maybe 0 fromIntegral $ fmap unStrung value))
            (Code $ Text.encodeUtf8 $ serializeSourceMap src)
            cid
      return (name,tx)
  let
    txs = map snd namesTxs
  hashes <- postTransactionList txs
  getBatchBlocTransactionResult' hashes resolve

evmUploadListError :: Text
evmUploadListError = Text.concat
  [ "Upload List (EVM): When deploying multiple contract creation transactions, "
  , "the contracts' source code must be uploaded via the /compile route "
  , "ahead of time. Please try uploading the contracts' source code via "
  , "the /compile route, and try again. If you continue to receive this "
  , "error message, please contact your administrator."
  ]

postUsersUploadListEVM' :: ( MonadLogger m
                           , A.Selectable Account AddressState m
                           , (Keccak256 `A.Alters` SourceMap) m
                           , HasBlocEnv m
                           , HasBlocSQL m
                           , HasVault m
                           , HasSQL m
                           )
                        => Should CacheNonce -> ContractListParameters -> Text -> m [BlocTransactionResult]
postUsersUploadListEVM' cacheNonce ContractListParameters{..} userName = do
  let contracts' = map (uploadlistcontractChainid %~ (<|> chainId)) contracts
  txsWithParams <- genNonces cacheNonce fromAddr uploadlistcontractChainid uploadlistcontractTxParams contracts'
  namesCmIdsTxs <- forStateT Map.empty txsWithParams $
    \(UploadListContract name src args params value cid md) -> do
      mtuple <- use $ at name
      ~ContractDetails{..} <- case mtuple of
        Just cd -> pure cd
        Nothing -> do
          cd <- fmap snd . lift $ getContractDetailsForContract "EVM" src (Just name) >>= \case
            Nothing -> throwIO $ UserError evmUploadListError
            Just cd -> pure cd
          at name <?= cd
      let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
      argsBin <- lift $ constructArgValues (Just args) xabiArgs
      let metadata' = Just $ fromMaybe Map.empty md `Map.union` Map.fromList [("src", serializeSourceMap src),("name",name)]
          (bin,leftOver) = Base16.decode $ Text.encodeUtf8 contractdetailsBin
      unless (ByteString.null leftOver) $ throwIO $ AnError "Couldn't decode binary"
      tx <- lift . signAndPrepare userName fromAddr metadata' $
          TransactionHeader
            Nothing
            fromAddr
            (fromMaybe emptyTxParams params)
            (Wei (maybe 0 fromIntegral $ fmap unStrung value))
            (Code $ bin <> argsBin)
            cid
      return (name,tx)
  let txs = snd <$> namesCmIdsTxs
  hashes <- postTransactionList txs
  getBatchBlocTransactionResult' hashes resolve

postUsersSendList' :: ( MonadLogger m
                      , A.Selectable Account AddressState m
                      , (Keccak256 `A.Alters` SourceMap) m
                      , HasBlocEnv m
                      , HasBlocSQL m
                      , HasVault m
                      , HasSQL m
                      )
                   => Should CacheNonce -> TransferListParameters -> Text -> m [BlocTransactionResult]
postUsersSendList' cacheNonce TransferListParameters{..} userName = do
  let txsWithChainids = map (sendtransactionChainid %~ (<|> chainId)) txs
  txsWithParams <- genNonces cacheNonce fromAddr sendtransactionChainid sendtransactionTxParams txsWithChainids
  txs'' <- mapM
    (\(SendTransaction toAddr (Strung value) params cid md) -> do
        let header = TransactionHeader
              (Just toAddr)
              fromAddr
              (fromMaybe emptyTxParams params)
              (Wei $ fromIntegral value)
              (Code ByteString.empty)
              cid
        signAndPrepare userName fromAddr md header
    ) txsWithParams
  hashes <- postTransactionList txs''
  getBatchBlocTransactionResult' hashes resolve

postUsersContractMethodList' :: ( MonadLogger m
                                , A.Selectable Account ContractDetails m
                                , A.Selectable Account AddressState m
                                , (Keccak256 `A.Alters` SourceMap) m
                                , HasBlocEnv m
                                , HasBlocSQL m
                                , HasVault m
                                , HasSQL m
                                )
                             => Should CacheNonce -> FunctionListParameters -> Text -> m [BlocTransactionResult]
postUsersContractMethodList' cacheNonce FunctionListParameters{..} userName = do
  if null txs
    then return []
    else do
      let txsWithChainids = map (methodcallChainid %~ (<|> chainId)) txs
      txsWithParams <- genNonces cacheNonce fromAddr methodcallChainid methodcallTxParams txsWithChainids
      txsFuncNames <- forStateT Map.empty txsWithParams $
        \(MethodCall{..}) -> do
          let theAccount = Account methodcallContractAddress $ fmap unChainId _methodcallChainid
          mXabi <- use $ at theAccount
          xabi <- case mXabi of
            Just x -> pure x
            Nothing -> do
              mXabi' <- lift $ fmap contractdetailsXabi <$> A.select (A.Proxy @ContractDetails) theAccount
              x <- case mXabi' of
                Nothing -> lift $ throwIO . UserError $ "Could not find contract " <> Text.pack (show theAccount)
                Just x -> pure x
              at theAccount <?= x
          contract' <- case xAbiToContract xabi of
            Left err -> throwIO . AnError $ Text.pack err
            Right c -> return c
          let maybeFunc = OMap.lookup methodcallMethodName (fields $ C.mainStruct contract')

          sel <-
            case maybeFunc of
             Just (_, TypeFunction selector _ _) -> return selector
             _ -> lift $ throwIO . UserError $ "Contract doesn't have a method named '" <> methodcallMethodName <> "'"
          let xabiArgs = maybe Map.empty funcArgs . Map.lookup methodcallMethodName $ xabiFuncs xabi
          (argsBin, argsAsSource) <-
            lift $ constructArgValuesAndSource (Just methodcallArgs) xabiArgs
          let methodcallMetadataWithCallInfo = Just $
                Map.insert "funcName" methodcallMethodName
                $ Map.insert "args" argsAsSource
                $ fromMaybe Map.empty methodcallMetadata
          tx <- lift . signAndPrepare userName fromAddr methodcallMetadataWithCallInfo $
            TransactionHeader
              (Just methodcallContractAddress)
              fromAddr
              (fromMaybe emptyTxParams _methodcallTxParams)
              (Wei (fromIntegral $ unStrung methodcallValue))
              (Code $ sel <> argsBin)
              _methodcallChainid
          -- resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
          return (tx,methodcallMethodName)
      let finalTxs = fst <$> txsFuncNames
      mapM_ ($logDebugLS "postUsersContractMethodList'/txs") finalTxs
      hashes <- postTransactionList finalTxs
      mapM_ ($logInfoLS "postUsersContractMethodList'/hashes") hashes
      getBatchBlocTransactionResult' hashes resolve

postUsersContractMethod' :: ( MonadLogger m
                            , A.Selectable Account ContractDetails m
                            , A.Selectable Account AddressState m
                            , (Keccak256 `A.Alters` SourceMap) m
                            , HasBlocEnv m
                            , HasBlocSQL m
                            , HasVault m
                            , HasSQL m
                            )
                         => Should CacheNonce -> FunctionParameters -> Text -> m BlocTransactionResult
postUsersContractMethod' cacheNonce FunctionParameters{..} userName = do
    params <- getAccountTxParams cacheNonce fromAddr chainId txParams

    let err = CouldNotFind $ Text.concat
                [ "postUsersContractMethod': Couldn't find contract details for contract at address "
                , Text.pack $ formatAddressWithoutColor contractAddr
                ]
    xabi <- maybe (throwIO err) (pure . contractdetailsXabi) =<<
      A.select (A.Proxy @ContractDetails)
        (Account contractAddr (unChainId <$> chainId))
    contract' <- case xAbiToContract xabi of
      Left e -> throwIO . AnError $ Text.pack e
      Right c -> return c

    let maybeFunc = OMap.lookup funcName (fields $ C.mainStruct contract')
        xabiArgs = maybe Map.empty funcArgs . Map.lookup funcName $ xabiFuncs xabi

    sel <-
      case maybeFunc of
       Just (_, TypeFunction selector _ _) -> return selector
       _ -> throwIO . UserError $ "Contract doesn't have a method named '" <> funcName <> "'"

    (argsBin, argsAsSource) <- constructArgValuesAndSource (Just args) xabiArgs
    let metadataWithCallInfo =
          Map.insert "funcName" funcName
          $ Map.insert "args" argsAsSource
          $ fromMaybe Map.empty metadata

    tx <- signAndPrepare userName fromAddr (Just metadataWithCallInfo) $
      TransactionHeader
        (Just contractAddr)
        fromAddr
        params
        (Wei (maybe 0 (fromIntegral . unStrung) value))
        (Code $ (sel::ByteString) <> (argsBin::ByteString))
        chainId
    $logDebugLS "postUsersContractMethod'/tx" tx
    txHash <- postTransaction tx
    $logInfoLS "postUsersContractMethod'/hash" txHash
    getResultAndRespond [txHash] resolve


prepareUnsignedTx :: TransactionHeader -> UnsignedTransaction
prepareUnsignedTx TransactionHeader{..} = UnsignedTransaction
  { unsignedTransactionNonce =
      fromMaybe (Nonce 0) (txparamsNonce transactionheaderTxParams)
  , unsignedTransactionGasPrice =
      fromMaybe (Wei 1) (txparamsGasPrice transactionheaderTxParams)
  , unsignedTransactionGasLimit =
      fromMaybe (Gas 100000000) (txparamsGasLimit transactionheaderTxParams)
  , unsignedTransactionTo = transactionheaderToAddr
  , unsignedTransactionValue = transactionheaderValue
  , unsignedTransactionInitOrData = transactionheaderCode
  , unsignedTransactionChainId = transactionheaderChainId
  }

preparePostTx
  :: UTCTime
  -> Address
  -> Transaction
  -> RawTransaction'
preparePostTx time from tx = flip RawTransaction' "" $ RawTransaction
  time
  from
  (fromIntegral nonce')
  (fromIntegral gasPrice)
  (fromIntegral gasLimit)
  toAddr
  (fromIntegral value)
  code
  chainId
  (fromIntegral r)
  (fromIntegral s)
  v
  metadata
  0
  kecc
  API
  where
    kecc = hash (rlpSerialize tx)
    r = transactionR tx
    s = transactionS tx
    v = transactionV tx
    Gas gasLimit = transactionGasLimit tx
    Wei gasPrice = transactionGasPrice tx
    Nonce nonce' = transactionNonce tx
    Wei value = transactionValue tx
    code = transactionInitOrData tx
    toAddr = transactionTo tx
    chainId = fromMaybe 0 . fmap (\(ChainId c) -> c) $ transactionChainId tx
    metadata = Map.toList <$> transactionMetadata tx

addMetadata :: Maybe (Map Text Text) -> Transaction -> Transaction
addMetadata m t = t{transactionMetadata = m}

signAndPrepare :: (MonadIO m, MonadLogger m, HasVault m) =>
                  Text -> Address -> Maybe (Map Text Text) -> TransactionHeader -> m RawTransaction'
signAndPrepare userName from md th = do
  let sign' = callSignature userName
  time <- liftIO getCurrentTime
  fmap (preparePostTx time from . addMetadata md) . sign' $ prepareUnsignedTx th


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

getAccountTxParams :: (MonadIO m, MonadLogger m, HasBlocEnv m, HasSQL m) =>
                      Should CacheNonce -> Address -> Maybe ChainId -> Maybe TxParams -> m TxParams
getAccountTxParams cacheNonce addr chainId mTxParams = do
  let params = fromMaybe emptyTxParams mTxParams
      cacheKey = Account addr (unChainId <$> chainId)
  nonceCache <- fmap globalNonceCounter getBlocEnv
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

cacheLookup :: (Eq k, Hashable k)
            => Cache.Cache k v
            -> TimeSpec
            -> k
            -> STM (Maybe v)
cacheLookup c t k = Cache.lookupSTM True k c t

genNonces :: (MonadIO m, MonadLogger m, HasBlocEnv m, HasSQL m) =>
             Show a
          => Should CacheNonce
          -> Address
          -> Lens' a (Maybe ChainId)
          -> Lens' a (Maybe TxParams)
          -> [a]
          -> m [a]
genNonces cacheNonce fromAddr chainLens l unindexedAs = do
  let getChainId = view chainLens
      chainIdsList = S.toList . S.fromList $ getChainId <$> unindexedAs
      cacheKeys = Account fromAddr . fmap unChainId <$> chainIdsList
      viewNonce = txparamsNonce <=< view l
  let indexedByChainId = indexedPartitionWith getChainId unindexedAs
  nonceCache <- fmap globalNonceCounter getBlocEnv
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
                 mmNonce <- cacheLookup nonceCache now' (Account fromAddr $ unChainId <$> chainId)
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
    Cache.insertSTM (Account fromAddr $ unChainId <$> chainId) newCachedNonce nonceCache expTime
    pure (chainId, txs)


getAccountNonce :: (MonadIO m, MonadLogger m, HasSQL m, HasBlocEnv m) =>
                   Address -> S.Set (Maybe ChainId) -> m (Map (Maybe ChainId) Nonce)
getAccountNonce addr chainIds = do
  let chainIds' = map (fromMaybe (ChainId 0)) $ S.toList chainIds
  let chainIds'' = map (\(ChainId c) -> c) chainIds'
  let actions = E.select . E.from $ \accStateRef -> do
                  E.where_ (accStateRef E.^. AddressStateRefAddress E.==. E.val addr)
                  E.where_ (accStateRef E.^. AddressStateRefChainId `E.in_` E.valList chainIds'')
                  return accStateRef
  mAccts <- SQLDB.sqlQuery actions
  $logInfoLS "getAccountNonce lookup" (chainIds'', addr)
  $logInfoLS "getAccountNonce results" mAccts
  case mAccts of
    [] -> do
      requireBalance <- fmap gasOn getBlocEnv
      if requireBalance then throwIO . UserError $ "User does not have a balance"
      else return $ Map.fromList [(Nothing, Nonce $ fromInteger 0)]
    accts -> do
      let acts = map E.entityVal accts
      let mkCid AddressStateRef{..} = ChainId <$> toMaybe 0 addressStateRefChainId
          mkNonce AddressStateRef{..} = Nonce $ fromInteger addressStateRefNonce
      return . Map.fromList $ map (mkCid &&& mkNonce) acts

constructArgValues :: (MonadIO m, MonadLogger m) =>
                      Maybe (Map Text ArgValue) -> Map Text Xabi.IndexedType -> m ByteString
constructArgValues args argNamesTypes = do
    case args of
      Nothing ->
        if Map.null argNamesTypes
          then return ByteString.empty
          else throwIO (UserError "no arguments provided to function.")
      Just argsMap -> do
        vals <- getArgValues argsMap argNamesTypes
        return $ toStorage (ValueArrayFixed (fromIntegral (length vals)) vals)

getArgValues :: (MonadIO m, MonadLogger m) =>
                Map Text ArgValue -> Map Text Xabi.IndexedType -> m [Value]
getArgValues argsMap argNamesTypes = do
    argsVals <-
      if not (Map.keysSet argNamesTypes `isSubsetOf` Map.keysSet argsMap)
      then do
        let
          argNames1 = "(" <> Text.intercalate ", " (Map.keys argNamesTypes) <> ")"
          argNames2 = "(" <> Text.intercalate ", " (Map.keys argsMap) <> ")"
        throwIO (UserError ("Argument names don't match - Expected Arguments: " <> argNames1 <> "; Received Arguments: " <> argNames2))
      else sequence $ Map.intersectionWith determineValue argsMap argNamesTypes
    return $ map snd (sortOn fst (toList argsVals))

determineValue :: (MonadIO m, MonadLogger m) => ArgValue -> Xabi.IndexedType -> m (Int32, Value)
determineValue argVal (Xabi.IndexedType ix xabiType) =
  let
    typeM = getSolidityType argVal xabiType
  in do
    ty <- either (blocError . UserError) return typeM
    either (blocError . UserError) (return . (ix,)) (argValueToValue Nothing ty argVal)

getSolidityType :: ArgValue -> Xabi.Type -> Either Text Type 
getSolidityType _ (Xabi.Int (Just True) b) = Right . SimpleType . TypeInt True $ fmap toInteger b
getSolidityType _ (Xabi.Int _           b) = Right . SimpleType . TypeInt False $ fmap toInteger b
getSolidityType _ (Xabi.String _)          = Right . SimpleType $ TypeString
getSolidityType _ (Xabi.Bytes _ b)         = Right . SimpleType . TypeBytes $ fmap toInteger b
getSolidityType _  Xabi.Bool               = Right . SimpleType $ TypeBool
getSolidityType _  Xabi.Address            = Right . SimpleType $ TypeAddress
getSolidityType _  Xabi.Account            = Right . SimpleType $ TypeAccount
getSolidityType _ (Xabi.Struct _ name)     = Right $ TypeStruct name
getSolidityType _ (Xabi.Enum _ name _)     = Right $ TypeEnum name
getSolidityType _ (Xabi.Contract name)     = Right $ TypeContract name
getSolidityType (ArgInt _) (Xabi.Label _)  = Right $ SimpleType typeUInt -- since Enums are converted to Ints
getSolidityType (ArgString _) (Xabi.Label s)  = Right $ TypeEnum $ Text.pack s
getSolidityType (ArgObject _) (Xabi.Label s)  = Right $ TypeStruct $ Text.pack s --interpret an object strictly as a struct
getSolidityType av (Xabi.Label _)             = Left $ Text.pack $ "Expected a string, int, or object, but recieved: " ++ show av
getSolidityType (ArgArray v) (Xabi.Array typ len)     = 
  let arrType = case len of
        Just l -> TypeArrayFixed l
        Nothing -> TypeArrayDynamic
      elType = getSolidityType (V.head v) typ
  in case elType of
    Right c -> Right (arrType c)
    e -> e
getSolidityType av (Xabi.Array _ _)          = Left $ Text.pack $ "Expected Array but got " ++ show av
getSolidityType (ArgObject _) Xabi.Mapping{} = Right $ TypeStruct "s"
getSolidityType av Xabi.Mapping{}            = Left $ Text.pack $ "Expected Object for Mapping type, but got " ++ show av


getResultAndRespond :: ( A.Selectable Account AddressState m
                       , (Keccak256 `A.Alters` SourceMap) m
                       , MonadLogger m
                       , HasBlocEnv m
                       , HasBlocSQL m
                       , HasSQL m
                       )
                    => [Keccak256] -> Bool -> m BlocTransactionResult
getResultAndRespond txHashes resolve = do
  result <- getBlocTransactionResult' txHashes resolve
  case (blocTransactionStatus result, blocTransactionTxResult result, resolve) of
    (Success, _, _) -> return result
    (Failure, Nothing, _) -> throwIO (VMError "unknown reason")
    (Failure, Just tr, _) -> throwIO (VMError $ Text.pack $ "Error running the transaction: " ++ transactionResultMessage tr)
    (Pending, _, _) -> return result

checkIsSynced :: (Monad m, HasSQL m) => m ()
checkIsSynced = do
  status         <- runStratoRedisIO getSyncStatus
  nodeBestBlock  <- runStratoRedisIO getBestBlockInfo
  worldBestBlock <- runStratoRedisIO getWorldBestBlockInfo
  let nodeTotalDiff  = bestBlockTotalDifficulty <$> nodeBestBlock
      worldTotalDiff = bestBlockTotalDifficulty <$> worldBestBlock

  case (status, worldTotalDiff, nodeTotalDiff) of
    (Just False, Just wtd, Just ntd) -> throwIO $ NotYetSynced ntd wtd
    _                                -> pure ()
