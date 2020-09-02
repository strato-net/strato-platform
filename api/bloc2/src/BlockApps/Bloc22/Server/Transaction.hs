{-# LANGUAGE Arrows              #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Transaction where

import           Control.Applicative               ((<|>), liftA2)
import           Control.Arrow
import           Control.Lens                      hiding (from, ix)
import           Control.Monad
import           Control.Monad.Reader
import qualified Data.ByteString                   as B
import qualified Data.ByteString.Base16            as B16
import qualified Data.ByteString.Char8             as BC
import           Data.Conduit
import           Data.Conduit.TQueue
import           Data.Int                          (Int32)
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import           Opaleye                           hiding (not, null, index, max)
import           UnliftIO


import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Chain
import           BlockApps.Bloc22.Server.Users
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.Logging
import           BlockApps.Solidity.Contract()
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types            hiding (Transaction (..))
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Wei
import           Handlers.Transaction
import           Strato.Strato23.Client
import           Strato.Strato23.API.Types



mergeTxParams :: Maybe TxParams -> Maybe TxParams -> Maybe TxParams
mergeTxParams (Just inner) (Just outer) = Just $
  TxParams (txparamsGasLimit inner <|> txparamsGasLimit outer)
           (txparamsGasPrice inner <|> txparamsGasPrice outer)
           (txparamsNonce inner <|> txparamsNonce outer)
mergeTxParams inner outer = inner <|> outer

txWorker :: Bloc ()
txWorker = forever $ do
  tbqueue <- asks txTBQueue
  e <- try . runConduit $ sourceTBQueue tbqueue .| processTxs
  case e of
    Left (ex :: SomeException) -> $logErrorS "txWorker/error" . Text.pack $ show ex
    Right () -> error "txWorker returned a Right (). This should never happen. Please contact Simon Peyton Jones."
  where processTxs = awaitForever $ \(a,b,r,c) ->
          lift . void $ postBlocTransaction' (Do CacheNonce) a b r c

postBlocTransactionParallel :: Maybe Text
                            -> Maybe ChainId
                            -> Bool -- resolve
                            -> Bool -- queue
                            -> PostBlocTransactionRequest
                            -> Bloc [BlocChainOrTransactionResult]
postBlocTransactionParallel a b resolve queue c =
  if queue && not resolve
    then do
      tbqueue <- asks txTBQueue
      atomically $ writeTBQueue tbqueue (a,b,resolve,c)
      pure [] 
    else postBlocTransaction' (Do CacheNonce) a b resolve c

postBlocTransaction :: Maybe Text
                    -> Maybe ChainId
                    -> Bool
                    -> PostBlocTransactionRequest
                    -> Bloc [BlocChainOrTransactionResult]
postBlocTransaction = postBlocTransaction' (Don't CacheNonce)

postBlocTransaction' :: Should CacheNonce
                     -> Maybe Text
                     -> Maybe ChainId
                     -> Bool
                     -> PostBlocTransactionRequest
                     -> Bloc [BlocChainOrTransactionResult]
