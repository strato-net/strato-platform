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
import           Control.Monad.Trans.State.Lazy    (StateT(..), get, put, runStateT)
import           Crypto.Secp256k1
import qualified Data.Aeson                        as Aeson
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Lazy              as BL
import qualified Data.ByteString.Base16            as Base16
import           Data.Either
import           Data.Foldable
import           Data.Int                          (Int32)
import           Data.LargeWord                    (Word256)
import           Data.List                         (sortOn)
import           Data.Map.Strict                   (Map)
import qualified Data.Map.Strict                   as Map
import qualified Data.Map.Ordered                  as OMap
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
import           BlockApps.XAbiConverter

data TransactionHeader = TransactionHeader
  { transactionheaderToAddr   :: Maybe Address
  , transactionheaderFromAddr :: Address
  , transactionheaderTxParams :: TxParams
  , transactionheaderValue    :: Wei
  , transactionheaderCode     :: ByteString
  , transactionheaderNonceInc :: Int
  , transactionheaderChainId  :: Maybe Word256
  }

forStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m ([b],s)
forStateT s [] _ = return ([],s)
forStateT s (a:as) run = do
  (b,s') <- runStateT (run a) s
  (bs,s'') <- forStateT s' as run
  return (b:bs,s'')

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

postUsersFill :: UserName -> Address -> Bool -> Bloc BlocTransactionResult
postUsersFill _ addr resolve = blocTransaction $ do
  when resolve (logWith logNotice "Waiting for faucet transaction to be mined")
  hash <- blocStrato $ postFaucet addr
  void . blocModify $ \conn -> runInsert conn hashNameTable
    ( Nothing
    , constant hash
    , constant (0 :: Int32)
    , constant (0 :: Int32)
    , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode defaultPostTx{posttransactionTo = Just addr})
    )
  getBlocTransactionResult' Nothing hash resolve

postUsersSend :: UserName -> Address -> Maybe Int -> Bool -> PostSendParameters -> Bloc BlocTransactionResult
postUsersSend userName addr chainId resolve
  (PostSendParameters toAddr value password mTxParams) = do
    sk <- getAccountSecKey userName password addr
    txParams <- getAccountTxParams addr chainId mTxParams
    tx <- prepareTx sk $
      TransactionHeader
        (Just toAddr)
        addr
        txParams
        (Wei (fromIntegral $ unStrung value))
        ByteString.empty
        0
        (fromIntegral <$> chainId)
    hash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsert conn hashNameTable
      ( Nothing
      , constant hash
      , constant (0 :: Int32)
      , constant (0 :: Int32)
      , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode tx)
      )
    getBlocTransactionResult' chainId hash resolve

postUsersContract :: UserName -> Address -> Maybe Int -> Bool -> PostUsersContractRequest -> Bloc BlocTransactionResult
postUsersContract userName addr chainId resolve
  (PostUsersContractRequest src password maybeContract args mTxParams value) = blocTransaction $ do
    sk <- getAccountSecKey userName password addr
    txParams <- getAccountTxParams addr chainId mTxParams
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
        (fromIntegral <$> chainId)
    logWith logNotice ("tx is: " <> Text.pack (show tx))
    hash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsert conn hashNameTable
      ( Nothing
      , constant hash
      , constant cmId
      , constant (1 :: Int32)
      , constant contractdetailsName
      )
    getBlocTransactionResult' chainId hash resolve

