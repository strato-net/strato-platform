{-# LANGUAGE Arrows              #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE Rank2Types          #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Users where

import           ClassyPrelude                     ((<>))
import           Control.Concurrent
import           Control.Concurrent.Async.Lifted
import           Control.Arrow
import           Control.Exception.Lifted          (catch)
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
import           Data.Either
import           Data.Foldable
import           Data.Int                          (Int32)
import           Data.List                         (sortOn)
import           Data.Map.Strict                   (Map)
import qualified Data.Map.Strict                   as Map
import qualified Data.Map.Ordered                  as OMap
import           Data.Maybe
import           Data.RLP
import           Data.Set                          (isSubsetOf)
import qualified Data.Set                          as S
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Traversable
import           Opaleye                           hiding (not, null, index)
import           Database.PostgreSQL.Simple        (SqlError(..))

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
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types            hiding (Transaction (..))
import           BlockApps.XAbiConverter

data TransactionHeader = TransactionHeader
  { transactionheaderToAddr   :: Maybe Address
  , transactionheaderFromAddr :: Address
  , transactionheaderTxParams :: TxParams
  , transactionheaderValue    :: Wei
  , transactionheaderCode     :: ByteString
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

forStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m ([b],s)
forStateT s [] _ = return ([],s)
forStateT s (a:as) run = do
  (b,s') <- runStateT (run a) s
  (bs,s'') <- forStateT s' as run
  return (b:bs,s'')

getUsers :: Bloc [UserName]
getUsers = do
  gtfoMyLawn <- asks deployMode
  case gtfoMyLawn of
    M.Public -> throwError (CouldNotFind "no /users endpoint. thank.")
    M.Enterprise -> blocTransaction $ map UserName <$> blocQuery getUsersQuery

getUsersUser :: UserName -> Bloc [Address]
getUsersUser (UserName name) = blocTransaction $
  blocQuery $ getUsersUserQuery name

postUsersUser :: UserName -> Password -> Bloc Address
postUsersUser (UserName name) pass = blocTransaction $ do
  keyStore <- newKeyStore pass
  createdUser <- blocModify $ postUsersUserQuery name keyStore
  unless createdUser (throwError (DBError "failed to create user"))
  return $ keystoreAcctAddress keyStore

getUsersKeyStore :: UserName -> Address -> Password -> Bloc KeyStore
getUsersKeyStore userName addr password = do
  let err = throwError . UserError $ "invalid username or password"
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
  let err = throwError . UserError $ "invalid username or password"
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
          \s@SqlError{..} -> throwError . AlreadyExists $
            "keystore could not be inserted: " <> Text.pack (show s)

waitForBalance :: Address -> Bloc ()
waitForBalance addr = waitFor "no user account found" go
  where go :: Bloc Bool
        go = do
          let params = accountsFilterParams{qaAddress = Just addr}
          accts <- blocStrato $ getAccountsFilter params
          $logInfoLS "waitForBalance/req" params
          $logInfoLS "waitForBalance/resp" accts
          return $ not (null accts || accountBalance (head accts) == Strung 0)

postUsersFill :: UserName  -> Address -> Bool -> Bloc BlocTransactionResult
postUsersFill _ addr resolve = blocTransaction $ do
  when resolve ($logInfoS "postUsersFill" "Waiting for faucet transaction to be mined")
  hashes <- blocStrato $ postFaucet addr
  void . blocModify $ \conn -> runInsertMany conn hashNameTable [
    ( Nothing
    , constant h
    , constant (0 :: Int32)
    , constant (0 :: Int32)
    , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode defaultPostTx{posttransactionTo = Just addr})
    ) | h <- hashes]
  result <- getBlocTransactionResult' Nothing hashes resolve
  when (resolve && Success == blocTransactionStatus result) $ do
    waitForBalance addr
  $logInfoLS "postUsersFill/resolve" resolve
  $logInfoLS "postUsersFill/result" result
  when (Failure == blocTransactionStatus result) $
    throwError $ UnavailableError "faucet transaction failed; please try again"
  return result

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
    postUsersSend' btp (return . signTransaction sk)

postUsersSend' :: TransferParameters -> Signer -> Bloc BlocTransactionResult
postUsersSend' TransferParameters{..} sign = do
    params <- getAccountTxParams fromAddress chainId txParams
    tx <- signAndPrepare sign fromAddress metadata $
      TransactionHeader
        (Just toAddress)
        fromAddress
        params
        (Wei (fromIntegral $ unStrung value))
        ByteString.empty
        chainId
    hash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsertMany conn hashNameTable [
      ( Nothing
      , constant hash
      , constant (0 :: Int32)
      , constant (0 :: Int32)
      , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode tx)
      )]
    getBlocTransactionResult' chainId [hash] resolve

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
  case join $ fmap (Map.lookup "VM") $ md of
    Just "EVM" -> postUsersContractEVM' bcp (return . signTransaction sk)
    Just "SolidVM" -> postUsersContractSolidVM' bcp (return . signTransaction sk)
    Nothing -> postUsersContractEVM' bcp (return . signTransaction sk) -- The EVM is the default VM
    Just vmName -> throwError $ UserError $ Text.pack $ "Invalid value for VM choice: " ++ show vmName ++ ", valid options are 'EVM' or 'SolidVM'"

postUsersContractEVM' :: ContractParameters -> Signer -> Bloc BlocTransactionResult
postUsersContractEVM' ContractParameters{..} sign = blocTransaction $ do
  params <- getAccountTxParams fromAddr chainId txParams
  --TODO: check what happens with mismatching args
  idsAndDetails <- sourceToContractDetails (Do Compile) src
  $logInfoLS "postUsersContractEVM'/args" args
  (cName,(cmId,ContractDetails{..})) <-
    case contract of
     Nothing ->
       case Map.toList idsAndDetails of
         [] -> throwError $ UserError "You need to supply at least one contract in the source"
         [x] -> return x
         _ -> throwError $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
     Just contract' -> (,) contract' <$> blocMaybe "Could not find global contract metadataId" (Map.lookup contract' idsAndDetails)
  let
    (bin,leftOver) = Base16.decode $ Text.encodeUtf8 contractdetailsBin
    metadata' = Just $ fromMaybe Map.empty metadata `Map.union` Map.fromList [("src", src),("name", cName)]
  unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
  let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
  argsBin <- constructArgValues (fmap (fmap argValueToText) args) xabiArgs
  tx <- signAndPrepare sign fromAddr metadata' $
    TransactionHeader
      Nothing
      fromAddr
      params
      (Wei (fromIntegral (maybe 0 unStrung value)))
      (bin <> argsBin)
      chainId
  $logInfoLS "postUsersContractEVM'/tx" tx
  hash <- blocStrato $ postTx tx
  void . blocModify $ \conn -> runInsertMany conn hashNameTable [
    ( Nothing
    , constant hash
    , constant cmId
    , constant (1 :: Int32)
    , constant contractdetailsName
    )]
  getBlocTransactionResult' chainId [hash] resolve

postUsersContractSolidVM' :: ContractParameters -> Signer -> Bloc BlocTransactionResult
postUsersContractSolidVM' ContractParameters{..} sign = blocTransaction $ do
  params <- getAccountTxParams fromAddr chainId txParams
  --We might be able to get rid of the metadata for SolidVM, but that will require a change in the API, and needs to be discussed
  idsAndDetails <- sourceToContractDetails (Don't Compile) src
  (cName,(cmId,ContractDetails{..})) <-
    case contract of
     Nothing ->
       case Map.toList idsAndDetails of
         [] -> throwError $ UserError "You need to supply at least one contract in the source" --remove
         [x] -> return x
         _ -> throwError $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data" --remove
     Just contract' -> (,) contract' <$> blocMaybe "Could not find global contract metadataId" (Map.lookup contract' idsAndDetails)
  $logInfoLS "postUsersContractSolidVM'/args" args

  let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
  (_, argsAsSource) <- constructArgValuesAndSource (fmap (fmap argValueToText) args) xabiArgs

  let metadata' = Just $ fromMaybe Map.empty metadata `Map.union` Map.fromList [("name", cName), ("args", argsAsSource)]

  tx <- signAndPrepare sign fromAddr metadata' $
    TransactionHeader
      Nothing
      fromAddr
      params
      (Wei (fromIntegral (maybe 0 unStrung value)))
      (BC.pack $ Text.unpack src)
      chainId
  $logInfoLS "postUsersContractSolidVM'/tx" tx
  hash <- blocStrato $ postTx tx
  void . blocModify $ \conn -> runInsertMany conn hashNameTable [
    ( Nothing
    , constant hash
    , constant cmId
    , constant (1 :: Int32)
    , constant contractdetailsName
    )]
  getBlocTransactionResult' chainId [hash] resolve

postUsersUploadList :: UserName -> Address -> Maybe ChainId -> Bool -> UploadListRequest -> Bloc [BlocTransactionResult]
postUsersUploadList userName addr chainId resolve (UploadListRequest pw contracts _resolve) = do
  sk <- getAccountSecKey userName pw addr
  let bclp = ContractListParameters
               addr
               contracts
               chainId
               (resolve || _resolve)
  case join $ fmap (Map.lookup "VM") $ uploadlistcontractMetadata (head contracts) of  --Determine VM option by the metadata of the first tx in list
    Just "EVM" -> postUsersUploadListEVM' bclp (return . signTransaction sk)
    Just "SolidVM" -> postUsersUploadListSolidVM' bclp (return . signTransaction sk)
    Nothing -> postUsersUploadListEVM' bclp (return . signTransaction sk) -- The EVM is the default VM
    Just vmName -> throwError $ UserError $ Text.pack $ "Invalid value for VM choice: " ++ show vmName ++ ", valid options are 'EVM' or 'SolidVM'"

postUsersUploadListSolidVM' :: ContractListParameters -> Signer -> Bloc [BlocTransactionResult]
postUsersUploadListSolidVM' ContractListParameters{..} sign = do
  txsWithParams <- genNonces (getAccountNonce fromAddr chainId) uploadlistcontractTxParams contracts
  namesCmIdsTxs <- fmap fst . forStateT Map.empty txsWithParams $
    \(UploadListContract name args params value md) -> do
      mtuple <- use $ at name
      (_, src, cmId, xabi) <- case mtuple of
        Just (b, src, cmId', x) -> return (b, src, cmId', x)
        Nothing -> do
          mContract <- lift . blocQueryMaybe $ proc () -> do
            (bin16,_,_,_,_,src,cmId',x'') <- getContractsContractLatestQuery name -< ()
            returnA -< (bin16,src,cmId',x'')
          case mContract of
            Nothing -> throwError . UserError $ Text.concat
              [ "Upload List: When deploying multiple contract creation transactions, "
              , "the contracts' source code must be uploaded via the /compile route "
              , "ahead of time. Please try uploading the contracts' source code via "
              , "the /compile route, and try again. If you continue to receive this "
              , "error message, please contact your administrator."
              ]
            Just (b16,src,(cmId' :: Int32),x') -> do
              let (b, leftOver) = Base16.decode b16
              unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
              x <- lift $ deserializeXabi x'
              at name <?= (b, src, cmId', x)
      let xabiArgs = maybe Map.empty funcArgs $ xabiConstr xabi
      (_, argsAsSource) <- lift $ constructArgValuesAndSource (Just (fmap argValueToText args)) xabiArgs

      let metadata' = Just $ fromMaybe Map.empty md `Map.union` Map.fromList [("name", name), ("args", argsAsSource)]
      tx <- lift . signAndPrepare sign fromAddr metadata' $
          TransactionHeader
            Nothing
            fromAddr
            (fromMaybe emptyTxParams params)
            (Wei (maybe 0 fromIntegral $ fmap unStrung value))
            (BC.pack $ Text.unpack src)
            chainId
      return ((name,cmId),tx)
  let
    txs = map snd namesCmIdsTxs
  hashes <- blocStrato (postTxList txs)
  void . blocModify $ \conn -> runInsertMany conn hashNameTable
    [( Nothing
    , constant hash
    , constant cmId
    , constant (1 :: Int32)
    , constant name
    )
    | (hash,(name,cmId)) <- zip hashes (map fst namesCmIdsTxs)
    ]
  getBatchBlocTransactionResult' chainId hashes resolve

              
postUsersUploadListEVM' :: ContractListParameters -> Signer -> Bloc [BlocTransactionResult]
postUsersUploadListEVM' ContractListParameters{..} sign = do
  txsWithParams <- genNonces (getAccountNonce fromAddr chainId) uploadlistcontractTxParams contracts
  namesCmIdsTxs <- fmap fst . forStateT Map.empty txsWithParams $
    \(UploadListContract name args params value md) -> do
      mtuple <- use $ at name
      (bin, src, cmId, xabi) <- case mtuple of
        Just (b, src, cmId', x) -> return (b, src, cmId', x)
        Nothing -> do
          mContract <- lift . blocQueryMaybe $ proc () -> do
            (bin16,_,_,_,_,src,cmId',x'') <- getContractsContractLatestQuery name -< ()
            returnA -< (bin16,src,cmId',x'')
          case mContract of
            Nothing -> throwError . UserError $ Text.concat
              [ "Upload List: When deploying multiple contract creation transactions, "
              , "the contracts' source code must be uploaded via the /compile route "
              , "ahead of time. Please try uploading the contracts' source code via "
              , "the /compile route, and try again. If you continue to receive this "
              , "error message, please contact your administrator."
              ]
            Just (b16,src,(cmId' :: Int32),x') -> do
              let (b, leftOver) = Base16.decode b16
              unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
              x <- lift $ deserializeXabi x'
              at name <?= (b, src, cmId', x)
      let xabiArgs = maybe Map.empty funcArgs $ xabiConstr xabi
      argsBin <- lift $ constructArgValues (Just (fmap argValueToText args)) xabiArgs
      let metadata' = Just $ fromMaybe Map.empty md `Map.union` Map.fromList [("src",src),("name",name)]
      tx <- lift . signAndPrepare sign fromAddr metadata' $
          TransactionHeader
            Nothing
            fromAddr
            (fromMaybe emptyTxParams params)
            (Wei (maybe 0 fromIntegral $ fmap unStrung value))
            (bin <> argsBin)
            chainId
      return ((name,cmId),tx)
  let
    txs = map snd namesCmIdsTxs
  hashes <- blocStrato (postTxList txs)
  void . blocModify $ \conn -> runInsertMany conn hashNameTable
    [( Nothing
    , constant hash
    , constant cmId
    , constant (1 :: Int32)
    , constant name
    )
    | (hash,(name,cmId)) <- zip hashes (map fst namesCmIdsTxs)
    ]
  getBatchBlocTransactionResult' chainId hashes resolve

postUsersSendList :: UserName -> Address -> Maybe ChainId -> Bool -> PostSendListRequest -> Bloc [BlocTransactionResult]
postUsersSendList userName addr chainId resolve (PostSendListRequest pw resolve' txs) = do
  sk <- getAccountSecKey userName pw addr
  let btlp = TransferListParameters
               addr
               txs
               chainId
               (resolve || resolve')
  postUsersSendList' btlp (return . signTransaction sk)

postUsersSendList' :: TransferListParameters -> Signer -> Bloc [BlocTransactionResult]
postUsersSendList' TransferListParameters{..} sign = do
  txsWithParams <- genNonces (getAccountNonce fromAddr chainId) sendtransactionTxParams txs
  txs' <- mapM
    (\(SendTransaction toAddr (Strung value) params md) -> do
        let header = TransactionHeader
              (Just toAddr)
              fromAddr
              (fromMaybe emptyTxParams params)
              (Wei $ fromIntegral value)
              (ByteString.empty)
              chainId
        signAndPrepare sign fromAddr md header
    ) txsWithParams
  hashes <- blocStrato $ postTxList txs'
  void . blocModify $ \conn -> runInsertMany conn hashNameTable
    [( Nothing
    , constant hash
    , constant (0 :: Int32)
    , constant (0 :: Int32)
    , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode tx)
    )
    | (tx,hash) <- zip txs' hashes
    ]
  getBatchBlocTransactionResult' chainId hashes resolve

ensureMostRecentSuccessfulTx
  :: [TransactionResult]
  -> Bloc TransactionResult
ensureMostRecentSuccessfulTx results = blocMaybe err . listToMaybe $
  filter ((== "Success!") . transactionresultMessage)
    (sortOn (negate . transactionresultTime) results)
  where
    hash = transactionresultTransactionHash (head results)
    err = "Transaction with hash "
      <> Text.pack (keccak256String hash)
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
  postUsersContractMethodList' bflp (return . signTransaction sk)

genNonces :: (Show a, Monad m) => m Nonce -> Lens' a (Maybe TxParams) -> [a] -> m [a]
genNonces n l as = do
  let noncesInUse = S.fromList $ mapMaybe (txparamsNonce <=< view l) as
  nonce <- if S.size noncesInUse == length as
            then return . Nonce . error $ "internal error: unused nonce when already specified " ++ show as
            else n
  return . fst . runIdentity . forStateT nonce as $ \a -> do
    let params' = fromMaybe emptyTxParams (a ^. l)
    newNonce <- case txparamsNonce params' of
      Just v -> return v
      Nothing -> do
        whileM $ do
          inUse <- gets (`S.member` noncesInUse)
          when inUse $ id += 1
          return inUse
        id <<+= 1
    return $ (l .~ Just params'{txparamsNonce = Just newNonce }) a

postUsersContractMethodList' :: FunctionListParameters -> Signer -> Bloc [BlocTransactionResult]
postUsersContractMethodList' FunctionListParameters{..} sign = do
  if null txs
    then return []
    else do
      txsWithParams <- genNonces (getAccountNonce fromAddr chainId) methodcallTxParams txs
      txsCmIdsFuncNames <- fmap fst . forStateT Map.empty txsWithParams $
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
            Left err -> throwError . AnError $ Text.pack err
            Right c -> return c
          let maybeFunc = OMap.lookup methodcallMethodName (fields $ C.mainStruct contract')

          sel <-
            case maybeFunc of
             Just (_, TypeFunction selector _ _) -> return selector
             _ -> lift $ throwError . UserError $ "Contract doesn't have a method named '" <> methodcallMethodName <> "'"
          let xabiArgs = maybe Map.empty funcArgs . Map.lookup methodcallMethodName $ xabiFuncs xabi
          (argsBin, argsAsSource) <-
            lift $ constructArgValuesAndSource (Just (fmap argValueToText methodcallArgs)) xabiArgs
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
              (sel <> argsBin)
              chainId
          -- resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
          return (tx,mapKey,methodcallMethodName)
      let txs' = [tx | (tx,_,_) <- txsCmIdsFuncNames]
      mapM_ ($logInfoLS "postUsersContractMethodList'/txs") txs'
      hashes <- blocStrato $ postTxList txs'
      void . blocModify $ \conn -> runInsertMany conn hashNameTable
        [( Nothing
        , constant hash
        , constant cmId
        , constant (2 :: Int32)
        , constant funcName
        )
        | (hash,(_,cmId, funcName)) <- zip hashes txsCmIdsFuncNames
        ]
      getBatchBlocTransactionResult' chainId hashes resolve

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
    postUsersContractMethod' bfp (return . signTransaction sk)

postUsersContractMethod' :: FunctionParameters -> Signer -> Bloc BlocTransactionResult
postUsersContractMethod' FunctionParameters{..} sign = do
    params <- getAccountTxParams fromAddr chainId txParams

    let err = UserError $ Text.concat
                [ "postUsersContractMethod': Couldn't find contract details for "
                , contractName
                , " at address "
                , Text.pack $ addressString contractAddr
                ]
    (cmId,xabi) <- maybe (throwError err) (return . fmap contractdetailsXabi) =<<
      getContractDetailsAndMetadataId
        (ContractName contractName)
        (Unnamed contractAddr)
        chainId
    contract' <- case xAbiToContract xabi of
      Left e -> throwError . AnError $ Text.pack e
      Right c -> return c

    let maybeFunc = OMap.lookup funcName (fields $ C.mainStruct contract')
        xabiArgs = maybe Map.empty funcArgs . Map.lookup funcName $ xabiFuncs xabi

    sel <-
      case maybeFunc of
       Just (_, TypeFunction selector _ _) -> return selector
       _ -> throwError . UserError $ "Contract doesn't have a method named '" <> funcName <> "'"

    (argsBin, argsAsSource) <- constructArgValuesAndSource (Just (fmap argValueToText args)) xabiArgs
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
        ((sel::ByteString) <> (argsBin::ByteString))
        chainId
    $logInfoLS "postUsersContractMethod'" tx
    hash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsertMany conn hashNameTable [
      ( Nothing
      , constant hash
      , constant cmId
      , constant (2 :: Int32)
      , constant funcName
      )]
    getBlocTransactionResult' chainId [hash] resolve

emptyBatchState :: BatchState
emptyBatchState = BatchState Map.empty Map.empty

-- getBlocTransactionResult' will return only one of the results
-- when multiple hashes are provided. This is a glass-half-full
-- function, and if one TX succeeds then the result is a success.
getBlocTransactionResult' :: Maybe ChainId -> [Keccak256] -> Bool -> Bloc BlocTransactionResult
getBlocTransactionResult' _ [] _ = throwError $ AnError "getBlockTransactionResult': no TX hashes"
getBlocTransactionResult' chainId hashes@(txh:_) resolve =
  if resolve
    then do
      promises <- forM hashes $ \h -> async (getBlocTransactionResult h chainId True)
      results <- mapM wait promises
      $logInfoLS "getBlockTransactionResult'/results" results
      case filter ((== Success) . blocTransactionStatus) results of
        (winner:_) -> return winner
        [] -> return $ head results
    else return $ BlocTransactionResult Pending txh Nothing Nothing

getBlocTransactionResult :: Keccak256 -> Maybe ChainId -> Bool -> Bloc BlocTransactionResult
getBlocTransactionResult hash chainId resolve = fmap head $ postBlocTransactionResults chainId resolve [hash]

getBatchBlocTransactionResult' :: Maybe ChainId -> [Keccak256] -> Bool -> Bloc [BlocTransactionResult]
getBatchBlocTransactionResult' chainId hashes resolve = do
  if resolve
    then (postBlocTransactionResults chainId True hashes)
    else do
      forM hashes $ \h -> return (BlocTransactionResult Pending h Nothing Nothing)

postBlocTransactionResults :: Maybe ChainId -> Bool -> [Keccak256] -> Bloc [BlocTransactionResult]
postBlocTransactionResults chainId resolve hashes = recurseTRDs chainId resolve hashes >>= evalAndReturn

recurseTRDs :: Maybe ChainId
            -> Bool
            -> [Keccak256]
            -> Bloc [TRD]
recurseTRDs chainId resolve hashes = go 0 (toPending hashes)
  where
    go :: Int -> [TRD] -> Bloc [TRD]
    go num list = do
      let his = map (trdHash &&& trdIndex) list
      statusAndMtxrs <- flip zip his <$> getBatchBlocTxStatus chainId (map fst his)
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
              $logInfoLS "recurseTRDs/pending'" $ map trdHash pending'
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
evalAndReturn list = fmap fst . forStateT emptyBatchState list $
    \(TRD status hash _ mtxr) -> case status of
        Pending -> return $ BlocTransactionResult Pending hash Nothing Nothing
        Failure -> return $ BlocTransactionResult Failure hash mtxr Nothing
        Success -> do
          (cmId,ttype,tdata)::(Int32,Int32,Text) <- lift $ blocQuery1 "evalAndReturn" $ contractByTxHash hash
          case ttype of
            0 -> return $ BlocTransactionResult Success hash mtxr (Just . Send . fromJust . Aeson.decode . BL.fromStrict $ Text.encodeUtf8 tdata)
            1 -> contractResult hash mtxr cmId tdata
            2 -> functionResult hash mtxr cmId tdata
            _ -> error $ "Unexpected transaction type: got" ++ show ttype

contractResult :: Keccak256
               -> Maybe TransactionResult
               -> Int32
               -> Text
               -> StateT BatchState Bloc BlocTransactionResult
contractResult hash mtxr cmId name = do
  let
    Just txResult = mtxr
    chainId = transactionresultChainId txResult
    addressMaybe = do
      str <- listToMaybe $
        Text.splitOn "," (transactionresultContractsCreated txResult)
      stringAddress $ Text.unpack str
  case addressMaybe of
    Nothing -> case transactionresultMessage txResult of
      "Success!" -> do
        let mDelAddr = stringAddress . Text.unpack =<<
              (listToMaybe . Text.splitOn "," $ transactionresultContractsDeleted txResult)
        case mDelAddr of
          Just _ -> lift $ throwError $ UserError "Contract failed to upload, likely because the constructor threw"
          Nothing -> lift $ throwError $ UserError "Transaction succeeded, but contract was neither created, nor destroyed"
      stratoMsg  -> lift $ throwError $ UserError stratoMsg
    Just addr' -> do
      let cn = ContractName name
      mdetails <- use $ contractDetailsMap . at cn
      details <- case mdetails of
        Just details' -> return details'{contractdetailsAddress = Just (Unnamed addr')}
        Nothing -> do
          cds <- lift $ getContractDetailsByMetadataId cmId (Unnamed addr') chainId
          contractDetailsMap . at cn <?= cds
      return $ BlocTransactionResult Success hash mtxr (Just $ Upload details)

functionResult :: Keccak256
               -> Maybe TransactionResult
               -> Int32
               -> Text
               -> StateT BatchState Bloc BlocTransactionResult
functionResult hash mtxr cmId funcName = do
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
      either (throwError . UserError . Text.pack) return $
        xabiTypeToType xabi indexedTypeType
  let mappedResultTypes = map convertEnumTypeToInt orderedResultTypes
      txResp = transactionresultResponse txResult
    -- TODO::(map convertEnumTypeToInt orderedResultTypes) is currenlty a
    -- workaround for enums
      mFormattedResponse = convertResultResToVals txResp mappedResultTypes
  case transactionresultMessage txResult of
    "Success!" -> do
      formattedResponse <- lift $ blocMaybe ("Failed to parse response: " <> txResp) mFormattedResponse
      return $ BlocTransactionResult Success hash mtxr (Just $ Call formattedResponse)
    stratoMsg  -> lift $ throwError $ UserError stratoMsg

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType $ TypeInt False $ Just 32
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty

convertResultResToVals :: Text -> [Type] -> Maybe [SolidityValue]
convertResultResToVals txResp responseTypes =
  let byteResp = fst (Base16.decode (Text.encodeUtf8 txResp))
  in map valueToSolidityValue <$> bytestringToValues byteResp responseTypes

getArgValues :: Map Text Text -> Map Text Xabi.IndexedType -> Bloc [Value]
getArgValues argsMap argNamesTypes = do
    let
      determineValue :: Text -> Xabi.IndexedType -> Bloc (Int32, Value)
      determineValue valStr (Xabi.IndexedType ix xabiType) =
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
          either (blocError . UserError) (return . (ix,)) (textToValue Nothing valStr ty)
    argsVals <-
      if not (Map.keysSet argNamesTypes `isSubsetOf` Map.keysSet argsMap)
      then do
        let
          argNames1 = "(" <> Text.intercalate ", " (Map.keys argNamesTypes) <> ")"
          argNames2 = "(" <> Text.intercalate ", " (Map.keys argsMap) <> ")"
        throwError (UserError ("argument names don't match: " <> argNames1 <> " " <> argNames2))
      else sequence $ Map.intersectionWith determineValue argsMap argNamesTypes
    return $ map snd (sortOn fst (toList argsVals))

constructArgValues :: Maybe (Map Text Text) -> Map Text Xabi.IndexedType -> Bloc ByteString
constructArgValues args argNamesTypes = do
    case args of
      Nothing ->
        if Map.null argNamesTypes
          then return ByteString.empty
          else throwError (UserError "no arguments provided to function.")
      Just argsMap -> do
        vals <- getArgValues argsMap argNamesTypes
        return $ toStorage (ValueArrayFixed (fromIntegral (length vals)) vals)

constructArgValuesAndSource :: Maybe (Map Text Text) -> Map Text Xabi.IndexedType -> Bloc (ByteString, Text)
constructArgValuesAndSource args argNamesTypes = do
    case args of
      Nothing ->
        if Map.null argNamesTypes
          then return (ByteString.empty, "()")
          else throwError (UserError "no arguments provided to function.")
      Just argsMap -> do
        vals <- getArgValues argsMap argNamesTypes
        let valsAsText = map valueToText vals
        return $
          (
            toStorage (ValueArrayFixed (fromIntegral (length vals)) vals),
            "(" <> Text.intercalate "," valsAsText <> ")"
          )

getAccountTxParams :: Address -> Maybe ChainId -> Maybe TxParams -> Bloc TxParams
getAccountTxParams addr chainId mTxParams = do
  let params = fromMaybe emptyTxParams mTxParams
  case txparamsNonce params of
    Nothing -> do
      n <- getAccountNonce addr chainId
      return params{txparamsNonce = Just n}
    Just{} -> return params

getAccountNonce :: Address -> Maybe ChainId -> Bloc Nonce
getAccountNonce addr chainId = do
  let params = accountsFilterParams{qaAddress = Just addr, qaChainId = chainId}
  accts <- blocStrato $ getAccountsFilter params
  $logInfoLS "getAccountNonce/req" params
  $logInfoLS "getAccountNonce/resp" accts
  case listToMaybe accts of
    Nothing   -> throwError . UserError $ "User does not have a balance"
    Just acct -> return $ accountNonce acct

getAccountSecKey :: UserName -> Password -> Address -> Bloc SecKey
getAccountSecKey userName password addr = do
  uIds <- blocQuery . getUserIdQuery $ userName
  cryptos <- case listToMaybe uIds of
    Nothing -> throwError . UserError $
      "no user found with name: " <> getUserName userName
    Just uId -> blocQuery $ proc () -> do
      (_,salt,_,nonce,encSecKey,_,addr',uId') <-
        queryTable keyStoreTable -< ()
      restrict -< uId' .== constant (uId::Int32)
        .&& addr' .== constant addr
      returnA -< (salt,nonce,encSecKey)
  skMaybe <- case listToMaybe cryptos of
    Nothing -> throwError . UserError $
      "address does not exist for user:" <> getUserName userName
    Just (salt,nonce,encSecKey) -> return $
      decryptSecKey password salt nonce encSecKey
  case skMaybe of
    Nothing -> throwError $ UserError "incorrect password"
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
  :: Address
  -> Transaction
  -> PostTransaction
preparePostTx from tx = PostTransaction
  { posttransactionHash = kecc
  , posttransactionGasLimit = fromIntegral gasLimit
  , posttransactionCodeOrData = code
  , posttransactionGasPrice = fromIntegral gasPrice
  , posttransactionTo = toAddr
  , posttransactionFrom = from
  , posttransactionValue = Strung $ fromIntegral value
  , posttransactionR = Hex $ fromIntegral r
  , posttransactionS = Hex $ fromIntegral s
  , posttransactionV = Hex v
  , posttransactionNonce = fromIntegral nonce'
  , posttransactionChainId = chainId
  , posttransactionMetadata = metadata
  }
  where
    kecc = keccak256 (rlpSerialize tx)
    r = transactionR tx
    s = transactionS tx
    v = transactionV tx
    Gas gasLimit = transactionGasLimit tx
    Wei gasPrice = transactionGasPrice tx
    Nonce nonce' = transactionNonce tx
    Wei value = transactionValue tx
    code = Text.decodeUtf8 $ Base16.encode $ transactionInitOrData tx
    toAddr = transactionTo tx
    chainId = transactionChainId tx
    metadata = transactionMetadata tx

addMetadata :: Maybe (Map Text Text) -> Transaction -> Transaction
addMetadata m t = t{transactionMetadata = m}

signAndPrepare :: Signer -> Address -> Maybe (Map Text Text) -> TransactionHeader -> Bloc PostTransaction
signAndPrepare sign from md = fmap (preparePostTx from . addMetadata md) . sign . prepareUnsignedTx