postBlocTransaction' cacheNonce mUserName chainId resolve (PostBlocTransactionRequest mAddr txs' txParams msrcs) = do
  case mUserName of
    Nothing -> throwIO $ UserError $ Text.pack "Did not find X-USER-UNIQUE-NAME in the header"
    Just userName -> do
      addr <- case mAddr of
        Nothing -> fmap unAddress . blocVaultWrapper $ getKey userName Nothing
        Just addr' -> return addr'
      let getSrc p = contractpayloadSrc p <|> join (liftA2 Map.lookup (contractpayloadContract p) msrcs)
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
            fmap ((:[]) . BlocTxResult) $ postUsersSend' cacheNonce btp (callSignature userName)
          xs -> do
            p <- mapM fromTransfer xs
            let btlp = TransferListParameters
                        addr
                        (map (\(TransferPayload t v x c m) -> SendTransaction t v (mergeTxParams x txParams) c m) p)
                        chainId
                        resolve
            fmap BlocTxResult <$> postUsersSendList' cacheNonce btlp (callSignature userName)
        CONTRACT -> case txs of
          [] -> return []
          [x] -> do
            p <- fromContract x
            let md = contractpayloadMetadata p
                bcp = ContractParameters
                        addr
                        (fromMaybe "" $ getSrc p)
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
            fmap ((:[]) . BlocTxResult) $ poster cacheNonce bcp (callSignature userName)
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
            fmap BlocTxResult <$> poster cacheNonce bclp userName
        FUNCTION -> case txs of
          [] -> return []
          [x] -> do
            p <- fromFunction x
            let bfp = FunctionParameters
                        addr
                        ((\(ContractName c) -> c) $ functionpayloadContractName p)
                        (functionpayloadContractAddress p)
                        (functionpayloadMethod p)
                        (functionpayloadArgs p)
                        (functionpayloadValue p)
                        (mergeTxParams (functionpayloadTxParams p) txParams)
                        (functionpayloadMetadata p)
                        (functionpayloadChainid p <|> chainId)
                        resolve
            fmap ((:[]) . BlocTxResult) $ postUsersContractMethod' cacheNonce bfp (callSignature userName)
          xs -> do
            p <- mapM fromFunction xs
            let bflp = FunctionListParameters
                        addr
                        (map (\(FunctionPayload (ContractName n) a m r v x c md) ->
                                MethodCall n a m r (fromMaybe (Strung 0) v) (mergeTxParams x txParams) c md) p)
                        chainId
                        resolve
            fmap BlocTxResult <$> postUsersContractMethodList' cacheNonce bflp (callSignature userName)
        GENESIS -> case txs of
          [] -> return []
          xs -> do
            chainInputs <- traverse fromGenesis xs
            let hydrate p = p{ chaininputSrc = chaininputSrc p <|> join (liftA2 Map.lookup (chaininputContract p) msrcs) }
            fmap (fmap BlocChainResult) . postChainInfos $ hydrate <$> chainInputs
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

callSignature :: Text -> UnsignedTransaction -> Bloc Transaction
callSignature userName unsigned@UnsignedTransaction{..} = do
  let msgHash = rlpHash unsigned
  SignatureDetails{..} <- blocVaultWrapper $ postSignature userName (MsgHash msgHash)
  return $ Transaction
    unsignedTransactionNonce
    unsignedTransactionGasPrice
    unsignedTransactionGasLimit
    unsignedTransactionTo
    unsignedTransactionValue
    unsignedTransactionInitOrData
    unsignedTransactionChainId
    (unHex v)
    (unHex r)
    (unHex s)
    Nothing

--------------------------