postUsersUploadList :: UserName -> Address -> Maybe Int -> Bool -> UploadListRequest -> Bloc [BlocTransactionResult]
postUsersUploadList userName addr chainId resolve (UploadListRequest pw contracts _resolve) = do
  sk <- getAccountSecKey userName pw addr
  if (null contracts)
    then return []
    else do
      let UploadListContract _ _ mtp _ = head contracts
      txParams <- getAccountTxParams addr chainId mtp
      (namesCmIdsTxs,_) <- forStateT (Map.empty, Map.empty, Map.empty) (zip contracts [0..]) $
        \(UploadListContract name args _ value,nonceIncr) -> do
          (names, cmIds, fIds) <- get
          (bin, cmId, names') <- case Map.lookup name names of
            Just (b, cm) -> return (b, cm, names)
            Nothing -> do
              (b16,cm) <- lift $ blocQuery1 $ proc () -> do
                (bin16,_,_,_,_,cmId') <- getContractsContractLatestQuery name -< ()
                returnA -< (bin16,cmId')
              let (b, leftOver) = Base16.decode b16
              unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
              return (b, cm, Map.insert name (b, cm) names)
          (mFunctionId, cmIds') <- case Map.lookup cmId cmIds of
            Just fId -> return (fId, cmIds)
            Nothing -> do
              fId <- lift $ getConstructorId cmId
              return (fId, Map.insert cmId fId cmIds)
          (xabiArgs, fIds') <- case mFunctionId of
            Nothing -> return (Map.empty, fIds)
            Just functionId -> case Map.lookup functionId fIds of
              Just xabiArgs' -> return (xabiArgs', fIds)
              Nothing -> do
                xabiArgs' <- lift $ getXabiFunctionsArgsQuery functionId
                return (xabiArgs', Map.insert functionId xabiArgs' fIds)
          argsBin <- lift $ constructArgValues (Just (fmap argValueToText args)) xabiArgs
          tx <- lift $ prepareTx sk $
              TransactionHeader
                Nothing
                addr
                txParams
                (Wei (maybe 0 fromIntegral $ fmap unStrung value))
                (bin <> argsBin)
                nonceIncr
                (fromIntegral <$> chainId)
          put (names', cmIds', fIds')
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
      getBatchBlocTransactionResult' chainId hashes (resolve || _resolve)

postUsersSendList :: UserName -> Address -> Maybe Int -> Bool -> PostSendListRequest -> Bloc [BlocTransactionResult]
postUsersSendList userName addr chainId resolve (PostSendListRequest pw resolve' txs) = do
  sk <- getAccountSecKey userName pw addr
  if (null txs)
    then return []
    else do
      let SendTransaction _ _ mtp = head txs
      txParams <- getAccountTxParams addr chainId mtp
      txHeaders <- zipWithM
        (\(SendTransaction toAddr (Strung value) _) i -> do
            return $ TransactionHeader
              (Just toAddr)
              addr
              txParams
              (Wei $ fromIntegral value)
              (ByteString.empty)
              i
              (fromIntegral <$> chainId)
        ) txs [0..]
      txs' <- mapM (prepareTx sk) txHeaders
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
      getBatchBlocTransactionResult' chainId hashes (resolve || resolve')

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
  -> Maybe Int
  -> Bool
  -> PostMethodListRequest
  -> Bloc [BlocTransactionResult]
postUsersContractMethodList userName userAddr chainId resolve PostMethodListRequest{..} = do
  sk <- getAccountSecKey userName postmethodlistrequestPassword userAddr
  if (null postmethodlistrequestTxs)
    then return []
    else do
      let mc = head postmethodlistrequestTxs
      txParams <- getAccountTxParams userAddr chainId $ methodcallTxParams mc
      (txsCmIdsFuncNames,_) <- forStateT (Map.empty, Map.empty, Map.empty) (zip postmethodlistrequestTxs [0..]) $
        \ (MethodCall{..},nonceIncr) -> do
          (names, cmIds, fIds) <- get
          (mapKey, names') <- case Map.lookup methodcallContractName names of
            Just cmId -> return (cmId, names)
            Nothing -> do
              (mapKey' :: Int32) <- lift $ blocQuery1 $ proc () -> do
                (_,_,_,_,_,cmId) <- getContractsContractLatestQuery methodcallContractName -< ()
                returnA -< cmId
              return (mapKey', Map.insert methodcallContractName mapKey' names)
          (contract', cmIds') <- case Map.lookup mapKey cmIds of
            Just entry -> return (entry, cmIds)
            Nothing -> do
              xabi' <- lift $ getContractXabiByMetadataId mapKey
              let eitherErrorOrContract = xAbiToContract xabi'
              contract'' <- lift $ either (throwError . UserError . Text.pack) return eitherErrorOrContract
              let mapValue = contract''
              return (mapValue, Map.insert mapKey mapValue cmIds)
          let maybeFunc = OMap.lookup methodcallMethodName (fields $ C.mainStruct contract')

          sel <-
            case maybeFunc of
             Just (_, TypeFunction selector _ _) -> return selector
             _ -> lift $ throwError . UserError $ "Contract doesn't have a method named '" <> methodcallMethodName <> "'"

          functionId <- lift $ getFunctionId mapKey methodcallMethodName
          (xabiArgs, fIds') <- case Map.lookup functionId fIds of
            Just xabiArgs' -> return (xabiArgs', fIds)
            Nothing -> do
              zxcv <- lift $ getXabiFunctionsArgsQuery functionId
              return (zxcv, Map.insert functionId zxcv fIds)
          argsBin <- lift $ constructArgValues (Just (fmap argValueToText methodcallArgs)) xabiArgs
          tx <- lift $ prepareTx sk $
            TransactionHeader
              (Just methodcallContractAddress)
              userAddr
              txParams
              (Wei (fromIntegral $ unStrung methodcallValue))
              (sel <> argsBin)
              nonceIncr
              (fromIntegral <$> chainId)
          put (names', cmIds', fIds')
          -- resultXabiTypes <- getXabiFunctionsReturnValuesQuery functionId
          return (tx,mapKey,methodcallMethodName)
      let txs = [tx | (tx,_,_) <- txsCmIdsFuncNames]
      mapM_ (logWith logNotice . (<>) "txs are: " . Text.pack . show) txs
      hashes <- blocStrato $ postTxList txs
      void . blocModify $ \conn -> runInsertMany conn hashNameTable
        [( Nothing
        , constant hash
        , constant cmId
        , constant (2 :: Int32)
        , constant funcName
        )
        | (hash,(_,cmId, funcName)) <- zip hashes txsCmIdsFuncNames
        ]
      getBatchBlocTransactionResult' chainId hashes (resolve || postmethodlistrequestResolve)

postUsersContractMethod
  :: UserName
  -> Address
  -> ContractName
  -> Address
  -> Maybe Int
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
  (PostUsersContractMethodRequest password funcName args value mTxParams) = do
    sk <- getAccountSecKey userName password userAddr
    txParams <- getAccountTxParams userAddr chainId mTxParams
    cmId <- getContractsMetaDataIdExhaustive contractName contractAddr

    xabi <- getContractXabiByMetadataId cmId
    let eitherErrorOrContract = xAbiToContract xabi

    contract' <-
      either (throwError . UserError . Text.pack) return eitherErrorOrContract

    let maybeFunc = OMap.lookup funcName (fields $ C.mainStruct contract')

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
        (fromIntegral <$> chainId)
    logWith logNotice ("tx is: " <> Text.pack (show tx))
    hash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsert conn hashNameTable
      ( Nothing
      , constant hash
      , constant cmId
      , constant (2 :: Int32)
      , constant funcName
      )
    getBlocTransactionResult' chainId hash resolve

data TRD = TRD -- transaction resolution data
       { trdStatus :: BlocTransactionStatus
       , trdHash   :: Keccak256
       , trdIndex  :: Integer
       , trdResult :: Maybe TransactionResult
       }

data ContractCreationData = ContractCreationData
       { metadataId :: Int32
       , transactionHash :: Keccak256
       , contractName :: ContractName
       , transactionResult :: Maybe TransactionResult
       , batchIndex :: Integer
       }

data BatchState = BatchState
       { contractsList      :: [(Address, ContractCreationData)]
       , contractDetailsMap :: Map.Map ContractName ContractDetails
       , functionIdMap      :: Map.Map (Int32, Text) Int32
       , functionXabiMap    :: Map.Map Int32 Xabi
       , functionReturnMap  :: Map.Map Int32 [Type]
       }

emptyBatchState :: BatchState
emptyBatchState = BatchState [] Map.empty Map.empty Map.empty Map.empty

getBlocTransactionResult' :: Maybe Int -> Keccak256 -> Bool -> Bloc BlocTransactionResult
getBlocTransactionResult' chainId hash resolve =
  if resolve
    then (getBlocTransactionResult hash chainId True)
    else return (BlocTransactionResult Pending hash Nothing Nothing)

getBlocTransactionResult :: Keccak256 -> Maybe Int -> Bool -> Bloc BlocTransactionResult
getBlocTransactionResult hash chainId resolve = fmap head $ postBlocTransactionResults chainId resolve [hash]

getBatchBlocTransactionResult' :: Maybe Int -> [Keccak256] -> Bool -> Bloc [BlocTransactionResult]
getBatchBlocTransactionResult' chainId hashes resolve = do
  if resolve
    then (postBlocTransactionResults chainId True hashes)
    else do
      forM hashes $ \h -> return (BlocTransactionResult Pending h Nothing Nothing)

postBlocTransactionResults :: Maybe Int -> Bool -> [Keccak256] -> Bloc [BlocTransactionResult]
postBlocTransactionResults chainId resolve hashes = do
  let resolutions' = zipWith (\h i -> TRD Pending h i Nothing) hashes [0..]
  resolutions <- recurseTRDs chainId (0 :: Int) resolve resolutions' -- recursively batch resolve transactions
  evalAndReturn resolutions -- evaluate transaction results

merge :: [a] -> [a] -> (a -> a -> Bool) -> [a]
merge [] ps _ = ps
merge ds [] _ = ds
merge (d:ds) (p:ps) c =
  if c d p
    then (d : merge ds (p:ps) c)
    else (p : merge (d:ds) ps c)

recurseTRDs :: Maybe Int
        -> Int
        -> Bool
        -> [TRD]
        -> Bloc [TRD]
recurseTRDs chainId num resolve list = do
  let his = map (arr trdHash &&& arr trdIndex) list
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
      if num >= 60
        then return pending'
        else do
          logWith logNotice . Text.pack $
            "Polling BlocTransactionStatus for transaction hashes: " ++ (show $ map trdHash pending')
          void . liftIO $ threadDelay 1000000
          recurseTRDs chainId (num + 1) resolve pending'
  return $ merge pending done (\(TRD _ _ i _) (TRD _ _ j _) -> i < j)

evalAndReturn :: [TRD]
              -> Bloc [BlocTransactionResult]
evalAndReturn list = do
  (mbtrs,state) <- forStateT emptyBatchState list $
    \(TRD status hash index mtxr) -> do
      case status of
        Pending -> return . Just $ (BlocTransactionResult Pending hash Nothing Nothing, index)
        Failure -> return . Just $ (BlocTransactionResult Failure hash mtxr Nothing, index)
        Success -> do
          (cmId,ttype,tdata)::(Int32,Int32,Text) <- lift $ blocQuery1 $ contractByTxHash hash
          case ttype of
            0 -> return . Just $ (BlocTransactionResult Success hash mtxr (Just . Send . fromJust . Aeson.decode . BL.fromStrict $ Text.encodeUtf8 tdata), index)
            1 -> contractResult hash mtxr cmId tdata index
            2 -> functionResult hash mtxr cmId tdata index
            _ -> error $ "Unexpected transaction type: got" ++ show ttype
  let jbtrs = [btr | Just btr <- mbtrs]
      cl = contractsList state
  (nbtrs,_) <- do
    void . blocModify $ \conn -> runInsertMany conn contractsInstanceTable
      [
      ( Nothing
      , constant cmId
      , constant addr'
      , Nothing
      )
      | (addr', ContractCreationData cmId _ _ _ _) <- cl
      ]
    forStateT state cl $
      \(addr', ContractCreationData _ hash name mtxr index) -> do
        st <- get
        let cds = contractDetailsMap st
        (details, cds') <- case Map.lookup name cds of
          Just details' -> return (details'{contractdetailsAddress = Just (Unnamed addr')}, cds)
          Nothing -> do
            details' <- lift $ getContractDetails name (Unnamed addr')
            return (details', Map.insert name details' cds)
        put st{contractDetailsMap = cds'}
        return $ (BlocTransactionResult Success hash mtxr (Just $ Upload details), index)
  let btrs = map fst $ merge jbtrs nbtrs (\r1 r2 -> snd r1 < snd r2)
  return btrs

contractResult :: Keccak256
               -> Maybe TransactionResult
               -> Int32
               -> Text
               -> Integer
               -> StateT BatchState Bloc (Maybe (BlocTransactionResult, Integer))
contractResult hash mtxr cmId name index = do
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
          Just _ -> lift $ throwError $ UserError "Contract failed to upload, likely because the constructor threw"
          Nothing -> lift $ throwError $ UserError "Transaction succeeded, but contract was neither created, nor destroyed"
      stratoMsg  -> lift $ throwError $ UserError stratoMsg
    Just addr' -> do
      xs::[Int32] <- lift $ blocQuery $ proc () -> do
        (cmId',_,_,_,_,_,_,_) <- contractByAddress name addr' -< ()
        returnA -< cmId'
      if (isNothing $ listToMaybe xs)
        then do
          st <- get
          put st{contractsList =
                  (contractsList st) ++ [(addr', ContractCreationData cmId hash (ContractName name) mtxr index)]
                }
          return Nothing
        else do
          st <- get
          let cds = contractDetailsMap st
              cn  = ContractName name
          (details, cds') <- case Map.lookup cn cds of
            Just details' -> return (details'{contractdetailsAddress = Just (Unnamed addr')}, cds)
            Nothing -> do
              details' <- lift $ getContractDetails cn (Unnamed addr')
              return (details', Map.insert cn details' cds)
          put st{contractDetailsMap = cds'}
          return $ Just (BlocTransactionResult Success hash mtxr (Just $ Upload details), index)

functionResult :: Keccak256
               -> Maybe TransactionResult
               -> Int32
               -> Text
               -> Integer
               -> StateT BatchState Bloc (Maybe (BlocTransactionResult, Integer))
functionResult hash mtxr cmId funcName index = do
  let Just txResult = mtxr
  state <- get
  (functionId, state') <- case Map.lookup (cmId,funcName) (functionIdMap state) of
    Just fid -> return (fid, state)
    Nothing -> do
      fid <- lift $ getFunctionId cmId funcName
      return (fid,state{functionIdMap = Map.insert (cmId,funcName) fid (functionIdMap state)})
  (xabi, state'') <- case Map.lookup cmId (functionXabiMap state') of
    Just xabi' -> return (xabi', state')
    Nothing -> do
      xabi' <- lift $ getContractXabiByMetadataId cmId
      return (xabi', state'{functionXabiMap = Map.insert cmId xabi' (functionXabiMap state')})
  (mappedResultTypes, state''') <- case Map.lookup functionId (functionReturnMap state'') of
    Just types -> return (types, state'')
    Nothing -> do
      resultXabiTypes <- lift $ getXabiFunctionsReturnValuesQuery functionId
      let
        orderedResultIndexedXT = sortOn Xabi.indexedTypeIndex resultXabiTypes
      orderedResultTypes <- lift $
        for orderedResultIndexedXT $ \Xabi.IndexedType{..} ->
          either (throwError . UserError . Text.pack) return $
            xabiTypeToType xabi indexedTypeType
      let
        types' = map convertEnumTypeToInt orderedResultTypes
      return (types', state''{functionReturnMap = Map.insert functionId types' (functionReturnMap state'')})
  let
    txResp = transactionresultResponse txResult
    -- TODO::(map convertEnumTypeToInt orderedResultTypes) is currenlty a
    -- workaround for enums
    mFormattedResponse =
      convertResultResToVals txResp mappedResultTypes
  put state'''
  case transactionresultMessage txResult of
    "Success!" -> do
      formattedResponse <- lift $ blocMaybe ("Failed to parse response: " <> txResp) mFormattedResponse
      return $ Just (BlocTransactionResult Success hash mtxr (Just $ Call formattedResponse), index)
    stratoMsg  -> lift $ throwError $ UserError stratoMsg

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
    constructArgValues args argNamesTypes

constructArgValues :: Maybe (Map Text Text) -> Map Text Xabi.IndexedType -> Bloc ByteString
constructArgValues args argNamesTypes = do
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

getAccountTxParams :: Address -> Maybe Int -> Maybe TxParams -> Bloc TxParams
getAccountTxParams addr chainId = \case
  Nothing -> getAcctNonce >>= \n -> return emptyTxParams{txparamsNonce = Just n}
  Just params@TxParams{..} ->
    case txparamsNonce of
      Just _ -> return params
      Nothing -> getAcctNonce >>= \n -> return params{txparamsNonce = Just n}
  where
    getAcctNonce = do
      accts <- blocStrato $ getAccountsFilter
        accountsFilterParams{qaAddress = Just addr, qaChainId = fromIntegral <$> chainId}
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
  , unsignedTransactionChainId = transactionheaderChainId
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
  , posttransactionChainId = Hex <$> chainId
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
    chainId = transactionChainId tx
