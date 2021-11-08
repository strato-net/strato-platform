{-# LANGUAGE Arrows              #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeOperators       #-}

module BlockApps.Bloc22.Server.Contracts where

import           Control.Arrow
import           Control.Monad                   (join)
import qualified Control.Monad.Change.Alter      as A
import           Data.Foldable
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import           Data.Traversable
import           Numeric
import           UnliftIO

import           Blockchain.SolidVM.Model

import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Monad
import           BlockApps.Logging
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Parse.Parser (parseXabi)
import           BlockApps.Solidity.Xabi
import           BlockApps.Solidity.Xabi.Def
import           BlockApps.SolidityVarReader
import           BlockApps.SolidVMStorageDecoder
import           BlockApps.Storage               as S
import           BlockApps.XAbiConverter
import           Blockchain.Data.AddressStateRef
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.CoreAPI
import           Control.Monad.Composable.SQL
import           Data.Source.Map (SourceMap)
import           Handlers.AccountInfo
import           Handlers.Storage
import qualified MaybeNamed
import           SQLM

hexStorageToWord256 :: HexStorage -> Word256
hexStorageToWord256 (HexStorage bs) = bytesToWord256 bs

getContracts :: ( MonadIO m
                , MonadUnliftIO m
                , MonadLogger m
                , HasBlocSQL m
                , HasSQL m
                )
             => Maybe Integer -> Maybe Integer -> Maybe ChainId -> m GetContractsResponse
getContracts mOffset mLimit chainId = blocTransaction $ do
  let
    addressToVal addr cid = AddressCreatedAt 0 addr cid
    addressesToMap = foldrM
      (\(AddressStateRef' (AddressStateRef{..}) _) m ->
        case addressStateRefContractName of
          Just n -> pure $ Map.insertWith (++) (Text.pack n) [addressToVal addressStateRefAddress chainId] m
          Nothing -> case addressStateRefCodeHash of
            Nothing -> pure m
            Just ch -> do
              mName <- listToMaybe . map fst <$> evmContractByCodeHash ch
              pure $ case mName of
                Nothing -> m
                Just n -> Map.insertWith (++) n [addressToVal addressStateRefAddress chainId] m
      )
      Map.empty
  addrStateRefs <- getAccount' accountsFilterParams
    { _qaChainId = maybeToList chainId
    , _qaExternal = Just False
    , _qaOffset = fromIntegral <$> mOffset
    , _qaLimit = fromIntegral <$> mLimit
    }
  reducedResponseMap <- addressesToMap addrStateRefs
  return . GetContractsResponse $ reducedResponseMap

getContractsData :: ( MonadIO m
                    , MonadUnliftIO m
                    , MonadLogger m
                    , HasBlocSQL m
                    , HasSQL m
                    )
                 => ContractName -> m [Address]
getContractsData (ContractName contractName) = blocTransaction $ do
  evmCodeHashes <- evmCodeHashByName contractName
  addrStateRefs <- fmap concat . for evmCodeHashes $ \codeHash -> getAccount' accountsFilterParams
    { _qaCodeHash = Just codeHash
    }
  return $ (\(AddressStateRef' r _)-> addressStateRefAddress r) <$> addrStateRefs

getContractsContract :: ( MonadIO m
                        , MonadUnliftIO m
                        , A.Selectable Account AddressState m
                        , (Keccak256 `A.Alters` SourceMap) m
                        , MonadLogger m
                        , HasBlocSQL m
                        , HasBlocEnv m
                        , HasSQL m
                        )
                     => ContractName -> Address -> Maybe ChainId -> m ContractDetails
getContractsContract name addr chainId = do
  let err = UserError $ Text.concat
              [ "getContractsContract: Couldn't find contract details for "
              , Text.pack $ show name
              , " at address "
              , Text.pack $ show addr
              , " on chain "
              , maybe "Main" (Text.pack . show) chainId
              ]
  mAddrStateRef <- listToMaybe <$> getAccount' accountsFilterParams
    { _qaChainId = maybeToList chainId
    , _qaAddress = Just addr
    , _qaExternal = Just False
    , _qaLimit = Just 1
    }
  case mAddrStateRef of
    Nothing -> throwIO err
    Just (AddressStateRef' a@AddressStateRef{..} _) -> case addressStateRefCodePtr a of
      Nothing -> throwIO err
      Just cp -> getContractDetailsByCodeHash cp >>= \case
        Left e -> throwIO $ UserError e
        Right details -> pure details

translateStorageMap :: [StorageAddress] -> S.Storage
translateStorageMap storage' =
  let storageMap = Map.fromList $ map (\StorageAddress{..} -> case kind of
        EVM -> (hexStorageToWord256 key, hexStorageToWord256 value)
        SolidVM -> error "translateStorageMap: undefined for SolidVM") storage'

      storage k = fromMaybe 0 $ Map.lookup k storageMap
  in storage

getContractsState :: ( MonadIO m
                     , MonadLogger m
                     , A.Selectable Account AddressState m
                     , (Keccak256 `A.Alters` SourceMap) m
                     , HasBlocSQL m
                     , HasBlocEnv m
                     , HasCoreAPI m
                     , HasSQL m
                     )
                  => ContractName
                  -> Address
                  -> Maybe ChainId
                  -> Maybe Text
                  -> Maybe Integer
                  -> Maybe Integer
                  -> Bool
                  -> m GetContractsStateResponses -- state-translation
getContractsState _ address chainId mName mCount mOffset mLength = do
  details <- getContractsDetails address chainId
  let eitherErrorOrContract' = xAbiToContract $ contractdetailsXabi details
  contract' <- either (throwIO . UserError . Text.pack) return eitherErrorOrContract'

  fetchLimit <- fmap stateFetchLimit getBlocEnv
  let ofs = fromMaybe 0 mOffset
      cnt = fromMaybe fetchLimit mCount

  storage' <- case mName of
    Nothing -> blocStrato $ getStorageClient
      storageFilterParams{ qsAddress = Just address
                         , qsChainId = MaybeNamed.Unnamed <$> chainId
                         }
    Just name ->
      let ranges = decodeStorageKey
               (typeDefs contract')
               (mainStruct contract')
               [name]
               0
               ofs
               cnt
               mLength
      in join <$> mapM (getStorageRange address) ranges

  let storage = translateStorageMap storage'

  ret <- case (storage', mName) of
    (StorageAddress{kind=SolidVM}:_, Nothing) -> do
      $logInfoS "getContractsState/SolidVM" $ Text.unlines
        [ "Storage:"
        , Text.pack $ unlines $ map (\s -> ("  " ++) . show $ (kind s, key s, value s)) $ storage'
        , "End of storage"
        ]
      return $
           (contractFunctions $ mainStruct contract')
        ++ (decodeSolidVMValues $ map (key &&& value) storage')
    (StorageAddress{kind=SolidVM}:_, Just name) ->
       error $ "unimplemented: range based solidVM queries" ++ Text.unpack name
    -- Treat this potentially empty storage as the EVM, even though it could be on SolidVM.
    -- This may still be useful to return enums and constants in EVM, and should hopefully
    -- still return [] for [] on SolidVM.
    (_, Just name) ->
      let vals = decodeValuesFromList (typeDefs contract') (mainStruct contract') storage 0
                 ofs cnt mLength [name]
          solVals = map (fmap valueToSolidityValue) vals
      in return solVals
    (_, Nothing) ->
      let vals = decodeValues fetchLimit (typeDefs contract') (mainStruct contract') storage 0
          solVals = map (fmap valueToSolidityValue) vals
      in return solVals
  $logDebugS "getContractsState/storage" $ Text.unlines
    [ "Storage:"
    , Text.pack $ unlines $ map (\s -> ("  " ++) $ show (kind s, key s, value s)) $ storage'
    , "End of storage"
    ]
  return $ Map.fromList ret
  where
    getStorageRange :: (MonadIO m, MonadLogger m, HasCoreAPI m) =>
                       Address -> (Word256, Word256) -> m [StorageAddress]
    getStorageRange a (o,c) = do
      blocStrato $ getStorageClient
        storageFilterParams{ qsAddress = Just a
                           , qsMinKey = Just . word256ToHexStorage . fromInteger $ toInteger o
                           , qsMaxKey = Just . word256ToHexStorage . fromInteger $ toInteger (o + c - 1)
                           , qsChainId = MaybeNamed.Unnamed <$> chainId
                           }

postContractsBatchStates :: ( MonadIO m
                            , MonadLogger m
                            , A.Selectable Account AddressState m
                            , (Keccak256 `A.Alters` SourceMap) m
                            , HasBlocSQL m
                            , HasBlocEnv m
                            , HasCoreAPI m
                            , HasSQL m
                            )
                         => [PostContractsBatchStatesRequest]
                         -> m [GetContractsStateResponses]
postContractsBatchStates = traverse flattenRequest
  where flattenRequest PostContractsBatchStatesRequest{..} =
          getContractsState postcontractsbatchstatesrequestContractName
                            postcontractsbatchstatesrequestAddress
                            postcontractsbatchstatesrequestChainid
                            postcontractsbatchstatesrequestVarName
                            postcontractsbatchstatesrequestCount
                            postcontractsbatchstatesrequestOffset
                            (fromMaybe False postcontractsbatchstatesrequestLength)

getContractsDetails :: ( MonadUnliftIO m
                       , A.Selectable Account AddressState m
                       , (Keccak256 `A.Alters` SourceMap) m
                       , MonadLogger m
                       , HasSQL m
                       , HasBlocSQL m
                       , HasBlocEnv m
                       )
                    => Address -> Maybe ChainId -> m ContractDetails
getContractsDetails contractAddress chainId = do
  let err = UserError $ Text.concat
              [ "getContractsDetails: couldn't find contract details for address "
              , Text.pack $ formatAddressWithoutColor contractAddress
              , " on chain "
              , maybe "Main" (Text.pack . show) chainId
              ]
  mAddrStateRef <- listToMaybe <$> getAccount' accountsFilterParams
    { _qaChainId = maybeToList chainId
    , _qaAddress = Just contractAddress
    , _qaExternal = Just False
    , _qaLimit = Just 1
    }
  case mAddrStateRef of
    Nothing -> throwIO err
    Just (AddressStateRef' a@AddressStateRef{..} _) -> case addressStateRefCodePtr a of
      Nothing -> throwIO err
      Just cp -> getContractDetailsByCodeHash cp >>= \case
        Left e -> throwIO $ UserError e
        Right details -> pure details

getContractXabi :: ( MonadUnliftIO m
                   , A.Selectable Account AddressState m
                   , (Keccak256 `A.Alters` SourceMap) m
                   , MonadLogger m
                   , HasSQL m
                   , HasBlocSQL m
                   , HasBlocEnv m
                   )
                => Account -> m Xabi
getContractXabi (Account addr chainId) = contractdetailsXabi <$> getContractsDetails addr (ChainId <$> chainId)

getContractsFunctions :: ( MonadIO m
                         , A.Selectable Account AddressState m
                         , (Keccak256 `A.Alters` SourceMap) m
                         , MonadLogger m
                         , HasSQL m
                         , HasBlocSQL m
                         , HasBlocEnv m
                         )
                      => ContractName -> Address -> Maybe ChainId -> m [FunctionName]
getContractsFunctions _ contractId chainId = blocTransaction $ do
  mXabi <- getContractXabi (Account contractId $ unChainId <$> chainId)
  pure . map FunctionName . Map.keys $ xabiFuncs mXabi

getContractsSymbols :: ( MonadIO m
                       , A.Selectable Account AddressState m
                       , (Keccak256 `A.Alters` SourceMap) m
                       , MonadLogger m
                       , HasSQL m
                       , HasBlocSQL m
                       , HasBlocEnv m
                       )
                    => ContractName -> Address -> Maybe ChainId -> m [SymbolName]
getContractsSymbols _ contractId chainId = blocTransaction $ do
  mXabi <- getContractXabi (Account contractId $ unChainId <$> chainId)
  pure . map SymbolName . Map.keys $ xabiVars mXabi

getContractsEnum :: (MonadIO m
                    , A.Selectable Account AddressState m
                    , (Keccak256 `A.Alters` SourceMap) m
                    , MonadLogger m
                    , HasSQL m
                    , HasBlocSQL m
                    , HasBlocEnv m
                    )
                 => ContractName -> Address -> EnumName -> Maybe ChainId -> m [EnumValue]
getContractsEnum _ contractId (EnumName enumName) chainId = blocTransaction $ do
  xabi <- getContractXabi (Account contractId $ unChainId <$> chainId)
  let enums = concat [names | (n, Enum names _) <- Map.toList (xabiTypes xabi), n == enumName]
   in return $ map EnumValue enums

getContractsStateMapping :: (MonadIO m
                            , A.Selectable Account AddressState m
                            , (Keccak256 `A.Alters` SourceMap) m
                            , MonadLogger m
                            , HasSQL m
                            , HasBlocSQL m
                            , HasBlocEnv m
                            , HasCoreAPI m
                            )
                         => ContractName
                         -> Address
                         -> SymbolName
                         -> Text
                         -> Maybe ChainId
                         -> m GetContractsStateMappingResponse
                         -- state-translation
getContractsStateMapping _ address (SymbolName mappingName) keyName chainId = do
  details <- getContractsDetails address chainId
  let eitherErrorOrContract = xAbiToContract $ contractdetailsXabi details

  contract' <- either (throwIO . UserError . Text.pack) return eitherErrorOrContract

  storage' <- blocStrato $ getStorageClient
    storageFilterParams{qsAddress = Just address}

  fetchLimit <- fromInteger <$> fmap stateFetchLimit getBlocEnv

  let storageMap = Map.fromList $ map (\s -> case kind s of
        EVM -> (hexStorageToWord256 $ key s, hexStorageToWord256 $ value s)
        SolidVM -> error "unimplemented: getContractsStateMapping for SolidVM") storage'
      storage k = fromMaybe 0 $ Map.lookup k storageMap
      ret = valueToSolidityValue <$> decodeMapValue fetchLimit (typeDefs contract') (mainStruct contract') storage mappingName keyName

  $logDebugS "getContractsStateMapping/storage" $ Text.unlines
    [ "Storage:"
    , Text.pack $ unlines $ map (\(k, v) -> "  " ++ show k ++ ":" ++ showHex v "") $ Map.toList storageMap
    , "End of storage"
    ]

  case ret of
   Left e -> throwIO . UserError $ Text.pack e
   Right val -> return $ Map.fromList [(mappingName, Map.fromList [(keyName, val)])]

getContractsStates :: MonadIO m =>
                      ContractName -> m [GetContractsStatesResponse] -- state-translation
getContractsStates _ = throwIO $ Unimplemented "getContractsStates"

postContractsCompile :: ( MonadIO m
                        , (Keccak256 `A.Alters` SourceMap) m
                        , MonadLogger m
                        , HasBlocSQL m
                        )
                     => [PostCompileRequest] -> m [PostCompileResponse]
postContractsCompile = blocTransaction . fmap concat . traverse compileOneContract
  where
    compileOneContract PostCompileRequest{..} = do
      let shouldCompile = case Text.toLower <$> postcompilerequestVm of
            Just "solidvm" -> Don't Compile
            _ -> Do Compile
      idsAndDetails <- sourceToContractDetails shouldCompile postcompilerequestSource
      for (toList idsAndDetails) $ \ details -> do
        let eBlockappsjsXabi = uncurry completeXabi $ (contractdetailsName &&& contractdetailsXabi) details
        case eBlockappsjsXabi of
          Left msg -> throwIO $
            AnError (Text.append "Xabi conversion to Blockapps-js Xabi failed, "  (Text.pack msg))
          Right _ -> do
            let ptr = contractdetailsCodeHash details
            case ptr of
              EVMCode hsh -> return $ PostCompileResponse (contractdetailsName details) hsh
              SolidVMCode name hsh -> return $ PostCompileResponse (Text.pack name) hsh
              CodeAtAccount _ _ -> throwIO . AnError $ "sourceToContractDetails somehow returned CodeAtAccount"
              
postContractsXabi :: MonadIO m =>
                     PostXabiRequest -> m PostXabiResponse
postContractsXabi PostXabiRequest{..} =
   let xabis :: Either String (Map.Map Text Xabi)
       xabis = do
         partialXabis <- Map.fromList . snd <$> parseXabi "src" (Text.unpack postxabirequestSrc)
         Map.traverseWithKey completeXabi partialXabis
   in case xabis of
        Left msg -> throwIO . UserError .
            ("contract compilation for xabi failed: " <>) $ Text.pack msg
        Right xs -> return . PostXabiResponse $ xs


completeContractDetailXabi :: ContractDetails -> ContractDetails
completeContractDetailXabi cd =
  let eXabi = xAbiToContract $ contractdetailsXabi cd in
  case eXabi of
    Right xabi -> cd { contractdetailsXabi = contractToXabi (contractdetailsName cd) xabi }
    Left _ -> cd


completeXabi :: Text -> Xabi -> Either String Xabi
completeXabi name xabi = do
  c <- xAbiToContract xabi
  return $ contractToXabi name c
