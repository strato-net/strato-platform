{-# LANGUAGE Arrows              #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE Rank2Types          #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Users where

import           ClassyPrelude                     ((<>), Hashable, getCurrentTime, UTCTime(..))
import           Control.Concurrent
import           Control.Applicative               ((<|>), liftA2)
import           Control.Arrow
import           Control.Lens                      hiding (from, ix)
import           Control.Monad
import           Control.Monad.Except
import           Control.Monad.Extra
import           Control.Monad.Reader
import           Control.Monad.Trans.State.Lazy
import           Crypto.HaskoinShim
import qualified Data.Aeson                        as Aeson
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Char8             as BC
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
import qualified Data.Map.Ordered                  as OMap
import           Data.Maybe
import           Data.RLP
import           Data.Semigroup                    (Max(..))
import           Data.Set                          (isSubsetOf)
import qualified Data.Set                          as S
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Traversable
import           Database.PostgreSQL.Simple        (SqlError(..))
import           Opaleye                           hiding (not, null, index, max)
import           Text.Format
import           Text.Read                         (readMaybe)
import           System.Clock
import           UnliftIO

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import qualified BlockApps.Bloc22.Monad            as M
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.Logging
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract()
import qualified BlockApps.Solidity.Contract       as C
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Storage
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Type      as Xabi
import           BlockApps.SolidityVarReader
import           BlockApps.Strato.Types            (Strung(..))
import qualified BlockApps.Strato.Types            as Deprecated
import           BlockApps.XAbiConverter
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.Data.TXOrigin
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Wei
import           Handlers.AccountInfo
import           Handlers.Faucet
import           Handlers.Transaction

data TransactionHeader = TransactionHeader
  { transactionheaderToAddr   :: Maybe Address
  , transactionheaderFromAddr :: Address
  , transactionheaderTxParams :: TxParams
  , transactionheaderValue    :: Wei
  , transactionheaderCode     :: Code
  , transactionheaderChainId  :: Maybe ChainId
  }

type Signer = UnsignedTransaction -> Bloc Transaction

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

getUsers :: Bloc [UserName]
getUsers = do
  gtfoMyLawn <- asks deployMode
  case gtfoMyLawn of
    M.Public -> throwIO (CouldNotFind "no /users endpoint. thank.")
    M.Enterprise -> blocTransaction $ map UserName <$> blocQuery getUsersQuery

getUsersUser :: UserName -> Bloc [Address]
getUsersUser (UserName name) = blocTransaction $
  blocQuery $ getUsersUserQuery name

postUsersUser :: UserName -> Password -> Bloc Address
postUsersUser (UserName name) pass = blocTransaction $ do
  keyStore <- newKeyStore pass
  createdUser <- blocModify $ postUsersUserQuery name keyStore
  unless createdUser (throwIO (DBError "failed to create user"))
  return $ keystoreAcctAddress keyStore

getUsersKeyStore :: UserName -> Address -> Password -> Bloc KeyStore
getUsersKeyStore userName addr password = do
  let err = throwIO . UserError $ "invalid username or password"
  uids <- blocQuery . getUserIdQuery $ userName
  cryptos <- case listToMaybe uids of
    Nothing -> err
    Just uid -> blocQuery $ proc () -> do
      (_, salt, pw, nonce, seckey, pubkey, addr', uid') <- queryTable keyStoreTable -< ()
      restrict -< uid' .== constant (uid :: Int32)
              .&& addr' .== constant addr
      returnA -< (salt, pw, nonce, seckey, pubkey, addr')
  case listToMaybe cryptos of
    Nothing -> err
    Just (salt, pw, nonce, seckey, pubkey, addr') ->
      case decryptSecKey password salt nonce seckey of
        Nothing -> err
        Just _ -> return $ KeyStore salt pw nonce seckey pubkey addr'

postUsersKeyStore :: UserName -> PostUsersKeyStoreRequest -> Bloc Bool
postUsersKeyStore username (PostUsersKeyStoreRequest password keystore) = do
  let err = throwIO . UserError $ "invalid username or password"
  uids <- blocQuery . getUserIdQuery $ username
  uid <- case uids of
    [] -> err
    uid':_ -> return uid'
  cryptos <- blocQuery $ proc () -> do
      (_, salt, _, nonce, seckey, _, _, uid') <- queryTable keyStoreTable -< ()
      restrict -< uid' .== constant (uid :: Int32)
      returnA -< (salt, nonce, seckey)
  case catMaybes . map (\(s, n, sk) -> decryptSecKey password s n sk) $ cryptos of
    [] -> err
    _ -> blocModify (insertKeyStore uid keystore) `catch`
          \s@SqlError{..} -> throwIO . AlreadyExists $
            "keystore could not be inserted: " <> Text.pack (show s)

waitForBalance :: Address -> Bloc ()
waitForBalance addr = waitFor "no user account found" go
  where go :: Bloc Bool
        go = do
          let params = accountsFilterParams{qaAddress = Just addr, qaMinBalance = Just 1}
          accts <- blocStrato $ getAccountsFilter params
          $logInfoLS "waitForBalance/req" params
          $logInfoLS "waitForBalance/resp" accts
          return . not $ null accts

postUsersFill :: UserName  -> Address -> Bool -> Bloc BlocTransactionResult
postUsersFill _ addr resolve = do
  shouldPost <- asks gasOn
  if shouldPost
    then blocTransaction $ do
      when resolve ($logInfoS "postUsersFill" "Waiting for faucet transaction to be mined")
      hashes <- blocStrato $ postFaucetClient addr
      void . blocModify $ \conn -> runInsertMany conn hashNameTable [
        ( Nothing
        , constant h
        , constant (0 :: Int32)
        , constant (0 :: Int32)
        , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode Deprecated.defaultPostTx{Deprecated.posttransactionTo = Just addr})
        ) | h <- hashes]
      result <- getBlocTransactionResult' hashes resolve
      when (resolve && Success == blocTransactionStatus result) $ do
        waitForBalance addr
      $logInfoLS "postUsersFill/resolve" resolve
      $logInfoLS "postUsersFill/result" result
      when (Failure == blocTransactionStatus result) $
        throwIO $ UnavailableError "faucet transaction failed; please try again"
      return result
    else pure $ BlocTransactionResult Success zeroHash Nothing Nothing

postUsersSend :: UserName -> Address -> Maybe ChainId -> Bool -> PostSendParameters -> Bloc BlocTransactionResult
postUsersSend userName addr chainId resolve
  (PostSendParameters toAddr value password mTxParams md) = do
    sk <- getAccountSecKey userName password addr
    let btp = TransferParameters
                addr
                toAddr
                value
                mTxParams
                md
                chainId
                resolve
    postUsersSend' (Don't CacheNonce) btp (return . signTransaction sk)

postUsersSend' :: Should CacheNonce -> TransferParameters -> Signer -> Bloc BlocTransactionResult
postUsersSend' cacheNonce TransferParameters{..} sign = do
    params <- getAccountTxParams cacheNonce fromAddress chainId txParams
    tx <- signAndPrepare sign fromAddress metadata $
      TransactionHeader
        (Just toAddress)
        fromAddress
        params
        (Wei (fromIntegral $ unStrung value))
        (Code ByteString.empty)
        chainId
    txHash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsertMany conn hashNameTable [
      ( Nothing
      , constant txHash
      , constant (0 :: Int32)
      , constant (0 :: Int32)
      , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode tx)
      )]
    getBlocTransactionResult' [txHash] resolve

postUsersContract :: UserName -> Address -> Maybe ChainId -> Bool -> PostUsersContractRequest -> Bloc BlocTransactionResult
postUsersContract userName addr chainId resolve
  (PostUsersContractRequest src password maybeContract args mTxParams value md) = do
  sk <- getAccountSecKey userName password addr
  let bcp = ContractParameters
              addr
              src
              maybeContract
              args
              value
              mTxParams
              md
              chainId
              resolve
      cacheNonce = Don't CacheNonce
  case join $ fmap (Map.lookup "VM") $ md of
    Just "EVM" -> postUsersContractEVM' cacheNonce bcp (return . signTransaction sk)
    Just "SolidVM" -> postUsersContractSolidVM' cacheNonce bcp (return . signTransaction sk)
    Nothing -> postUsersContractEVM' cacheNonce bcp (return . signTransaction sk) -- The EVM is the default VM
    Just vmName -> throwIO $ UserError $ Text.pack $ "Invalid value for VM choice: " ++ show vmName ++ ", valid options are 'EVM' or 'SolidVM'"

postUsersContractEVM' :: Should CacheNonce -> ContractParameters -> Signer -> Bloc BlocTransactionResult
postUsersContractEVM' cacheNonce ContractParameters{..} sign = blocTransaction $ do
  params <- getAccountTxParams cacheNonce fromAddr chainId txParams
  --TODO: check what happens with mismatching args
  $logInfoLS "postUsersContractEVM'/args" args
  (cName,(cmId,ContractDetails{..})) <- getContractDetailsForContract "EVM" src contract >>= \case
    Nothing -> throwIO $ UserError "You need to supply at least one contract in the source"
    Just x -> pure x
  let
    (bin,leftOver) = Base16.decode $ Text.encodeUtf8 contractdetailsBin
    metadata' = Just $ fromMaybe Map.empty metadata `Map.union` Map.fromList [("src", src),("name", cName)]
  unless (ByteString.null leftOver) $ throwIO $ AnError "Couldn't decode binary"
  let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
  argsBin <- constructArgValues args xabiArgs
  tx <- signAndPrepare sign fromAddr metadata' $
    TransactionHeader
      Nothing
      fromAddr
      params
      (Wei (fromIntegral (maybe 0 unStrung value)))
      (Code $ bin <> argsBin)
      chainId
  $logDebugLS "postUsersContractEVM'/tx" tx
  txHash <- blocStrato $ postTx tx
  $logInfoLS "postUsersContractEVM'/hash" txHash
  void . blocModify $ \conn -> runInsertMany conn hashNameTable [
    ( Nothing
    , constant txHash
    , constant cmId
    , constant (1 :: Int32)
    , constant contractdetailsName
    )]
  getBlocTransactionResult' [txHash] resolve

postUsersContractSolidVM' :: Should CacheNonce -> ContractParameters -> Signer -> Bloc BlocTransactionResult
postUsersContractSolidVM' cacheNonce ContractParameters{..} sign = blocTransaction $ do
  params <- getAccountTxParams cacheNonce fromAddr chainId txParams
  --We might be able to get rid of the metadata for SolidVM, but that will require a change in the API, and needs to be discussed
  $logInfoLS "postUsersContractSolidVM'/args" args
  (cName,(cmId,ContractDetails{..})) <- getContractDetailsForContract "SolidVM" src contract >>= \case
    Nothing -> throwIO $ UserError "You need to supply at least one contract in the source" --remove
    Just x -> pure x

  let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
  (_, argsAsSource) <- constructArgValuesAndSource args xabiArgs

  let metadata' = Just $ fromMaybe Map.empty metadata `Map.union` Map.fromList [("name", cName), ("args", argsAsSource)]

  tx <- signAndPrepare sign fromAddr metadata' $
    TransactionHeader
      Nothing
      fromAddr
      params
      (Wei (fromIntegral (maybe 0 unStrung value)))
      (Code . BC.pack $ Text.unpack src)
      chainId
  $logDebugLS "postUsersContractSolidVM'/tx" tx
  txHash <- blocStrato $ postTx tx
  $logInfoLS "postUsersContractSolidVM'/hash" txHash
  void . blocModify $ \conn -> runInsertMany conn hashNameTable [
    ( Nothing
    , constant txHash
    , constant cmId
    , constant (1 :: Int32)
    , constant contractdetailsName
    )]
  getBlocTransactionResult' [txHash] resolve

postUsersUploadList :: UserName -> Address -> Maybe ChainId -> Bool -> UploadListRequest -> Bloc [BlocTransactionResult]
postUsersUploadList userName addr chainId resolve (UploadListRequest pw contracts msrcs _resolve) = do
  sk <- getAccountSecKey userName pw addr
  let getSrc c = uploadlistcontractSrc c <|> (msrcs >>= Map.lookup (uploadlistcontractContractName c))
      setSrc c = c{uploadlistcontractSrc = getSrc c}
      bclp = ContractListParameters
               addr
               (setSrc <$> contracts)
               chainId
               (resolve || _resolve)
      cacheNonce = Don't CacheNonce
  case Map.lookup "VM" =<< uploadlistcontractMetadata (head contracts) of  --Determine VM option by the metadata of the first tx in list
    Just "EVM" -> postUsersUploadListEVM' cacheNonce bclp (return . signTransaction sk)
    Just "SolidVM" -> postUsersUploadListSolidVM' cacheNonce bclp (return . signTransaction sk)
    Nothing -> postUsersUploadListEVM' cacheNonce bclp (return . signTransaction sk) -- The EVM is the default VM
    Just vmName -> throwIO $ UserError $ Text.pack $ "Invalid value for VM choice: " ++ show vmName ++ ", valid options are 'EVM' or 'SolidVM'"

postUsersUploadListSolidVM' :: Should CacheNonce -> ContractListParameters -> Signer -> Bloc [BlocTransactionResult]
postUsersUploadListSolidVM' cacheNonce ContractListParameters{..} sign = do
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
            (Code . BC.pack $ Text.unpack src)
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

postUsersUploadListEVM' :: Should CacheNonce -> ContractListParameters -> Signer -> Bloc [BlocTransactionResult]
postUsersUploadListEVM' cacheNonce ContractListParameters{..} sign = do
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
              let (b, leftOver) = Base16.decode b16
              unless (ByteString.null leftOver) $ throwIO $ AnError "Couldn't decode binary"
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
            (Code $ bin <> argsBin)
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

postUsersSendList :: UserName -> Address -> Maybe ChainId -> Bool -> PostSendListRequest -> Bloc [BlocTransactionResult]
postUsersSendList userName addr chainId resolve (PostSendListRequest pw resolve' txs) = do
  sk <- getAccountSecKey userName pw addr
  let btlp = TransferListParameters
               addr
               txs
               chainId
               (resolve || resolve')
  postUsersSendList' (Don't CacheNonce) btlp (return . signTransaction sk)

postUsersSendList' :: Should CacheNonce -> TransferListParameters -> Signer -> Bloc [BlocTransactionResult]
postUsersSendList' cacheNonce TransferListParameters{..} sign = do
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
        signAndPrepare sign fromAddr md header
    ) txsWithParams
  hashes <- blocStrato $ postTxList txs''
  void . blocModify $ \conn -> runInsertMany conn hashNameTable
    [( Nothing
    , constant txHash
    , constant (0 :: Int32)
    , constant (0 :: Int32)
    , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode tx)
    )
    | (tx,txHash) <- zip txs'' hashes
    ]
  getBatchBlocTransactionResult' hashes resolve

