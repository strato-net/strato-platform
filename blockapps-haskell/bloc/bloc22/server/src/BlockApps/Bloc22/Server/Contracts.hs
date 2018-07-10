{-# LANGUAGE Arrows              #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}

module BlockApps.Bloc22.Server.Contracts where

import           Control.Arrow
import           Control.Monad.Except
import           Control.Monad.Log
import           Data.Foldable
import           Data.Int
import           Data.LargeWord                  (Word256)
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Monoid
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import           Data.Time.Clock.POSIX
import           Data.Traversable
import           Numeric
import           Opaleye

import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import           BlockApps.Cirrus.Client
import           BlockApps.Ethereum
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Parse.Parser (parseXabi)
import           BlockApps.Solidity.Xabi
import           BlockApps.SolidityVarReader
import           BlockApps.Storage               as S
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types          as T
import           BlockApps.XAbiConverter

getContracts :: Bloc GetContractsResponse
getContracts = blocTransaction $ do
  let
    -- current bloc returns milliseconds
    -- TODO: get those extra 3 significant figures of accuracy
    toMilliSec utc = truncate (utcTimeToPOSIXSeconds utc) * 1000
    addressToVal addr utc = AddressCreatedAt (toMilliSec utc) (Unnamed addr)
    addressesToMap = foldr'
      (\ (key,addr,utc) -> Map.insertWith (++) key [addressToVal addr utc])
      Map.empty
    nameToVal name utc = AddressCreatedAt (toMilliSec utc) (Named name)
    namesToMap = foldr'
      (\ (key,name,utc) -> Map.insertWith (++) key [nameToVal name utc])
      Map.empty
  contractsAddresses <- blocQuery getContractsAddressesQuery
  contractsNamesAsAddresses <- blocQuery getContractsNamesAsAddressesQuery
  return . GetContractsResponse $
    addressesToMap contractsAddresses
    `Map.union`
    namesToMap contractsNamesAsAddresses

getContractsData :: ContractName -> Bloc [MaybeNamed Address]
getContractsData (ContractName contractName) = blocTransaction $ do
  addresses <- blocQuery $ getContractsDataAddressesQuery contractName
  names <- blocQuery $ getContractsDataNamesQuery contractName
  return $ map Unnamed addresses ++ map Named names

getContractsContract :: ContractName -> MaybeNamed Address -> Bloc ContractDetails
getContractsContract = getContractDetails

translateStorageMap :: [T.Storage] -> S.Storage
translateStorageMap storage' =
  let storageMap = Map.fromList $ map (\T.Storage{..} -> (unHex storageKey, unHex storageValue)) storage'
      storage k = fromMaybe 0 $ Map.lookup k storageMap
  in storage

getContractsState :: ContractName
                  -> MaybeNamed Address
                  -> [ChainId]
                  -> Maybe Text
                  -> Maybe Int
                  -> Maybe Int
                  -> Bool
                  -> Bloc [(ChainId, GetContractsStateResponses)] -- state-translation
getContractsState contract@(ContractName contractName) contractId chainIds mName mCount mOffset mLength = do
  forM chainIds $ \chainId -> do
    eitherErrorOrContract' <- toUserError
      (Text.pack $ "Couldn't find " ++ Text.unpack contractName ++ " with ID " ++ show contractId)
        $ xAbiToContract <$> getContractXabi contract contractId

    contract' <-
      either (throwError . UserError . Text.pack) return eitherErrorOrContract'

    address <- case contractId of
      Unnamed addr -> return addr
      Named "Latest" -> do
        metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
        blocQuery1 $ proc () -> do
          (_,cmId',addr,_) <-
            (limit 1 . orderBy (desc (\(_,_,_,time) -> time)))
              (queryTable contractsInstanceTable) -< ()
          restrict -< cmId' .== constant (metadataId::Int32)
          returnA -< addr
      Named somethingElse -> blocError $ UserError $
        "Expected address or \"Latest\": saw " <> somethingElse

    storage' <- case mName of
      Nothing -> blocStrato $ getStorage
        storageFilterParams{qsAddress = Just address}
      Just name ->
        let ranges = decodeStorageKey
                 (typeDefs contract')
                 (mainStruct contract')
                 [name]
                 0
                 mOffset
                 mCount
                 mLength
        in join <$> mapM (\(o, c) -> getStorageRange address (o, c) chainId) ranges

    let storage = translateStorageMap storage'

    ret <- case mName of
      Nothing ->
        let vals = decodeValues (typeDefs contract') (mainStruct contract') storage 0
            solVals = map (fmap valueToSolidityValue) vals
        in return solVals
      Just name ->
        let vals = decodeValuesFromList (typeDefs contract') (mainStruct contract') storage 0 mOffset mCount mLength [name]
            solVals = map (fmap valueToSolidityValue) vals
        in return solVals

    logWith logNotice $ Text.unlines
      [ "Storage:"
      , Text.pack $ unlines $ map (\Storage{..} -> "  " ++ show (unHex storageKey) ++ ":" ++ show storageValue) $ storage'
      , "End of storage"
      ]
    return $ (chainId, Map.fromList ret)
    where
      getStorageRange :: Address -> (Word256, Word256) -> ChainId -> Bloc [T.Storage]
      getStorageRange a (o,c) ci = do
        blocStrato $ getStorage
          storageFilterParams{ qsAddress = Just a
                             , qsMinKey = Just . fromInteger $ toInteger o
                             , qsMaxKey = Just . fromInteger $ toInteger (o + c - 1)
                             , qsChainId = Just ci
                             }

getContractsDetails :: Address -> Bloc ContractDetails
getContractsDetails contractAddress = do
  toUserError
    (Text.pack $ "Couldn't get contract details for address " ++ show contractAddress)
    (getContractDetailsByAddressOnly contractAddress >>= return . completeContractDetailXabi)

getContractsFunctions :: ContractName -> MaybeNamed Address -> Bloc [FunctionName]
getContractsFunctions (ContractName contractName) contractId = blocTransaction $ do
  metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
  funcs <- blocQuery $ getXabiFunctionNamesQuery metadataId
  return $ map FunctionName funcs

getContractsSymbols :: ContractName -> MaybeNamed Address -> Bloc [SymbolName]
getContractsSymbols (ContractName contractName) contractId = blocTransaction $ do
  metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
  vars <- blocQuery $ getXabiVariableNamesQuery metadataId
  return $ map SymbolName vars

getContractsEnum :: ContractName -> MaybeNamed Address -> EnumName -> Bloc [EnumValue]
getContractsEnum (ContractName contractName) contractId (EnumName enumName) =
  blocTransaction $ do
    metadataId <- case contractId of
      Named _ -> blocQuery1 $ getContractsMetaDataId contractName contractId
      Unnamed contractAddr -> getContractsMetaDataIdExhaustive contractName contractAddr
    map (EnumValue . fst) <$> getEnumValues metadataId enumName

getContractsStateMapping :: ContractName
                         -> MaybeNamed Address
                         -> SymbolName
                         -> Text
                         -> Bloc GetContractsStateMappingResponse
                         -- state-translation
getContractsStateMapping contract@(ContractName contractName) contractId (SymbolName mappingName) keyName = do
  eitherErrorOrContract <- xAbiToContract <$> getContractXabi contract contractId

  contract' <-
    either (throwError . UserError . Text.pack) return eitherErrorOrContract

  metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId

  address <- case contractId of
              Unnamed addr -> return addr
              Named "Latest" -> blocQuery1 $ proc () -> do
                (_,cmId,addr,_) <-
                  (limit 1 . orderBy (desc (\(_,_,_,time) -> time)))
                    (queryTable contractsInstanceTable) -< ()
                restrict -< cmId .== constant (metadataId::Int32)
                returnA -< addr
              Named somethingElse -> blocError $ UserError $
                                     "Expected address or \"Latest\": saw " <> somethingElse

  storage' <- blocStrato $ getStorage
    storageFilterParams{qsAddress = Just address}

  let storageMap = Map.fromList $ map (\T.Storage{..} -> (unHex storageKey, unHex storageValue)) storage'
      storage k = fromMaybe 0 $ Map.lookup k storageMap
      ret = valueToSolidityValue <$> decodeMapValue (typeDefs contract') (mainStruct contract') storage mappingName keyName

  logWith logNotice $ Text.unlines
    [ "Storage:"
    , Text.pack $ unlines $ map (\(k, v) -> "  " ++ show k ++ ":" ++ showHex v "") $ Map.toList storageMap
    , "End of storage"
    ]

  case ret of
   Left err -> throwError $ UserError $ Text.pack err
   Right val -> return $ Map.fromList [(mappingName, Map.fromList [(keyName, val)])]

getContractsStates :: ContractName -> Bloc [GetContractsStatesResponse] -- state-translation
getContractsStates _ = throwError $ Unimplemented "getContractsStates"

postContractsCompile :: [PostCompileRequest] -> Bloc [PostCompileResponse]
postContractsCompile = blocTransaction . fmap concat . traverse compileOneContract
  where
    compileOneContract PostCompileRequest{..} = do
      idsAndDetails <- compileContract postcompilerequestSource
      for (toList idsAndDetails) $ \ (_,details) -> do
        let eBlockappsjsXabi = completeXabi . contractdetailsXabi $ details
        case eBlockappsjsXabi of
          Left msg -> throwError $
            AnError (Text.append "Xabi conversion to Blockapps-js Xabi failed, "  (Text.pack msg))
          Right blockappsjsXabi ->
            void . blocCirrusFireForget $ postContract details{contractdetailsXabi=blockappsjsXabi}
        return $ PostCompileResponse (contractdetailsName details) (contractdetailsCodeHash details)

postContractsXabi :: PostXabiRequest -> Bloc PostXabiResponse
postContractsXabi PostXabiRequest{..} =
   let xabis :: Either String (Map.Map Text Xabi)
       xabis = do
         partialXabis <- Map.fromList <$> parseXabi "src" (Text.unpack postxabirequestSrc)
         traverse completeXabi partialXabis
   in case xabis of
        Left msg -> throwError . AnError .
            ("contract compilation for xabi failed: " <>) . Text.pack $msg
        Right xs -> return . PostXabiResponse $ xs


completeContractDetailXabi :: ContractDetails -> ContractDetails
completeContractDetailXabi cd =
  let eXabi = xAbiToContract $ contractdetailsXabi cd in
  case eXabi of
    Right xabi -> cd { contractdetailsXabi = contractToXabi xabi }
    Left _ -> cd


completeXabi :: Xabi -> Either String Xabi
completeXabi xabi = do
  c <- xAbiToContract xabi
  return $ contractToXabi c
