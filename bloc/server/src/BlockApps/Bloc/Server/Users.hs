{-# LANGUAGE Arrows              #-}
{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module BlockApps.Bloc.Server.Users where

import           Control.Arrow
import           Control.Monad.Except
import           Control.Monad.Log
import           Crypto.Secp256k1
import           Data.ByteString                 (ByteString)
import qualified Data.ByteString                 as ByteString
import qualified Data.ByteString.Base16          as Base16
import           Data.Foldable
import           Data.Int                        (Int32)
import           Data.List                       (sortOn)
import           Data.Map.Strict                 (Map)
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Monoid
import           Data.RLP
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import qualified Data.Text.Encoding              as Text
import           Data.Traversable
import           Opaleye

import           BlockApps.Bloc.API.Users
import           BlockApps.Bloc.API.Utils
import           BlockApps.Bloc.Crypto
import           BlockApps.Bloc.Database.Queries
import           BlockApps.Bloc.Database.Tables
import           BlockApps.Bloc.Monad
import           BlockApps.Bloc.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Storage
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Type    as Xabi
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types          hiding (Transaction (..))
import           BlockApps.XAbiConverter

-- Following imported for HTMLifiedPlainText. TODO: Remove when refactoring.

getUsers :: Bloc [UserName]
getUsers = blocTransaction $ map UserName <$> blocQuery getUsersQuery

getUsersUser :: UserName -> Bloc [Address]
getUsersUser (UserName name) = blocTransaction $
  blocQuery $ getUsersUserQuery name

postUsersUser :: UserName -> PostUsersUserRequest -> Bloc Address
postUsersUser (UserName name) (PostUsersUserRequest faucet pass) = blocTransaction $ do
  keyStore <- newKeyStore pass
  createdUser <- blocModify $ postUsersUserQuery name keyStore
  unless createdUser (throwError (DBError "failed to create user"))
  let
    addr = keystoreAcctAddress keyStore
  when (faucet == "1") $ do
    logWith logNotice "Waiting for faucet transaction to be mined"
    blocStrato $ do
      void $ postFaucet addr
      void $ waitNewAccount addr
  return addr

postUsersSend :: UserName -> Address -> PostSendParameters -> Bloc PostTransaction
postUsersSend userName addr
  (PostSendParameters toAddr value password txParams) = do
    tx <- prepareTx
      userName password addr (Just toAddr) (fromMaybe emptyTxParams txParams)
      (Wei (fromIntegral value)) ByteString.empty 0
    hash <- blocStrato $ postTx tx
    void $ pollTxResult hash
    return tx

postUsersContract :: UserName -> Address -> PostUsersContractRequest -> Bloc Address
postUsersContract userName addr
  (PostUsersContractRequest src password contract args txParams value) = blocTransaction $ do
    --TODO: check what happens with mismatching args
    idsAndDetails <- compileContract src
    logWith logNotice ("constructor arguments: " <> Text.pack (show args))
    (cmId,ContractDetails{..}) <- blocMaybe "Could not find global contract metadataId" $
      Map.lookup contract idsAndDetails
    let
      (bin,leftOver) = Base16.decode $ Text.encodeUtf8 contractdetailsBin
    unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
    mFunctionId <- getConstructorId cmId
    argsBin <- buildArgumentByteString args mFunctionId
    tx <- prepareTx
      userName password addr Nothing (fromMaybe emptyTxParams txParams)
      (Wei (fromIntegral value)) (bin <> argsBin) 0
    logWith logNotice ("tx is: " <> Text.pack (show tx))
    hash <- blocStrato $ postTx tx
    txResult <- pollTxResult hash
    let
      addressMaybe = do
        str <- listToMaybe $
          Text.splitOn "," (transactionresultContractsCreated txResult)
        stringAddress $ Text.unpack str
    case addressMaybe of
      Nothing -> case transactionresultMessage txResult of
        "Success!" -> throwError $ AnError "Unknown error while trying to create contract"
        stratoMsg -> throwError $ UserError stratoMsg
      Just addr' -> do
        void . blocModify $ \conn -> runInsert conn contractsInstanceTable
          ( Nothing
          , constant cmId
          , constant addr'
          , Nothing
          )
        return addr'

postUsersUploadList :: UserName -> Address -> UploadListRequest -> Bloc [PostUsersUploadListResponse]
postUsersUploadList userName addr (UploadListRequest pw contracts _resolve) = do
  namesCmIdsTxs <- for (zip contracts [0..]) $ \ (UploadListContract name args txParams value,nonceIncr) -> do
    (bin16,cmId) <- blocQuery1 $ proc () -> do
      (bin16,_,_,_,_,cmId) <- getContractsContractLatestQuery name -< ()
      returnA -< (bin16,cmId)
    let
      (bin,leftOver) = Base16.decode bin16
    unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
    mFunctionId <- getConstructorId cmId
    argsBin <- buildArgumentByteString (Just args) mFunctionId
    tx <- prepareTx
      userName pw addr Nothing (fromMaybe emptyTxParams txParams)
      (Wei (maybe 0 fromIntegral value)) (bin <> argsBin) nonceIncr
    return ((name,cmId),tx)
  let
    namesCmIds = map fst namesCmIdsTxs
    txs = map snd namesCmIdsTxs
  hashes <- blocStrato (postTxList txs)
  -- TODO: use `ensureMostRecentSuccessfulTx`
  results <- unBatchTransactionResult <$> pollTxResultBatch hashes -- pollTxResultBatch will always have at least one result for a hash
  let zipped = resultJoiner <$> zip namesCmIds hashes
      resultJoiner (nc, hash) = (nc, head . fromJust $ Map.lookup hash results)
  resps <- for zipped $ \((name,cmId),txResult) -> do
    let addressMaybe = do
          str <- listToMaybe $ Text.splitOn "," (transactionresultContractsCreated txResult)
          stringAddress (Text.unpack str)
    case addressMaybe of
      Nothing -> case transactionresultMessage txResult of
        "Success!" -> throwError $ AnError "Unknown error while trying to create contract"
        stratoMsg -> throwError $ UserError stratoMsg
      Just addr' -> do
        void . blocModify $ \conn -> runInsert conn contractsInstanceTable
          ( Nothing
          , constant cmId
          , constant addr'
          , Nothing
          )
        getContractDetails (ContractName name) (Unnamed addr')
  return $ PostUsersUploadListResponse <$> resps

postUsersSendList :: UserName -> Address -> PostSendListRequest -> Bloc [PostSendListResponse]
postUsersSendList userName addr (PostSendListRequest pw resolve txs) = do
  txs' <- for (zip txs [0..]) $ \ (SendTransaction toAddr value txParams,nonceIncr) -> prepareTx
    userName pw addr (Just toAddr) (fromMaybe emptyTxParams txParams)
    (Wei (fromIntegral value)) ByteString.empty nonceIncr
  hashes <- blocStrato $ postTxList txs'
  ret <- if resolve
    then do
      resolved <- pollTxResultBatch hashes -- chosen by fair dice roll, guaranteed to have at least one tx result for each hash
      results <- traverse ensureMostRecentSuccessfulTx $
        Map.elems (unBatchTransactionResult resolved)
      senderAccounts <- blocStrato $ getAccountsFilter
        accountsFilterParams{qaAddress = Just addr}
      case senderAccounts of
        [] -> throwError $ AnError "No sender account found"
        senderAccount:_ -> return $
          let strungBalance = Text.pack . show . unStrung $ accountBalance senderAccount
          in const strungBalance <$> results
    else return (Text.pack . keccak256String <$> hashes)
  return $ PostSendListResponse <$> ret

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
  -> PostMethodListRequest
  -> Bloc [PostMethodListResponse]
postUsersContractMethodList userName userAddr PostMethodListRequest{..} = do
  txsFuncIds <- for (zip postmethodlistrequestTxs [0..]) $ \ (MethodCall{..},nonceIncr) -> do
    cmId <- getContractsMetaDataIdExhaustive methodcallContractName methodcallContractAddress
    functionId <- getFunctionId cmId methodcallMethodName

    eitherErrorOrContract <- xAbiToContract <$> getContractXabi (ContractName methodcallContractName) (Unnamed methodcallContractAddress)

    contract' <-
      either (throwError . UserError . Text.pack) return eitherErrorOrContract

    let maybeFunc = Map.lookup methodcallMethodName (fields $ mainStruct contract')

    sel <-
      case maybeFunc of
       Just (_, TypeFunction selector _ _) -> return selector
       _ -> throwError . UserError $ "Contract doesn't have a method named '" <> methodcallMethodName <> "'"



    argsBin <- buildArgumentByteString (Just methodcallArgs) (Just functionId)
    tx <- prepareTx
      userName
      postmethodlistrequestPassword
      userAddr
      (Just methodcallContractAddress)
      (fromMaybe emptyTxParams methodcallTxParams)
      (Wei (fromIntegral methodcallValue))
      (sel <> argsBin)
      nonceIncr
    -- resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
    return (tx,functionId)
  let (txs,funcIds) = unzip txsFuncIds
  logWith logNotice ("txs are: " <> Text.pack (show txs))
  hashes <- blocStrato $ postTxList txs
  map PostMethodListResponse <$> if postmethodlistrequestResolve
  then do
    -- TODO: use `ensureMostRecentSuccessfulTx`
    txResults <- unBatchTransactionResult <$> pollTxResultBatch hashes -- chosen by fair dice roll, guaranteed to have at least one tx result for each hash
    let zipped = resultJoiner <$> zip funcIds hashes
        resultJoiner (fi, hash) = (fi, head . fromJust $ Map.lookup hash txResults)

    for zipped $ \(funcId,txResult) -> do
      resultXabiTypes <- getXabiFunctionsReturnValuesQuery funcId
      let orderedResultIndexedXT = sortOn Xabi.indexedTypeIndex resultXabiTypes
      orderedResultTypes <- for orderedResultIndexedXT $ \Xabi.IndexedType{..} ->
                              either (throwError . UserError . Text.pack) return $
                                xabiTypeToType (error "missing typedefs in postUsersContractMethod") indexedTypeType
      let mFormattedResponse = Text.concat <$> convertResultResToTexts (transactionresultResponse txResult) orderedResultTypes
      blocMaybe "Failed to parse response" mFormattedResponse
  else return $ map (Text.pack . keccak256String) hashes

postUsersContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> PostUsersContractMethodRequest
  -> Bloc PostUsersContractMethodResponse
postUsersContractMethod
  userName
  userAddr
  (ContractName contractName)
  contractAddr
  (PostUsersContractMethodRequest password funcName args value txParams) = do
    cmId <- getContractsMetaDataIdExhaustive contractName contractAddr
    functionId <- getFunctionId cmId funcName

    eitherErrorOrContract <- xAbiToContract <$> getContractXabiByMetadataId cmId

    contract' <-
      either (throwError . UserError . Text.pack) return eitherErrorOrContract

    let maybeFunc = Map.lookup funcName (fields $ mainStruct contract')

    sel <-
      case maybeFunc of
       Just (_, TypeFunction selector _ _) -> return selector
       _ -> throwError . UserError $ "Contract doesn't have a method named '" <> funcName <> "'"
    argsBin <- buildArgumentByteString (Just args) (Just functionId)
    tx <- prepareTx
      userName
      password
      userAddr
      (Just contractAddr)
      (fromMaybe emptyTxParams txParams)
      (Wei (fromIntegral value))
      ((sel::ByteString) <> (argsBin::ByteString))
      0
    logWith logNotice ("tx is: " <> Text.pack (show tx))
    hash <- blocStrato $ postTx tx
    resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
    let
      orderedResultIndexedXT = sortOn Xabi.indexedTypeIndex resultXabiTypes
    orderedResultTypes <-
      for orderedResultIndexedXT $ \Xabi.IndexedType{..} ->
        either (throwError . UserError . Text.pack) return $
          xabiTypeToType
              (error "missing typedefs in postUsersContractMethod")
              indexedTypeType

    txResult <- pollTxResult hash

    let
      mFormattedResponse = Text.concat <$>
        convertResultResToTexts
          (transactionresultResponse txResult)
          orderedResultTypes

    formattedResponse <- blocMaybe "Failed to parse response" mFormattedResponse

    return $ PostUsersContractMethodResponse formattedResponse

convertResultResToTexts :: Text -> [Type] -> Maybe [Text]
convertResultResToTexts txResp responseTypes =
  let
    byteResp = fst (Base16.decode (Text.encodeUtf8 txResp))
  in case bytestringToValues byteResp responseTypes of
    Nothing   -> Nothing
    Just vals -> traverse valueToText vals

buildArgumentByteString :: Maybe (Map Text Text) -> Maybe Int32 -> Bloc ByteString
buildArgumentByteString args mFunctionId = case mFunctionId of
  Nothing -> return ByteString.empty
  Just functionId -> do
    argNamesTypes <- getXabiFunctionsArgsQuery functionId
    let
      determineValue valStr (Xabi.IndexedType _ xabiType) =
        let
          typeM = case xabiType of
            Xabi.Int _ _ ->
              textToArgType "Int" False ""
            Xabi.String dy ->
              textToArgType "String" (fromMaybe False dy) ""
            Xabi.Bytes dy _ ->
              textToArgType "Bytes" (fromMaybe False dy) ""
            Xabi.Bool ->
              textToArgType "Bool" False ""
            Xabi.Address ->
              textToArgType "Address" False ""
            Xabi.Struct _ _ ->
              textToArgType "Struct" False ""
            Xabi.Enum _ _ ->
              textToArgType "Enum" False ""
            Xabi.Array dy _ ety ->
              let
                ettyty = case ety of
                  Xabi.Int _ _ -> "Int"
                  Xabi.String _ -> "String"
                  Xabi.Bytes _ _ -> "Bytes"
                  Xabi.Bool -> "Bool"
                  Xabi.Address -> "Address"
                  Xabi.Struct _ _ -> "Struct"
                  Xabi.Enum _ _ -> "Enum"
                  Xabi.Array _ _ _ ->
                    error "Array of array not supported"
                  Xabi.Contract _ -> "Contract"
                  Xabi.Mapping _ _ _ -> "Mapping"
                  Xabi.Label _ -> undefined -- TODO - fill this in
              in
                textToArgType "Array" (fromMaybe False dy) ettyty
            Xabi.Contract{} ->
              textToArgType "Contract" False ""
            Xabi.Mapping dy _ _ ->
              textToArgType "Mapping" (fromMaybe False dy) ""
            Xabi.Label _ -> undefined -- TODO - fill this in
        in
          textToValue valStr (fromMaybe (SimpleType TypeBytes) typeM)
    case args of
      Nothing ->
        if Map.null argNamesTypes
          then return ByteString.empty
          else throwError (AnError "no arguments provided to function.")
      Just argsMap -> do
        argsVals <- if Map.keys argsMap /= Map.keys argNamesTypes
          then throwError (AnError "argument names don't match")
          else return $ Map.intersectionWith determineValue argsMap argNamesTypes
        vals <- for (toList argsVals) $
          maybe (throwError $ AnError "couldn't decode argument value") return
        return $ toStorage (ValueArrayFixed (fromIntegral (length vals)) vals)

prepareTx
  :: UserName
  -> Password
  -> Address
  -> Maybe Address
  -> TxParams
  -> Wei
  -> ByteString
  -> Int
  -> Bloc PostTransaction
prepareTx userName password addr toAddr TxParams{..} value code nonceIncr = do
  uIds <- blocQuery $ proc () -> do
    (uId,name) <- queryTable usersTable -< ()
    restrict -< name .== constant userName
    returnA -< uId
  cryptos <- case listToMaybe uIds of
    Nothing -> throwError . DBError $
      "no user found with name: " <> getUserName userName
    Just uId -> blocQuery $ proc () -> do
      (_,salt,_,nonce,encSecKey,_,addr',uId') <-
        queryTable keyStoreTable -< ()
      restrict -< uId' .== constant (uId::Int32)
        .&& addr' .== constant addr
      returnA -< (salt,nonce,encSecKey)
  skMaybe <- case listToMaybe cryptos of
    Nothing -> throwError . DBError $
      "address does not exist for user:" <> getUserName userName
    Just (salt,nonce,encSecKey) -> return $
      decryptSecKey password salt nonce encSecKey
  case skMaybe of
    Nothing -> throwError $ UserError "incorrect password"
    Just sk -> do
      accts <- blocStrato $ getAccountsFilter
        accountsFilterParams{qaAddress = Just addr}
      Nonce nonce <- case listToMaybe accts of
        Nothing -> throwError . UserError $ "strato error: failed to find account"
        Just acct -> return $ accountNonce acct
      let newNonce = Nonce (nonce + fromIntegral nonceIncr)
      return $ prepareSignedTx sk addr UnsignedTransaction
        { unsignedTransactionNonce = fromMaybe newNonce txparamsNonce
        , unsignedTransactionGasPrice =
            fromMaybe (Wei 1) txparamsGasPrice
        , unsignedTransactionGasLimit =
            fromMaybe (Gas 100000000) txparamsGasLimit
        , unsignedTransactionTo = toAddr
        , unsignedTransactionValue = value
        , unsignedTransactionInitOrData = code
        }

prepareSignedTx
  :: SecKey
  -> Address
  -> UnsignedTransaction
  -> PostTransaction
prepareSignedTx sk addr unsignedTx = PostTransaction
  { posttransactionHash = kecc
  , posttransactionGasLimit = Strung $ fromIntegral gasLimit
  , posttransactionCodeOrData = code
  , posttransactionGasPrice = Strung $ fromIntegral gasPrice
  , posttransactionTo = toAddr
  , posttransactionFrom = addr
  , posttransactionValue = Strung $ fromIntegral value
  , posttransactionR = Hex $ fromIntegral r
  , posttransactionS = Hex $ fromIntegral s
  , posttransactionV = Hex v
  , posttransactionNonce = Strung $ fromIntegral nonce'
  }
  where
    tx = signTransaction sk unsignedTx
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