ensureMostRecentSuccessfulTx
  :: [TransactionResult]
  -> Bloc TransactionResult
ensureMostRecentSuccessfulTx results = blocMaybe err . listToMaybe $
  filter ((== "Success!") . transactionResultMessage)
    (sortOn (negate . transactionResultTime) results)
  where
    txHash = transactionResultTransactionHash (head results)
    err = "Transaction with hash "
      <> Text.pack (formatKeccak256WithoutColor txHash)
      <> " never ran successfully."

postUsersContractMethodList
  :: UserName
  -> Address
  -> Maybe ChainId
  -> Bool
  -> PostMethodListRequest
  -> Bloc [BlocTransactionResult]
postUsersContractMethodList userName userAddr chainId resolve PostMethodListRequest{..} = do
  sk <- getAccountSecKey userName postmethodlistrequestPassword userAddr
  let bflp = FunctionListParameters
               userAddr
               postmethodlistrequestTxs
               chainId
               (resolve || postmethodlistrequestResolve)
  postUsersContractMethodList' (Don't CacheNonce) bflp (return . signTransaction sk)

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

postUsersContractMethodList' :: Should CacheNonce -> FunctionListParameters -> Signer -> Bloc [BlocTransactionResult]
postUsersContractMethodList' cacheNonce FunctionListParameters{..} sign = do
  if null txs
    then return []
    else do
      let txsWithChainids = map (methodcallChainid %~ (<|> chainId)) txs
      txsWithParams <- genNonces cacheNonce fromAddr methodcallChainid methodcallTxParams txsWithChainids
      txsCmIdsFuncNames <- forStateT Map.empty txsWithParams $
        \(MethodCall{..}) -> do
          mtuple <- use $ at methodcallContractName
          (mapKey, xabi) <- case mtuple of
            Just (cmId, x) -> return (cmId, x)
            Nothing -> do
              (mapKey' :: Int32,x') <- lift $ blocQuery1 "postUsersContractMethodList'" $ proc () -> do
                (_,_,_,_,_,_,cmId,x'') <- getContractsContractLatestQuery methodcallContractName -< ()
                returnA -< (cmId,x'')
              x <- lift $ deserializeXabi x'
              at methodcallContractName <?= (mapKey', x)
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
          tx <- lift . signAndPrepare sign fromAddr methodcallMetadataWithCallInfo $
            TransactionHeader
              (Just methodcallContractAddress)
              fromAddr
              (fromMaybe emptyTxParams _methodcallTxParams)
              (Wei (fromIntegral $ unStrung methodcallValue))
              (Code $ sel <> argsBin)
              _methodcallChainid
          -- resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
          return (tx,mapKey,methodcallMethodName)
      let finalTxs = [tx | (tx,_,_) <- txsCmIdsFuncNames]
      mapM_ ($logDebugLS "postUsersContractMethodList'/txs") finalTxs
      hashes <- blocStrato $ postTxList finalTxs
      mapM_ ($logInfoLS "postUsersContractMethodList'/hashes") hashes
      void . blocModify $ \conn -> runInsertMany conn hashNameTable
        [( Nothing
        , constant txHash
        , constant cmId
        , constant (2 :: Int32)
        , constant funcName
        )
        | (txHash,(_,cmId, funcName)) <- zip hashes txsCmIdsFuncNames
        ]
      getBatchBlocTransactionResult' hashes resolve

postUsersContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> Maybe ChainId
  -> Bool
  -> PostUsersContractMethodRequest
  -> Bloc BlocTransactionResult
postUsersContractMethod
  userName
  userAddr
  (ContractName contractName)
  contractAddr
  chainId
  resolve
  (PostUsersContractMethodRequest password funcName args value mTxParams md) = do
    sk <- getAccountSecKey userName password userAddr
    let bfp = FunctionParameters
                userAddr
                contractName
                contractAddr
                funcName
                args
                value
                mTxParams
                md
                chainId
                resolve
    postUsersContractMethod' (Don't CacheNonce) bfp (return . signTransaction sk)

