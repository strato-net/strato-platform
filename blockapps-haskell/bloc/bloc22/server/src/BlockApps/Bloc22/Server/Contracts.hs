{-# LANGUAGE Arrows              #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}

module BlockApps.Bloc22.Server.Contracts where

import           ClassyPrelude                   ((<>))
import           Control.Arrow
import           Control.Monad.Except
import           Control.Monad.Reader.Class      (asks)
import           Data.Foldable
import           Data.Int
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import           Data.Time.Clock.POSIX
import           Data.Traversable
import           Numeric
import           Opaleye

import           Blockchain.SolidVM.Model

import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum
import           BlockApps.Logging
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Parse.Parser (parseXabi)
import           BlockApps.Solidity.Xabi
import           BlockApps.Solidity.Xabi.Def
import           BlockApps.SolidityVarReader
import           BlockApps.SolidVMStorageDecoder
import           BlockApps.Storage               as S
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types          as T
import           BlockApps.XAbiConverter

getContracts :: Maybe ChainId -> Bloc GetContractsResponse
getContracts chainId = blocTransaction $ do
  let
    -- current bloc returns milliseconds
    -- TODO: get those extra 3 significant figures of accuracy
    toMilliSec utc = truncate (utcTimeToPOSIXSeconds utc) * 1000
    addressToVal addr utc cid = AddressCreatedAt (toMilliSec utc) (Unnamed addr) cid
    addressesToMap = foldr'
      (\ (key,addr,utc,cid) -> Map.insertWith (++) key [addressToVal addr utc cid])
      Map.empty
    nameToVal name utc cid = AddressCreatedAt (toMilliSec utc) (Named name) cid
    namesToMap = foldr'
      (\ (key,name,utc,cid) -> Map.insertWith (++) key [nameToVal name utc cid])
      Map.empty
  contractsAddresses <- blocQuery $ getContractsAddressesQuery chainId
  contractsNamesAsAddresses <- blocQuery $ getContractsNamesAsAddressesQuery chainId
  return . GetContractsResponse $
    addressesToMap contractsAddresses
    `Map.union`
    namesToMap contractsNamesAsAddresses

getContractsData :: ContractName -> Bloc [MaybeNamed Address]
getContractsData (ContractName contractName) = blocTransaction $ do
  (addresses :: [(Address, Maybe ChainId)]) <- blocQuery $ getContractsDataAddressesQuery contractName
  names <- blocQuery $ getContractsDataNamesQuery contractName
  return $ map (Unnamed . fst) addresses ++ map Named names

getContractsContract :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc ContractDetails
getContractsContract name addr chainId =
  let err = UserError $ Text.concat
              [ "getContractsContract: Couldn't find contract details for "
              , Text.pack $ show name
              , " at address "
              , Text.pack $ show addr
              , " on chain "
              , maybe "Main" (Text.pack . show) chainId
              ]
   in maybe (throwError err) return =<< getContractDetails name addr chainId

translateStorageMap :: [T.Storage] -> S.Storage
translateStorageMap storage' =
  let storageMap = Map.fromList $ map (\T.Storage{..} -> case storageKV of
        EVMEntry k v -> (unHex k, unHex v)
        SolidVMEntry{} -> error "translateStorageMap: undefined for SolidVM") storage'

      storage k = fromMaybe 0 $ Map.lookup k storageMap
  in storage

getContractsState :: ContractName
                  -> MaybeNamed Address
                  -> Maybe ChainId
                  -> Maybe Text
                  -> Maybe Integer
                  -> Maybe Integer
                  -> Bool
                  -> Bloc GetContractsStateResponses -- state-translation
getContractsState contract@(ContractName contractName) contractId chainId mName mCount mOffset mLength = do
  let err = UserError $ Text.concat
              [ "getContractsState: Couldn't find "
              , contractName
              , " with ID "
              , Text.pack $ show contractId
              ]
  (cmId, details) <- maybe (throwError err) return =<< getContractDetailsAndMetadataId contract contractId chainId
  let eitherErrorOrContract' = xAbiToContract $ contractdetailsXabi details
  contract' <- either (throwError . UserError . Text.pack) return eitherErrorOrContract'

  address <- case contractId of
    Unnamed addr -> return addr
    Named "Latest" -> do
      blocQuery1 "getContractsState/instances" $ proc () -> do
        (_,cmId',addr,_,_) <-
          (limit 1 . orderBy (desc (\(_,_,_,time,_) -> time)))
            (queryTable contractsInstanceTable) -< ()
        restrict -< cmId' .== constant cmId
        returnA -< addr
    Named somethingElse -> blocError $ UserError $
      "Expected address or \"Latest\": saw " <> somethingElse

  fetchLimit <- asks stateFetchLimit
  let ofs = fromMaybe 0 mOffset
      cnt = fromMaybe fetchLimit mCount

  storage' <- case mName of
    Nothing -> blocStrato $ getStorage
      storageFilterParams{ qsAddress = Just address
                         , qsChainId = maybeToList chainId
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
    (Storage{storageKind=SolidVM}:_, Nothing) -> return .
        decodeSolidVMValues $ map (\Storage{storageKV=SolidVMEntry k v} -> (k, v)) storage'
    (Storage{storageKind=SolidVM}:_, Just name) ->
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
    , Text.pack $ unlines $ map (("  " ++) . show . storageKV) $ storage'
    , "End of storage"
    ]
  return $ Map.fromList ret
  where
    getStorageRange :: Address -> (Word256, Word256) -> Bloc [T.Storage]
    getStorageRange a (o,c) = do
      blocStrato $ getStorage
        storageFilterParams{ qsAddress = Just a
                           , qsMinKey = Just . fromInteger $ toInteger o
                           , qsMaxKey = Just . fromInteger $ toInteger (o + c - 1)
                           , qsChainId = maybeToList chainId
                           }

getContractsBatchStates :: [GetContractsBatchStatesRequest]
                        -> Bloc [GetContractsStateResponses]
getContractsBatchStates = traverse flattenRequest
  where flattenRequest GetContractsBatchStatesRequest{..} =
          getContractsState getcontractsbatchstatesrequestContractName
                            getcontractsbatchstatesrequestAddress
                            getcontractsbatchstatesrequestChainid
                            getcontractsbatchstatesrequestVarName
                            getcontractsbatchstatesrequestCount
                            getcontractsbatchstatesrequestOffset
                            (fromMaybe False getcontractsbatchstatesrequestLength)

getContractsDetails :: Address -> Maybe ChainId -> Bloc ContractDetails
getContractsDetails contractAddress chainId = do
  let err = UserError $ Text.concat
              [ "getContractsDetails: couldn't find contract details for address "
              , Text.pack $ addressString contractAddress
              , " on chain "
              , maybe "Main" (Text.pack . show) chainId
              ]
  mdetails <- getContractDetailsByAddressOnly contractAddress chainId
  maybe (throwError err) (return . completeContractDetailXabi) mdetails

getContractsFunctions :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc [FunctionName]
getContractsFunctions contractName contractId chainId = blocTransaction $ do
  let err = UserError $ Text.concat
              [ "getContractsFunctions: couldn't find contract details for "
              , Text.pack $ show contractName
              , " at address "
              , Text.pack $ show contractId
              , " on chain "
              , maybe "Main" (Text.pack . show) chainId
              ]
  mXabi <- getContractXabi contractName contractId chainId
  maybe (throwError err) (return . map FunctionName . Map.keys . xabiFuncs) mXabi

getContractsSymbols :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc [SymbolName]
getContractsSymbols contractName contractId chainId = blocTransaction $ do
  let err = UserError $ Text.concat
              [ "getContractsSymbols: couldn't find contract details for "
              , Text.pack $ show contractName
              , " at address "
              , Text.pack $ show contractId
              , " on chain "
              , maybe "Main" (Text.pack . show) chainId
              ]
  mXabi <- getContractXabi contractName contractId chainId
  maybe (throwError err) (return . map SymbolName . Map.keys . xabiVars) mXabi

getContractsEnum :: ContractName -> MaybeNamed Address -> EnumName -> Maybe ChainId -> Bloc [EnumValue]
getContractsEnum contractName contractId (EnumName enumName) chainId = do
  let err = UserError $ Text.concat
              [ "getContractsEnum: couldn't find contract details for "
              , Text.pack $ show contractName
              , " at address "
              , Text.pack $ show contractId
              , " on chain "
              , maybe "Main" (Text.pack . show) chainId
              ]
  blocTransaction $ do
    mXabi <- getContractXabi contractName contractId chainId
    flip (maybe (throwError err)) mXabi $ \xabi ->
      let enums = concat [names | (n, Enum names _) <- Map.toList (xabiTypes xabi), n == enumName]
      in return $ map EnumValue enums

getContractsStateMapping :: ContractName
                         -> MaybeNamed Address
                         -> SymbolName
                         -> Text
                         -> Maybe ChainId
                         -> Bloc GetContractsStateMappingResponse
                         -- state-translation
getContractsStateMapping contract@(ContractName contractName) contractId (SymbolName mappingName) keyName chainId = do
  let err = UserError $ Text.concat
              [ "getContractsStateMapping: Couldn't find "
              , contractName
              , "with ID "
              , Text.pack $ show contractId
              ]
  (metadataId, details) <- maybe (throwError err) return =<< getContractDetailsAndMetadataId contract contractId chainId
  let eitherErrorOrContract = xAbiToContract $ contractdetailsXabi details

  contract' <- either (throwError . UserError . Text.pack) return eitherErrorOrContract
  address <- case contractId of
              Unnamed addr -> return addr
              Named "Latest" -> blocQuery1 "getContractsStateMapping/instances" $ proc () -> do
                (_,cmId,addr,_,_) <-
                  (limit 1 . orderBy (desc (\(_,_,_,time,_) -> time)))
                    (queryTable contractsInstanceTable) -< ()
                restrict -< cmId .== constant (metadataId::Int32)
                returnA -< addr
              Named somethingElse -> blocError $ UserError $
                                     "Expected address or \"Latest\": saw " <> somethingElse

  storage' <- blocStrato $ getStorage
    storageFilterParams{qsAddress = Just address}

  fetchLimit <- fromInteger <$> asks stateFetchLimit

  let storageMap = Map.fromList $ map (\case
        T.Storage{storageKV=EVMEntry k v } -> (unHex k, unHex v)
        T.Storage{storageKV=SolidVMEntry{}} -> error "unimplemented: getContractsStateMapping for SolidVM") storage'
      storage k = fromMaybe 0 $ Map.lookup k storageMap
      ret = valueToSolidityValue <$> decodeMapValue fetchLimit (typeDefs contract') (mainStruct contract') storage mappingName keyName

  $logDebugS "getContractsStateMapping/storage" $ Text.unlines
    [ "Storage:"
    , Text.pack $ unlines $ map (\(k, v) -> "  " ++ show k ++ ":" ++ showHex v "") $ Map.toList storageMap
    , "End of storage"
    ]

  case ret of
   Left e -> throwError . UserError $ Text.pack e
   Right val -> return $ Map.fromList [(mappingName, Map.fromList [(keyName, val)])]

getContractsStates :: ContractName -> Bloc [GetContractsStatesResponse] -- state-translation
getContractsStates _ = throwError $ Unimplemented "getContractsStates"

postContractsCompile :: [PostCompileRequest] -> Bloc [PostCompileResponse]
postContractsCompile = blocTransaction . fmap concat . traverse compileOneContract
  where
    compileOneContract PostCompileRequest{..} = do
      idsAndDetails <- sourceToContractDetails (Do Compile) postcompilerequestSource
      for (toList idsAndDetails) $ \ (_,details) -> do
        let eBlockappsjsXabi = uncurry completeXabi $ (contractdetailsName &&& contractdetailsXabi) details
        case eBlockappsjsXabi of
          Left msg -> throwError $
            AnError (Text.append "Xabi conversion to Blockapps-js Xabi failed, "  (Text.pack msg))
          Right _ -> do
            let ptr = contractdetailsCodeHash details
            case ptr of
              EVMCode hsh -> return $ PostCompileResponse (contractdetailsName details) (shaKeccak256 hsh)
              _ -> throwError $ AnError (Text.pack "Somebody called contracts/compile on SolidVM Code, but it only works on EVM Code")

postContractsXabi :: PostXabiRequest -> Bloc PostXabiResponse
postContractsXabi PostXabiRequest{..} =
   let xabis :: Either String (Map.Map Text Xabi)
       xabis = do
         partialXabis <- Map.fromList . snd <$> parseXabi "src" (Text.unpack postxabirequestSrc)
         Map.traverseWithKey completeXabi partialXabis
   in case xabis of
        Left msg -> throwError . UserError .
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
