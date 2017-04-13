{-# LANGUAGE
    Arrows
  , OverloadedStrings
  , RecordWildCards
  , ScopedTypeVariables
#-}

module BlockApps.Bloc.Server.Users where

import Control.Arrow
import Control.Concurrent.Async.Lifted
import Control.Monad.Except
import Control.Monad.Log
import Crypto.Secp256k1
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Base16 as Base16
import Data.Foldable
import Data.Int (Int32)
import Data.List (sortOn)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.Monoid
import Data.RLP
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Data.Traversable
import Opaleye

import BlockApps.Bloc.API.Users
import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Server.Utils
import BlockApps.Bloc.Crypto
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Database.Queries
import BlockApps.Bloc.Database.Tables
import BlockApps.Ethereum
import BlockApps.Solidity.Storage
import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import qualified BlockApps.Solidity.Xabi.Type as Xabi
import BlockApps.Solidity.Xabi
import BlockApps.Strato.Types hiding (Transaction(..))
import BlockApps.Strato.Client
import BlockApps.XAbiConverter (xabiTypeToType)

-- Following imported for HTMLifiedPlainText. TODO: Remove when refactoring.

class Monad m => MonadUsers m where
  getUsers :: m [UserName]
  getUsersUser :: UserName -> m [Address]
  postUsersUser :: UserName -> PostUsersUserRequest -> m Address
  postUsersSend :: UserName -> Address -> PostSendParameters -> m PostTransaction
  postUsersContract :: UserName -> Address -> PostUsersContractRequest -> m Address
  postUsersUploadList :: UserName -> Address -> UploadListRequest -> m [PostUsersUploadListResponse]
  postUsersContractMethod :: UserName -> Address -> ContractName -> Address -> PostUsersContractMethodRequest -> m PostUsersContractMethodResponse
  postUsersSendList :: UserName -> Address -> PostSendListRequest -> m [PostSendListResponse]
  postUsersContractMethodList :: UserName -> Address -> PostMethodListRequest -> m [PostMethodListResponse]

instance MonadUsers Bloc where

  getUsers = blocTransaction $ map UserName <$> blocQuery getUsersQuery

  getUsersUser (UserName name) = blocTransaction $
    blocQuery $ getUsersUserQuery name

  postUsersUser (UserName name) (PostUsersUserRequest faucet pass) = blocTransaction $ do
    keyStore <- newKeyStore pass
    createdUser <- blocModify $ postUsersUserQuery name keyStore
    unless createdUser (throwError (DBError "failed to create user"))
    let
      addr = keystoreAcctAddress keyStore
    when (faucet /= 0) $ do
      logWith logNotice "Waiting for faucet transaction to be mined"
      blocStrato $ do
        void $ postFaucet addr
        void $ waitNewAccount addr
    return addr

  postUsersSend userName addr
    (PostSendParameters toAddr value password txParams) = do
      tx <- prepareTx
        userName password addr (Just toAddr) (fromMaybe emptyTxParams txParams)
        (Wei (fromIntegral value)) ByteString.empty
      hash <- blocStrato $ postTx tx
      void $ pollTxResult hash
      return tx

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
        userName password addr Nothing (fromMaybe emptyTxParams txParams) (Wei (fromIntegral value)) (bin <> argsBin)
      logWith logNotice ("tx is: " <> Text.pack (show tx))
      hash <- blocStrato $ postTx tx
      txResult <- pollTxResult hash
      let
        addressMaybe = do
          str <- listToMaybe $
            Text.splitOn "," (transactionresultContractsCreated txResult)
          stringAddress $ Text.unpack str
      case addressMaybe of
        Nothing -> case (transactionresultMessage txResult) of
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

  postUsersUploadList userName addr (UploadListRequest pw contracts _resolve) = do
    namesCmIdsTxs <- for contracts $ \ (UploadListContract name args txParams value) -> do
      (bin16,cmId) <- blocQuery1 $ proc () -> do
        (bin16,_,_,_,_,cmId) <- getContractsContractLatestQuery name -< ()
        returnA -< (bin16,cmId)
      let
        (bin,leftOver) = Base16.decode $ bin16
      unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
      mFunctionId <- getConstructorId cmId
      argsBin <- buildArgumentByteString (Just args) mFunctionId
      tx <- prepareTx
        userName pw addr Nothing (fromMaybe emptyTxParams txParams) (Wei (maybe 0 fromIntegral value)) (bin <> argsBin)
      return ((name,cmId),tx)
    let
      namesCmIds = map fst namesCmIdsTxs
      txs = map snd namesCmIdsTxs
    hashes <- blocStrato $ postTxList txs
    resps <- forConcurrently (zip namesCmIds hashes) $ \ ((name,cmId),hash) -> do
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
          getContractDetails (ContractName name) (Unnamed addr')
    return $ map PostUsersUploadListResponse resps

  postUsersSendList userName addr (PostSendListRequest pw resolve txs) = do
    txs' <- for txs $ \ (SendTransaction toAddr value txParams) -> prepareTx
      userName pw addr (Just toAddr) (fromMaybe emptyTxParams txParams)
      (Wei (fromIntegral value)) ByteString.empty
    hashes <- blocStrato $ postTxList txs'
    map PostSendListResponse <$> if resolve
      then forConcurrently hashes $ \ hash -> do
        txResult <- pollTxResult hash
        let txResponse = transactionresultResponse txResult
        case txResponse of
          "Success!" -> do
            senderAccounts <- blocStrato $ getAccountsFilter
              accountsFilterParams{qaAddress = Just addr}
            case senderAccounts of
              [] -> throwError $ AnError "No sender account found"
              senderAccount:_ -> return . Text.pack . show . unStrung $
                accountBalance senderAccount
          _ -> return txResponse
      else return hashes

  postUsersContractMethodList userName userAddr PostMethodListRequest{..} = do
    txsFuncIds <- for postmethodlistrequestTxs $ \ MethodCall{..} -> do
      cmId <- getContractsMetaDataIdExhaustive methodcallContractName methodcallContractAddress
      (functionId,sel16) <- getFunctionIdSel cmId methodcallMethodName
      let
        (sel,leftOver) = Base16.decode $ sel16
      unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode selector"
      argsBin <- buildArgumentByteString (Just methodcallArgs) (Just functionId)
      tx <- prepareTx
        userName
        postmethodlistrequestPassword
        userAddr
        (Just methodcallContractAddress)
        (fromMaybe emptyTxParams methodcallTxParams)
        (Wei (fromIntegral methodcallValue))
        (sel <> argsBin)
      -- resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
      return (tx,functionId)
    let (txs,funcIds) = unzip txsFuncIds
    logWith logNotice ("txs are: " <> Text.pack (show txs))
    hashes <- blocStrato $ postTxList txs
    map PostMethodListResponse <$> if postmethodlistrequestResolve
      then forConcurrently (zip hashes funcIds) $ \ (hash,funcId) -> do
        resultXabiTypes <- getXabiFunctionsReturnValuesQuery funcId
        let
          orderedResultIndexedXT = sortOn Xabi.indexedTypeIndex resultXabiTypes
          orderedResultTypes = map
            (\Xabi.IndexedType{..} -> xabiTypeToType indexedTypeType)
            orderedResultIndexedXT
        txResult <- pollTxResult hash
        let
          mFormattedResponse = Text.concat <$>
            convertResultResToTexts
              (transactionresultResponse txResult)
              orderedResultTypes
        blocMaybe "Failed to parse response" mFormattedResponse
      else return hashes

  postUsersContractMethod
    userName
    userAddr
    (ContractName contractName)
    contractAddr
    (PostUsersContractMethodRequest password funcName args value txParams) = do
      cmId <- getContractsMetaDataIdExhaustive contractName contractAddr
      (functionId,sel16) <- getFunctionIdSel cmId funcName
      let
        (sel,leftOver) = Base16.decode $ sel16
      unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode selector"
      argsBin <- buildArgumentByteString (Just args) (Just functionId)
      tx <- prepareTx
        userName
        password
        userAddr
        (Just contractAddr)
        (fromMaybe emptyTxParams txParams)
        (Wei (fromIntegral value))
        (sel <> argsBin)
      logWith logNotice ("tx is: " <> Text.pack (show tx))
      hash <- blocStrato $ postTx tx
      resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
      let
        orderedResultIndexedXT = sortOn Xabi.indexedTypeIndex resultXabiTypes
        orderedResultTypes = map
          (\Xabi.IndexedType{..} -> xabiTypeToType indexedTypeType)
          orderedResultIndexedXT
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
    byteResp = Text.encodeUtf8 txResp
  in case bytestringToValues byteResp responseTypes of
    Nothing -> Nothing
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
              in
                textToArgType "Array" (fromMaybe False dy) ettyty
            Xabi.Contract _ ->
              textToArgType "Contract" False ""
            Xabi.Mapping dy _ _ ->
              textToArgType "Mapping" (fromMaybe False dy) ""
        in
          textToValue valStr (fromMaybe (SimpleType TypeBytes) typeM)
    case args of
      Nothing -> do
        if Map.null argNamesTypes
          then return ByteString.empty
          else (throwError $ AnError "no arguments provided to function.")
      Just argsMap -> do
        argsVals <- if Map.keys argsMap /= Map.keys argNamesTypes
          then throwError $ AnError "argument names don't match"
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
  -> Bloc PostTransaction
prepareTx userName password addr toAddr TxParams{..} value code = do
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
      nonce <- case listToMaybe accts of
        Nothing -> throwError . UserError $ "strato error: failed to find account"
        Just acct -> return $ accountNonce acct
      return $ prepareSignedTx sk addr UnsignedTransaction
        { unsignedTransactionNonce = fromMaybe nonce txparamsNonce
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