postUsersContractMethod' :: Should CacheNonce -> FunctionParameters -> Signer -> Bloc BlocTransactionResult
postUsersContractMethod' cacheNonce FunctionParameters{..} sign = do
    params <- getAccountTxParams cacheNonce fromAddr chainId txParams

    let err = CouldNotFind $ Text.concat
                [ "postUsersContractMethod': Couldn't find contract details for "
                , contractName
                , " at address "
                , Text.pack $ formatAddressWithoutColor contractAddr
                ]
    (cmId,xabi) <- maybe (throwIO err) (return . fmap contractdetailsXabi) =<<
      getContractDetailsAndMetadataId
        (ContractName contractName)
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

    tx <- signAndPrepare sign fromAddr (Just metadataWithCallInfo) $
      TransactionHeader
        (Just contractAddr)
        fromAddr
        params
        (Wei (maybe 0 (fromIntegral . unStrung) value))
        (Code $ (sel::ByteString) <> (argsBin::ByteString))
        chainId
    $logDebugLS "postUsersContractMethod'/tx" tx
    txHash <- blocStrato $ postTx tx
    $logInfoLS "postUsersContractMethod'/hash" txHash
    void . blocModify $ \conn -> runInsertMany conn hashNameTable [
      ( Nothing
      , constant txHash
      , constant cmId
      , constant (2 :: Int32)
      , constant funcName
      )]
    getBlocTransactionResult' [txHash] resolve

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
          Just _ -> lift $ throwIO $ UserError "Contract failed to upload, likely because the constructor threw"
          Nothing -> lift $ throwIO $ UserError "Transaction succeeded, but contract was neither created, nor destroyed"
      stratoMsg  -> lift $ throwIO $ UserError $ Text.pack stratoMsg
    Just acct -> do
      let cn = ContractName name
      mdetails <- use $ contractDetailsMap . at cn
      details <- case mdetails of
        Just details' -> return details'{contractdetailsAccount = Just acct}
        Nothing -> do
          cds <- lift $ getContractDetailsByMetadataId cmId acct
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
    [] -> do
      requireBalance <- asks gasOn
      if requireBalance then throwIO . UserError $ "User does not have a balance"
      else return $ Map.fromList [(Nothing, Nonce $ fromInteger 0)]
    accts -> do
      let mkCid AddressStateRef{..} = ChainId <$> toMaybe 0 addressStateRefChainId
          mkNonce AddressStateRef{..} = Nonce $ fromInteger addressStateRefNonce
      return . Map.fromList $ map (mkCid &&& mkNonce) accts

