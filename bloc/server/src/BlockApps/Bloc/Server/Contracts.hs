{-# LANGUAGE
    Arrows
  , OverloadedStrings
  , RecordWildCards
  , ScopedTypeVariables
  , TupleSections
#-}

module BlockApps.Bloc.Server.Contracts where

import Control.Arrow
import Control.Monad.Except
import Control.Monad.Log
import Data.Foldable
import Data.Int
import Data.Maybe
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import Data.Traversable
import qualified Data.Text as Text
import Data.Time.Clock.POSIX
import Numeric
import Opaleye

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.API.Contracts
import BlockApps.Bloc.Database.Queries
import BlockApps.Bloc.Database.Tables
import BlockApps.Bloc.Monad
import BlockApps.Cirrus.Client
import BlockApps.Ethereum
import BlockApps.Solidity.Contract
import BlockApps.SolidityVarReader
import BlockApps.Solidity.Xabi
import BlockApps.Strato.Client
import BlockApps.Strato.Types
import BlockApps.XAbiConverter

class Monad m => MonadContracts m where
  getContracts :: m GetContractsResponse
  getContractsData :: ContractName -> m [MaybeNamed Address]
  getContractsContract :: ContractName -> MaybeNamed Address -> m ContractDetails
  getContractsState :: ContractName -> MaybeNamed Address -> m GetContractsStateResponses -- state-translation
  getContractsFunctions :: ContractName -> MaybeNamed Address -> m [FunctionName]
  getContractsSymbols :: ContractName -> MaybeNamed Address -> m [SymbolName]
  getContractsStateMapping :: ContractName -> MaybeNamed Address -> SymbolName -> Text -> m GetContractsStateMappingResponse -- state-translation
  getContractsStates :: ContractName -> m [GetContractsStatesResponse] -- state-translation
  postContractsCompile :: [PostCompileRequest] -> m [PostCompileResponse]

instance MonadContracts Bloc where
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

  getContractsData (ContractName contractName) = blocTransaction $ do
    addresses <- blocQuery $ getContractsDataAddressesQuery contractName
    names <- blocQuery $ getContractsDataNamesQuery contractName
    return $ map Unnamed addresses ++ map Named names

  getContractsContract = getContractDetails

  getContractsState contract@(ContractName contractName) contractId = do
    contract' <- xAbiToContract <$> getContractXabi contract contractId

    metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId

    address <- blocQuery1 $ proc () -> do
      (_,cmId,addr,_) <- queryTable contractsInstanceTable -< ()
      restrict -< cmId .== constant (metadataId::Int32)
      returnA -< addr

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

  getContractsFunctions (ContractName contractName) contractId = blocTransaction $ do
    metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
    funcs <- blocQuery $ getXabiFunctionNamesQuery metadataId
    return $ map FunctionName funcs

  getContractsSymbols (ContractName contractName) contractId = blocTransaction $ do
    metadataId <- blocQuery1 $ getContractsMetaDataId contractName contractId
    vars <- blocQuery $ getXabiVariableNamesQuery metadataId
    return $ map SymbolName vars

  getContractsStateMapping _ _ _ _ = throwError $ Unimplemented "getContractsStateMapping"

  getContractsStates _ = throwError $ Unimplemented "getContractsStates"

  postContractsCompile = blocTransaction . fmap concat . traverse compileOneContract
    where
      compileOneContract PostCompileRequest{..} = do
        idsAndDetails <- compileContract postcompilerequestSource
        for_ postcompilerequestSearchable $ \ contractName -> do
          contractDetails <-
            getContractsContract (ContractName contractName) (Named "Latest")
          blocCirrus $ postContract contractDetails
        for (toList idsAndDetails) $ \ (_,ContractDetails{..}) ->
          return $ PostCompileResponse contractdetailsName contractdetailsCodeHash
