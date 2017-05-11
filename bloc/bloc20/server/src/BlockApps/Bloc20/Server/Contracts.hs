{-# LANGUAGE Arrows              #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}

module BlockApps.Bloc20.Server.Contracts where

import           Control.Arrow
import           Control.Monad.Except
import           Control.Monad.Log
import           Data.Foldable
import           Data.Int
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Monoid
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import           Data.Time.Clock.POSIX
import           Data.Traversable
import           Numeric
import           Opaleye

import           BlockApps.Bloc20.API.Contracts
import           BlockApps.Bloc20.API.Utils
import           BlockApps.Bloc20.Database.Queries
import           BlockApps.Bloc20.Database.Tables
import           BlockApps.Bloc20.Monad
import           BlockApps.Cirrus.Client
import           BlockApps.Ethereum
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Xabi
import           BlockApps.SolidityVarReader
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types
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

getContractsState :: ContractName -> MaybeNamed Address -> Bloc GetContractsStateResponses -- state-translation
getContractsState contract@(ContractName contractName) contractId = do
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

  storage' <- blocStrato $ getStorage $ Just address

  let storageMap = Map.fromList $ map (\Storage{..} -> (unHex storageKey, unHex storageValue)) storage'
      storage k = fromMaybe 0 $ Map.lookup k storageMap


      ret = map (fmap valueToSolidityValue) $ decodeValues (typeDefs contract') (mainStruct contract') storage 0

  logWith logNotice $ Text.unlines
    [ "Storage:"
    , Text.pack $ unlines $ map (\(k, v) -> "  " ++ show k ++ ":" ++ showHex v "") $ Map.toList storageMap
    , "End of storage"
    ]

  return $ Map.fromList ret

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

getContractsStateMapping :: ContractName -> MaybeNamed Address -> SymbolName -> Text -> Bloc GetContractsStateMappingResponse -- state-translation
getContractsStateMapping _ _ _ _ = throwError $ Unimplemented "getContractsStateMapping"

getContractsStates :: ContractName -> Bloc [GetContractsStatesResponse] -- state-translation
getContractsStates _ = throwError $ Unimplemented "getContractsStates"

postContractsCompile :: [PostCompileRequest] -> Bloc [PostCompileResponse]
postContractsCompile = blocTransaction . fmap concat . traverse compileOneContract
  where
    compileOneContract PostCompileRequest{..} = do
      idsAndDetails <- compileContract postcompilerequestSource
      for_ (fromMaybe [] postcompilerequestSearchable) $ \ contractName -> do
        contractDetails <-
          getContractsContract (ContractName contractName) (Named "Latest")
        blocCirrus $ postContract contractDetails
      for (toList idsAndDetails) $ \ (_,ContractDetails{..}) ->
        return $ PostCompileResponse contractdetailsName contractdetailsCodeHash