getAccountSecKey :: UserName -> Password -> Address -> Bloc SecKey
getAccountSecKey userName password addr = do
  uIds <- blocQuery . getUserIdQuery $ userName
  cryptos <- case listToMaybe uIds of
    Nothing -> throwIO . UserError $
      "no user found with name: " <> getUserName userName
    Just uId -> blocQuery $ proc () -> do
      (_,salt,_,nonce,encSecKey,_,addr',uId') <-
        queryTable keyStoreTable -< ()
      restrict -< uId' .== constant (uId::Int32)
        .&& addr' .== constant addr
      returnA -< (salt,nonce,encSecKey)
  skMaybe <- case listToMaybe cryptos of
    Nothing -> throwIO . UserError $
      "address does not exist for user:" <> getUserName userName
    Just (salt,nonce,encSecKey) -> return $
      decryptSecKey password salt nonce encSecKey
  case skMaybe of
    Nothing -> throwIO $ UserError "incorrect password"
    Just sk -> return sk

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

signAndPrepare :: Signer -> Address -> Maybe (Map Text Text) -> TransactionHeader -> Bloc RawTransaction'
signAndPrepare sign from md th = do
  time <- liftIO getCurrentTime
  fmap (preparePostTx time from . addMetadata md) . sign $ prepareUnsignedTx th
