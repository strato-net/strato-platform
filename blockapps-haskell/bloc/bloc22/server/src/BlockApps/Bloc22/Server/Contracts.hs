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
import           Network.Haskoin.Crypto                  (Word256)
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
--import           BlockApps.Cirrus.Client
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
    addressToVal addr utc cid = AddressCreatedAt (toMilliSec utc) (Unnamed addr) cid
    addressesToMap = foldr'
      (\ (key,addr,utc,cid) -> Map.insertWith (++) key [addressToVal addr utc cid])
      Map.empty
    nameToVal name utc cid = AddressCreatedAt (toMilliSec utc) (Named name) cid
    namesToMap = foldr'
      (\ (key,name,utc,cid) -> Map.insertWith (++) key [nameToVal name utc cid])
      Map.empty
  contractsAddresses <- blocQuery getContractsAddressesQuery
  contractsNamesAsAddresses <- blocQuery getContractsNamesAsAddressesQuery
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
getContractsContract name addr = getContractDetails name addr

translateStorageMap :: [T.Storage] -> S.Storage
translateStorageMap storage' =
  let storageMap = Map.fromList $ map (\T.Storage{..} -> (unHex storageKey, unHex storageValue)) storage'
      storage k = fromMaybe 0 $ Map.lookup k storageMap
  in storage

getContractsState :: ContractName
                  -> MaybeNamed Address
                  -> Maybe ChainId
                  -> Maybe Text
                  -> Maybe Int
                  -> Maybe Int
                  -> Bool
                  -> Bloc GetContractsStateResponses -- state-translation
getContractsState contract@(ContractName contractName) contractId chainId mName mCount mOffset mLength = do
  eitherErrorOrContract' <- toUserError
    (Text.pack $ "Couldn't find " ++ Text.unpack contractName ++ " with ID " ++ show contractId)
      $ xAbiToContract <$> getContractXabi contract contractId chainId

  contract' <-
    either (throwError . UserError . Text.pack) return eitherErrorOrContract'

  address <- case contractId of
    Unnamed addr -> return addr
    Named "Latest" -> do
      metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId chainId
      blocQuery1 $ proc () -> do
        (_,cmId',addr,_,_) <-
          (limit 1 . orderBy (desc (\(_,_,_,time,_) -> time)))
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
      in join <$> mapM (getStorageRange address) ranges

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
  return $ Map.fromList ret
  where
    getStorageRange :: Address -> (Word256, Word256) -> Bloc [T.Storage]
    getStorageRange a (o,c) = do
      blocStrato $ getStorage
        storageFilterParams{ qsAddress = Just a
                           , qsMinKey = Just . fromInteger $ toInteger o
                           , qsMaxKey = Just . fromInteger $ toInteger (o + c - 1)
                           , qsChainId = chainId
                           }

getContractsDetails :: Address -> Maybe ChainId -> Bloc ContractDetails
getContractsDetails contractAddress chainId = do
  toUserError
    (Text.pack $ "Couldn't get contract details for address " ++ show contractAddress)
    (getContractDetailsByAddressOnly contractAddress chainId >>= return . completeContractDetailXabi)

getContractsFunctions :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc [FunctionName]
getContractsFunctions (ContractName contractName) contractId chainId = blocTransaction $ do
  metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId chainId
  funcs <- blocQuery $ getXabiFunctionNamesQuery metadataId
  return $ map FunctionName funcs

getContractsSymbols :: ContractName -> MaybeNamed Address -> Maybe ChainId -> Bloc [SymbolName]
getContractsSymbols (ContractName contractName) contractId chainId = blocTransaction $ do
  metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId chainId
  vars <- blocQuery $ getXabiVariableNamesQuery metadataId
  return $ map SymbolName vars

getContractsEnum :: ContractName -> MaybeNamed Address -> EnumName -> Maybe ChainId -> Bloc [EnumValue]
getContractsEnum (ContractName contractName) contractId (EnumName enumName) chainId =
  blocTransaction $ do
    metadataId <- case contractId of
      Named _ -> blocQuery1 $ getContractsMetaDataId contractName contractId chainId
      Unnamed contractAddr -> getContractsMetaDataIdExhaustive contractName contractAddr chainId
    map (EnumValue . fst) <$> getEnumValues metadataId enumName

getContractsStateMapping :: ContractName
                         -> MaybeNamed Address
                         -> SymbolName
                         -> Text
                         -> Maybe ChainId
                         -> Bloc GetContractsStateMappingResponse
                         -- state-translation
getContractsStateMapping contract@(ContractName contractName) contractId (SymbolName mappingName) keyName chainId = do
  eitherErrorOrContract <- xAbiToContract <$> getContractXabi contract contractId chainId

  contract' <-
    either (throwError . UserError . Text.pack) return eitherErrorOrContract

  metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId chainId

  address <- case contractId of
              Unnamed addr -> return addr
              Named "Latest" -> blocQuery1 $ proc () -> do
                (_,cmId,addr,_,_) <-
                  (limit 1 . orderBy (desc (\(_,_,_,time,_) -> time)))
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
          Right _ ->
            return $ PostCompileResponse (contractdetailsName details) (contractdetailsCodeHash details)
        --return $ PostCompileResponse (contractdetailsName details) (contractdetailsCodeHash details)

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