postUsersUploadListEVM' :: Should CacheNonce -> ContractListParameters -> Text -> Bloc [BlocTransactionResult]
postUsersUploadListEVM' cacheNonce ContractListParameters{..} userName = do
  let sign = callSignature userName
  let contracts' = map (uploadlistcontractChainid %~ (<|> chainId)) contracts
  txsWithParams <- genNonces cacheNonce fromAddr uploadlistcontractChainid uploadlistcontractTxParams contracts'
  namesCmIdsTxs <- forStateT Map.empty txsWithParams $
    \(UploadListContract name mSrc args params value cid md) -> do
      when (isJust mSrc) . lift . throwIO $ UserError evmUploadListError
      mtuple <- use $ at name
      (bin, src, cmId, xabi) <- case mtuple of
        Just (b, src, cmId', x) -> return (b, src, cmId', x)
        Nothing -> do
          mContract <- lift . blocQueryMaybe $ proc () -> do
            (bin16,_,cHash,_,_,src,cmId',x'') <- getContractsContractLatestQuery name -< ()
            returnA -< (bin16,cHash,src,cmId',x'')
          case mContract of
            Nothing -> throwIO $ UserError evmUploadListError
            Just (_,SolidVMCode _ _,_,_,_) -> throwIO $ UserError evmContractSolidVMError
            Just (b16,_,src,(cmId' :: Int32),x') -> do
              let (b, leftOver) = B16.decode b16
              unless (B.null leftOver) $ throwIO $ AnError "Couldn't decode binary"
              x <- lift $ deserializeXabi x'
              at name <?= (b, src, cmId', x)
      let xabiArgs = maybe Map.empty funcArgs $ xabiConstr xabi
      argsBin <- lift $ constructArgValues (Just args) xabiArgs
      let metadata' = Just $ fromMaybe Map.empty md `Map.union` Map.fromList [("src",src),("name",name)]
      tx <- lift . signAndPrepare sign fromAddr metadata' $
          TransactionHeader
            Nothing
            fromAddr
            (fromMaybe emptyTxParams params)
            (Wei (maybe 0 fromIntegral $ fmap unStrung value))
            (bin <> argsBin)
            cid
      return ((name,cmId),tx)
  let
    txs = map snd namesCmIdsTxs
  hashes <- blocStrato (postTxList txs)
  void . blocModify $ \conn -> runInsertMany conn hashNameTable
    [( Nothing
    , constant txHash
    , constant cmId
    , constant (1 :: Int32)
    , constant name
    )
    | (txHash,(name,cmId)) <- zip hashes (map fst namesCmIdsTxs)
    ]
  getBatchBlocTransactionResult' hashes resolve

evmUploadListError :: Text
evmUploadListError = Text.concat
  [ "Upload List (EVM): When deploying multiple contract creation transactions, "
  , "the contracts' source code must be uploaded via the /compile route "
  , "ahead of time. Please try uploading the contracts' source code via "
  , "the /compile route, and try again. If you continue to receive this "
  , "error message, please contact your administrator."
  ]

postUsersUploadListSolidVM' :: Should CacheNonce -> ContractListParameters -> Text -> Bloc [BlocTransactionResult]
postUsersUploadListSolidVM' cacheNonce ContractListParameters{..} userName = do
  let sign = callSignature userName
  let contracts' = map (uploadlistcontractChainid %~ (<|> chainId)) contracts
  txsWithParams <- genNonces cacheNonce fromAddr uploadlistcontractChainid uploadlistcontractTxParams contracts'
  namesCmIdsTxs <- forStateT Map.empty txsWithParams $
    \(UploadListContract name mSrc args params value cid md) -> do
      (src, cmId, xabi) <- case mSrc of
        Just src -> do
          (cmId', cd) <- fmap snd . lift $ getContractDetailsForContract "SolidVM" src (Just name) >>= \case
            Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
            Just x -> pure x
          at name <?= (src, cmId', contractdetailsXabi cd)
        Nothing -> do
          mtuple <- use $ at name
          case mtuple of
            Just (src, cmId', x) -> return (src, cmId', x)
            Nothing -> do
              mContract <- lift . blocQueryMaybe $ proc () -> do
                (_,_,_,_,_,src,cmId',x'') <- getContractsContractLatestQuery name -< ()
                returnA -< (src,cmId',x'')
              case mContract of
                Nothing -> throwIO . UserError $ Text.concat
                  [ "Upload List (SolidVM): When deploying multiple contract creation transactions, "
                  , "the contracts' source code must be supplied when using SolidVM. "
                  , "Please try supplying the contracts' source code and try again. "
                  , "If you continue to receive this error message, please contact your administrator."
                  ]
                Just (src,(cmId' :: Int32),x') -> do
                  x <- lift $ deserializeXabi x'
                  at name <?= (src, cmId', x)
      let xabiArgs = maybe Map.empty funcArgs $ xabiConstr xabi
      (_, argsAsSource) <- lift $ constructArgValuesAndSource (Just args) xabiArgs

      let metadata' = Just $ fromMaybe Map.empty md `Map.union` Map.fromList [("name", name), ("args", argsAsSource)]
      tx <- lift . signAndPrepare sign fromAddr metadata' $
          TransactionHeader
            Nothing
            fromAddr
            (fromMaybe emptyTxParams params)
            (Wei (maybe 0 fromIntegral $ fmap unStrung value))
            (BC.pack $ Text.unpack src)
            cid
      return ((name,cmId),tx)
  let
    txs = map snd namesCmIdsTxs
  hashes <- blocStrato (postTxList txs)
  void . blocModify $ \conn -> runInsertMany conn hashNameTable
    [( Nothing
    , constant txHash
    , constant cmId
    , constant (1 :: Int32)
    , constant name
    )
    | (txHash,(name,cmId)) <- zip hashes (map fst namesCmIdsTxs)
    ]
  getBatchBlocTransactionResult' hashes resolve
