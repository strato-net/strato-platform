{-# LANGUAGE Arrows              #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Users where

import           Control.Concurrent
import           Control.Arrow
import           Control.Monad
import           Control.Monad.Except
import           Control.Monad.Log
import           Crypto.Secp256k1
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Base16            as Base16
import           Data.Foldable
import           Data.Int                          (Int32)
import           Data.List                         (sortOn)
import           Data.Map.Strict                   (Map)
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.Monoid
import           Data.RLP
import           Data.Set                          (isSubsetOf)
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Traversable
import           Opaleye                           hiding (not, null)

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
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
import qualified BlockApps.Strato.Types            as T
import           BlockApps.XAbiConverter

data TransactionHeader = TransactionHeader
  { transactionheaderToAddr   :: Maybe Address
  , transactionheaderFromAddr :: Address
  , transactionheaderTxParams :: TxParams
  , transactionheaderValue    :: Wei
  , transactionheaderCode     :: ByteString
  , transactionheaderNonceInc :: Int
  }

getUsers :: Bloc [UserName]
getUsers = blocTransaction $ map UserName <$> blocQuery getUsersQuery

getUsersUser :: UserName -> Bloc [Address]
getUsersUser (UserName name) = blocTransaction $
  blocQuery $ getUsersUserQuery name

postUsersUser :: UserName -> Password -> Bloc Address
postUsersUser (UserName name) pass = blocTransaction $ do
  keyStore <- newKeyStore pass
  createdUser <- blocModify $ postUsersUserQuery name keyStore
  unless createdUser (throwError (DBError "failed to create user"))
  return $ keystoreAcctAddress keyStore

postUsersFill :: UserName  -> Address -> Bool-> Bloc BlocTransactionResult
postUsersFill _ addr resolve = blocTransaction $ do
  when resolve (logWith logNotice "Waiting for faucet transaction to be mined")
  hash <- blocStrato $ postFaucet addr
  getBlocTransactionResult' hash resolve

postUsersSend :: UserName -> Address -> Bool -> PostSendParameters -> Bloc BlocTransactionResult
postUsersSend userName addr resolve
  (PostSendParameters toAddr value password mTxParams) = do
    sk <- getAccountSecKey userName password addr
    txParams <- getAccountTxParams addr mTxParams
    tx <- prepareTx sk $
      TransactionHeader
        (Just toAddr)
        addr
        txParams
        (Wei (fromIntegral $ unStrung value))
        ByteString.empty
        0
    hash <- blocStrato $ postTx tx
    getBlocTransactionResult' hash resolve

postUsersContract :: UserName -> Address -> Bool -> PostUsersContractRequest -> Bloc BlocTransactionResult
postUsersContract userName addr resolve
  (PostUsersContractRequest src password maybeContract args mTxParams value) = blocTransaction $ do
    sk <- getAccountSecKey userName password addr
    txParams <- getAccountTxParams addr mTxParams
    --TODO: check what happens with mismatching args
    idsAndDetails <- compileContract src
    logWith logNotice ("constructor arguments: " <> Text.pack (show args))
    (cmId,ContractDetails{..}) <-
      case maybeContract of
       Nothing ->
         case Map.toList idsAndDetails of
           [] -> throwError $ UserError "You need to supply at least one contract in the source"
           [(_, x)] -> return x
           _ -> throwError $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
       Just contract ->
         blocMaybe "Could not find global contract metadataId" $
           Map.lookup contract idsAndDetails
    let
      (bin,leftOver) = Base16.decode $ Text.encodeUtf8 contractdetailsBin
    unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
    mFunctionId <- getConstructorId cmId
    argsBin <- buildArgumentByteString (fmap (fmap argValueToText) args) mFunctionId
    tx <- prepareTx sk $
      TransactionHeader
        Nothing
        addr
        txParams
        (Wei (fromIntegral (maybe 0 unStrung value)))
        (bin <> argsBin)
        0
    logWith logNotice ("tx is: " <> Text.pack (show tx))
    hash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsert conn hashNameTable
      ( Nothing
      , constant hash
      , constant cmId
      , constant contractdetailsName
      )
    getBlocTransactionResult' hash resolve

postUsersUploadList :: UserName -> Address -> Bool -> UploadListRequest -> Bloc [BlocTransactionResult]
postUsersUploadList userName addr resolve (UploadListRequest pw contracts _resolve) = do
  sk <- getAccountSecKey userName pw addr
  if (null contracts)
    then return []
    else do
      let UploadListContract _ _ mtp _ = head contracts
      txParams <- getAccountTxParams addr mtp
      namesCmIdsTxs <- for (zip contracts [0..]) $ \ (UploadListContract name args _ value,nonceIncr) -> do
        (bin16,cmId) <- blocQuery1 $ proc () -> do
          (bin16,_,_,_,_,cmId) <- getContractsContractLatestQuery name -< ()
          returnA -< (bin16,cmId)
        let
          (bin,leftOver) = Base16.decode bin16
        unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
        mFunctionId <- getConstructorId cmId
        argsBin <- buildArgumentByteString (Just (fmap argValueToText args)) mFunctionId
        tx <- prepareTx sk $
            TransactionHeader
              Nothing
              addr
              txParams
              (Wei (maybe 0 fromIntegral $ fmap unStrung value))
              (bin <> argsBin)
              nonceIncr
        return ((name,cmId),tx)
      let
        txs = map snd namesCmIdsTxs
      hashes <- blocStrato (postTxList txs)
      forM (zip hashes (map fst namesCmIdsTxs)) $ \(hash,(name,cmId)) -> do
        void . blocModify $ \conn -> runInsert conn hashNameTable
          ( Nothing
          , constant hash
          , constant cmId
          , constant name
          )
        getBlocTransactionResult' hash (resolve || _resolve)

postUsersSendList :: UserName -> Address -> Bool -> PostSendListRequest -> Bloc [BlocTransactionResult]
postUsersSendList userName addr resolve (PostSendListRequest pw resolve' txs) = do
  sk <- getAccountSecKey userName pw addr
  if (null txs)
    then return []
    else do
      let SendTransaction _ _ mtp = head txs
      txParams <- getAccountTxParams addr mtp
      txHeaders <- zipWithM
        (\(SendTransaction toAddr (Strung value) _) i -> do
            return $ TransactionHeader
              (Just toAddr)
              addr
              txParams
              (Wei $ fromIntegral value)
              (ByteString.empty)
              i
        ) txs [0..]
      txs' <- mapM (prepareTx sk) txHeaders
      hashes <- blocStrato $ postTxList txs'
      forM hashes $ flip getBlocTransactionResult' (resolve || resolve')

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
  -> Bool
  -> PostMethodListRequest
  -> Bloc [BlocTransactionResult]
postUsersContractMethodList userName userAddr resolve PostMethodListRequest{..} = do
  sk <- getAccountSecKey userName postmethodlistrequestPassword userAddr
  if (null postmethodlistrequestTxs)
    then return []
    else do
      let mc = head postmethodlistrequestTxs
      txParams <- getAccountTxParams userAddr $ methodcallTxParams mc
      txsCmIdsFuncNames <- for (zip postmethodlistrequestTxs [0..]) $
        \ (MethodCall{..},nonceIncr) -> do
          cmId <- getContractsMetaDataIdExhaustive methodcallContractName methodcallContractAddress
          xabi <- getContractXabi (ContractName methodcallContractName) (Unnamed methodcallContractAddress)
          let eitherErrorOrContract = xAbiToContract xabi

          contract' <-
            either (throwError . UserError . Text.pack) return eitherErrorOrContract

          let maybeFunc = Map.lookup methodcallMethodName (fields $ C.mainStruct contract')

          sel <-
            case maybeFunc of
             Just (_, TypeFunction selector _ _) -> return selector
             _ -> throwError . UserError $ "Contract doesn't have a method named '" <> methodcallMethodName <> "'"

          functionId <- getFunctionId cmId methodcallMethodName
          argsBin <- buildArgumentByteString (Just (fmap argValueToText methodcallArgs)) (Just functionId)
          tx <- prepareTx sk $
            TransactionHeader
              (Just methodcallContractAddress)
              userAddr
              txParams
              (Wei (fromIntegral $ unStrung methodcallValue))
              (sel <> argsBin)
              nonceIncr
          -- resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
          return (tx,cmId,methodcallMethodName)
      txs <- for txsCmIdsFuncNames $ \(tx,_,_) -> return tx
      mapM_ (logWith logNotice . (<>) "txs are: " . Text.pack . show) txs
      hashes <- blocStrato $ postTxList txs
      forM (zip hashes txsCmIdsFuncNames) $ \(hash,(_,cmId,funcName)) -> do
        void . blocModify $ \conn -> runInsert conn hashNameTable
          ( Nothing
          , constant hash
          , constant cmId
          , constant funcName
          )
        getBlocTransactionResult' hash (resolve || postmethodlistrequestResolve)

postUsersContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> Bool
  -> PostUsersContractMethodRequest
  -> Bloc BlocTransactionResult
postUsersContractMethod
  userName
  userAddr
  (ContractName contractName)
  contractAddr
  resolve
  (PostUsersContractMethodRequest password funcName args value mTxParams) = do
    sk <- getAccountSecKey userName password userAddr
    txParams <- getAccountTxParams userAddr mTxParams
    cmId <- getContractsMetaDataIdExhaustive contractName contractAddr

    xabi <- getContractXabiByMetadataId cmId
    let eitherErrorOrContract = xAbiToContract xabi

    contract' <-
      either (throwError . UserError . Text.pack) return eitherErrorOrContract

    let maybeFunc = Map.lookup funcName (fields $ C.mainStruct contract')

    sel <-
      case maybeFunc of
       Just (_, TypeFunction selector _ _) -> return selector
       _ -> throwError . UserError $ "Contract doesn't have a method named '" <> funcName <> "'"
    functionId <- getFunctionId cmId funcName
    argsBin <- buildArgumentByteString (Just (fmap argValueToText args)) (Just functionId)
    tx <- prepareTx sk $
      TransactionHeader
        (Just contractAddr)
        userAddr
        txParams
        (Wei (maybe 0 (fromIntegral . unStrung) value))
        ((sel::ByteString) <> (argsBin::ByteString))
        0
    logWith logNotice ("tx is: " <> Text.pack (show tx))
    hash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsert conn hashNameTable
      ( Nothing
      , constant hash
      , constant cmId
      , constant funcName
      )
    getBlocTransactionResult' hash resolve

getBatchBlocTransactionResult :: [Keccak256] -> Bool -> Bloc [BlocTransactionResult]
getBatchBlocTransactionResult hashes resolve = do
  forM hashes $ \h -> getBlocTransactionResult h resolve

getBlocTransactionResult' :: Keccak256 -> Bool -> Bloc BlocTransactionResult
getBlocTransactionResult' hash resolve =
  if resolve
    then (getBlocTransactionResult hash True)
    else return (BlocTransactionResult Pending hash Nothing Nothing)

getBlocTransactionResult :: Keccak256 -> Bool -> Bloc BlocTransactionResult
getBlocTransactionResult hash resolve = do
  (status,mtxr) <- getBlocTxStatus hash
  case status of
    Pending ->
      if resolve
        then do
          logWith logNotice . Text.pack $ "Polling BlocTransactionStatus for transaction hash: " ++ keccak256String hash
          void . liftIO $ threadDelay 1000000
          getBlocTransactionResult hash True
        else return $ BlocTransactionResult Pending hash Nothing Nothing
    Failure -> return $ BlocTransactionResult Failure hash mtxr Nothing
    Success -> do
      mtx <- maybeTx hash
      case mtx of
        Nothing ->
          if resolve
            then do
              void . liftIO $ threadDelay 1000000
              getBlocTransactionResult hash True
            else return $ BlocTransactionResult Pending hash Nothing Nothing
        Just tx ->
          case T.transactionTransactionType tx of
            Transfer -> return $ BlocTransactionResult Success hash mtxr (Just $ Send $ toPostTx tx)
            Contract -> contractResult mtxr
            FunctionCall -> functionResult mtxr
  where
    contractResult mtxr = do
      let
        Just txResult = mtxr
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
              Just _ -> throwError $ UserError "Contract failed to upload, likely because the constructor threw"
              Nothing -> throwError $ UserError "Transaction succeeded, but contract was neither created, nor destroyed"
          stratoMsg  -> throwError $ UserError stratoMsg
        Just addr' -> do
          (cmId,name)::(Int32,Text) <- blocQuery1 $ contractByTxHash hash
          xs::[Int32] <- blocQuery $ proc () -> do
            (cmId',_,_,_,_,_,_,_) <- contractByAddress name addr' -< ()
            returnA -< cmId'
          when (isNothing $ listToMaybe xs) $ do
            void . blocModify $ \conn -> runInsert conn contractsInstanceTable
              ( Nothing
              , constant cmId
              , constant addr'
              , Nothing
              )
          details <- getContractDetails (ContractName name) (Unnamed addr')
          return $ BlocTransactionResult Success hash mtxr (Just $ Upload details)
    functionResult mtxr = do
      let Just txResult = mtxr
      (cmId,funcName)::(Int32,Text) <- blocQuery1 $ contractByTxHash hash
      functionId <- getFunctionId cmId funcName
      xabi <- getContractXabiByMetadataId cmId
      resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
      let
        orderedResultIndexedXT = sortOn Xabi.indexedTypeIndex resultXabiTypes
      orderedResultTypes <-
        for orderedResultIndexedXT $ \Xabi.IndexedType{..} ->
          either (throwError . UserError . Text.pack) return $
            xabiTypeToType xabi indexedTypeType
      let
        txResp = transactionresultResponse txResult
        -- TODO::(map convertEnumTypeToInt orderedResultTypes) is currenlty a
        -- workaround for enums
        mFormattedResponse =
          convertResultResToVals txResp (map convertEnumTypeToInt orderedResultTypes)
      case transactionresultMessage txResult of
        "Success!" -> do
          formattedResponse <- blocMaybe ("Failed to parse response: " <> txResp) mFormattedResponse
          return $ BlocTransactionResult Success hash mtxr (Just $ Call formattedResponse)
        stratoMsg  -> throwError $ UserError stratoMsg

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType TypeUInt256
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty

convertResultResToVals :: Text -> [Type] -> Maybe [SolidityValue]
convertResultResToVals txResp responseTypes =
  let byteResp = fst (Base16.decode (Text.encodeUtf8 txResp))
  in map valueToSolidityValue <$> bytestringToValues byteResp responseTypes

buildArgumentByteString :: Maybe (Map Text Text) -> Maybe Int32 -> Bloc ByteString
buildArgumentByteString args mFunctionId = case mFunctionId of
  Nothing -> return ByteString.empty
  Just functionId -> do
    argNamesTypes <- getXabiFunctionsArgsQuery functionId
    let
      determineValue valStr (Xabi.IndexedType ix xabiType) =
        let
          typeM = case xabiType of
            Xabi.Int _ _ ->
              textToArgType "Int" False ""
            Xabi.String dy ->
              textToArgType "String" (fromMaybe False dy) ""
            Xabi.Bytes dy by ->
              textToArgType ("Bytes" <> maybe "" (Text.pack . show) by) (fromMaybe False dy) ""
            Xabi.Bool ->
              textToArgType "Bool" False ""
            Xabi.Address ->
              textToArgType "Address" False ""
            Xabi.Struct _ _ ->
              textToArgType "Struct" False ""
            Xabi.Enum{} ->
              textToArgType "Enum" False ""
            Xabi.Array dy len ety ->
              let
                ettyty = case ety of
                  Xabi.Int{} -> "Int"
                  Xabi.String{} -> "String"
                  Xabi.Bytes _ by -> "Bytes" <> maybe "" (Text.pack . show) by
                  Xabi.Bool -> "Bool"
                  Xabi.Address -> "Address"
                  Xabi.Struct{} -> "Struct"
                  Xabi.Enum{} -> "Enum"
                  Xabi.Array{} ->
                    error "Array of array not supported"
                  Xabi.Contract{} -> "Contract"
                  Xabi.Mapping{} -> "Mapping"
                  Xabi.Label{} -> "Int" -- since Enums are converted to Ints
              in
                textToArgType ("Array" <> maybe "" (Text.pack . show) len) (fromMaybe False dy) ettyty
            Xabi.Contract{} ->
              textToArgType "Contract" False ""
            Xabi.Mapping dy _ _ ->
              textToArgType "Mapping" (fromMaybe False dy) ""
            Xabi.Label _ ->
              textToArgType "Int" False "" -- since Enums are converted to Ints
        in do
          ty <- either (blocError . UserError) return typeM
          either (blocError . UserError) (return . (ix,)) (textToValue valStr ty)
    case args of
      Nothing ->
        if Map.null argNamesTypes
          then return ByteString.empty
          else throwError (UserError "no arguments provided to function.")
      Just argsMap -> do
        argsVals <- if not (Map.keysSet argNamesTypes `isSubsetOf` Map.keysSet argsMap)
          then do
            let
              argNames1 = "(" <> Text.intercalate ", " (Map.keys argNamesTypes) <> ")"
              argNames2 = "(" <> Text.intercalate ", " (Map.keys argsMap) <> ")"
            throwError (UserError ("argument names don't match: " <> argNames1 <> " " <> argNames2))
          else sequence $ Map.intersectionWith determineValue argsMap argNamesTypes
        let vals = map snd (sortOn fst (toList argsVals))
        return $ toStorage (ValueArrayFixed (fromIntegral (length vals)) vals)

getAccountTxParams :: Address -> Maybe TxParams -> Bloc TxParams
getAccountTxParams addr = \case
  Nothing -> getAcctNonce >>= \n -> return emptyTxParams{txparamsNonce = Just n}
  Just params@TxParams{..} ->
    case txparamsNonce of
      Just _ -> return params
      Nothing -> getAcctNonce >>= \n -> return params{txparamsNonce = Just n}
  where
    getAcctNonce = do
      accts <- blocStrato $ getAccountsFilter
        accountsFilterParams{qaAddress = Just addr}
      case listToMaybe accts of
        Nothing   -> throwError . UserError $ "strato error: failed to find account"
        Just acct -> return $ accountNonce acct

prepareTx
  :: SecKey
  -> TransactionHeader
  -> Bloc PostTransaction
prepareTx sk txHeader = do
  return . prepareSignedTx sk (transactionheaderFromAddr txHeader) $ prepareUnsignedTx txHeader

getAccountSecKey :: UserName -> Password -> Address -> Bloc SecKey
getAccountSecKey userName password addr = do
  uIds <- blocQuery $ proc () -> do
    (uId,name) <- queryTable usersTable -< ()
    restrict -< name .== constant userName
    returnA -< uId
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
prepareUnsignedTx TransactionHeader{..} =
  let Nonce nonce = fromMaybe (Nonce 0) (txparamsNonce transactionheaderTxParams)
  in UnsignedTransaction
  { unsignedTransactionNonce = Nonce (nonce + fromIntegral transactionheaderNonceInc)
  , unsignedTransactionGasPrice =
      fromMaybe (Wei 1) (txparamsGasPrice transactionheaderTxParams)
  , unsignedTransactionGasLimit =
      fromMaybe (Gas 100000000) (txparamsGasLimit transactionheaderTxParams)
  , unsignedTransactionTo = transactionheaderToAddr
  , unsignedTransactionValue = transactionheaderValue
  , unsignedTransactionInitOrData = transactionheaderCode
  }

prepareSignedTx
  :: SecKey
  -> Address
  -> UnsignedTransaction
  -> PostTransaction
prepareSignedTx sk addr unsignedTx = PostTransaction
  { posttransactionHash = kecc
  , posttransactionGasLimit = fromIntegral gasLimit
  , posttransactionCodeOrData = code
  , posttransactionGasPrice = fromIntegral gasPrice
  , posttransactionTo = toAddr
  , posttransactionFrom = addr
  , posttransactionValue = Strung $ fromIntegral value
  , posttransactionR = Hex $ fromIntegral r
  , posttransactionS = Hex $ fromIntegral s
  , posttransactionV = Hex v
  , posttransactionNonce = fromIntegral nonce'
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
