{-# LANGUAGE Arrows #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Bloc.Server.Contracts where

import Bloc.API.Contracts
import Bloc.API.Utils
import Bloc.Database.Queries
import Bloc.XabiHelper
import BlockApps.Logging
import BlockApps.SolidVMStorageDecoder
import BlockApps.Solidity.Parse.Parser (parseXabi)
import BlockApps.Solidity.Value
import BlockApps.Solidity.Xabi hiding (Func, Public, External)
import BlockApps.Solidity.Xabi.Type (indexedTypeType)
import BlockApps.Solidity.XabiContract
import BlockApps.SolidityVarReader
import BlockApps.XAbiConverter
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.DataDefs
import Blockchain.Model.JsonBlock
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.Arrow ((&&&), (***))
import Control.Monad ((<=<))
import qualified Control.Monad.Change.Alter as A
import Data.Bifunctor (first)
import Data.Foldable
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.Source.Map (SourceMap)
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Time
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import Data.List (sort)
import Handlers.AccountInfo
import Handlers.Storage
import SQLM
import SolidVM.Model.CodeCollection.Contract
import SolidVM.Model.CodeCollection.Function
import UnliftIO

getContracts ::
  ( MonadIO m,
    A.Selectable AccountsFilterParams [AddressStateRef] m -- ,
  ) =>
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  m GetContractsResponse
getContracts mName mOffset mLimit = do
  let addressToVal ts addr = AddressCreatedAt (round . utcTimeToPOSIXSeconds $ ts) addr
      addressesToMap =
        foldrM
          ( \(AddressStateRef' AddressStateRef {..} _) m -> case addressStateRefContractName of
              Nothing -> pure m
              Just n -> do
                ts <- liftIO getCurrentTime
                pure $ Map.insertWith (++) (Text.pack n) [addressToVal ts addressStateRefAddress] m
          )
          Map.empty

  -- Step 1: Get all unique contract names (without pagination)
  let contractLimit = fromIntegral $ fromMaybe 10 mLimit
      contractOffset = fromIntegral $ fromMaybe 0 mOffset

  -- Get all records to extract unique contract names
  allAddrStateRefs <-
    getAccount'
      accountsFilterParams
        { _qaExternal = Just False,
          _qaSearch = mName,
          _qaOffset = Nothing,  -- No offset - get all records
          _qaLimit = Nothing    -- No limit - get all records
        }

  -- Group by contract name to get unique contracts
  allContractsMap <- addressesToMap allAddrStateRefs
  let allContractNames = Map.keys allContractsMap
      sortedContractNames = sort allContractNames

  -- Apply pagination to contract names (exactly 10 contracts per page)
  let paginatedContractNames = take contractLimit $ drop contractOffset sortedContractNames

  -- Step 2: Get all instances for the paginated contract names
  -- Filter the original map to only include the paginated contracts
  let paginatedContractsMap = Map.filterWithKey (\k _ -> k `elem` paginatedContractNames) allContractsMap

  return . GetContractsResponse $ paginatedContractsMap

getContractsData ::
  ( MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m
  ) =>
  ContractName ->
  m [Address]
getContractsData (ContractName cName) = do
  svmRefs <-
    getAccount'
      accountsFilterParams
        { _qaContractName = Just cName
        }
  return $ (\(AddressStateRef' r _) -> addressStateRefAddress r) <$> svmRefs

getContractsContract ::
  ( MonadIO m,
    A.Selectable Address AddressState m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  ContractName ->
  Address ->
  m Contract
getContractsContract name addr = do
  let err =
        UserError $
          Text.concat
            [ "getContractsContract: Couldn't find contract details for ",
              Text.pack $ show name,
              " at address ",
              Text.pack $ show addr
            ]
      aParams = accountsFilterParams
          { _qaAddress = Just addr,
            _qaExternal = Just False,
            _qaLimit = Just 1
          }
  getContractByAccountsFilterParams aParams Nothing >>= \case
    Nothing -> throwIO err
    Just contract -> pure contract

getContractsState ::
  ( MonadIO m,
    MonadLogger m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable Address AddressState m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  ContractName ->
  Address ->
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  Bool ->
  m GetContractsStateResponses -- state-translation
getContractsState _ address mName mCount mOffset _ = do
  $logInfoS "getContractsState" . Text.pack $ "Getting contract state for " ++ formatAddressWithoutColor address
  contract' <- getContractsDetails' address

  storage' <- case mName of
    Nothing ->
      getStorage'
        storageFilterParams
          { qsAddress = Just address,
            qsOffset = fromInteger <$> mOffset,
            qsLimit = fromInteger <$> mCount
          }
    Just _ -> pure []

  let contractFuncs Contract {..} = catMaybes . map (traverse getFunction) $ Map.toList _functions
      convertType = (either (const Nothing) Just . xabiTypeToType . indexedTypeType) <=< indexedTypeToEvmIndexedType
      getFunction Func {..} =
        if isNothing _funcVisibility || _funcVisibility == Just Public || _funcVisibility == Just External
          then
            let args = catMaybes $ sequence . (maybe "" Text.pack *** convertType) <$> _funcArgs
                ret = catMaybes $ sequence . (fmap Text.pack *** convertType) <$> _funcVals
             in Just . valueToSolidityValue $ ValueFunction "dead" args ret
          else Nothing

  ret <- case (storage', mName) of
    (StorageAddress {} : _, Nothing) -> do
      $logInfoS "getContractsState/SolidVM" $
        Text.unlines
          [ "Storage:",
            Text.pack $ unlines $ map (\s -> ("  " ++) . show $ (key s, value s)) $ storage',
            "End of storage"
          ]
      return $ case (decodeSolidVMValues $ map (key &&& value) storage') of
        Left err -> error $ Text.unpack err
        Right vals -> (first Text.pack <$> contractFuncs contract') ++ vals
    (StorageAddress {} : _, Just name) ->
      error $ "unimplemented: range based solidVM queries" ++ Text.unpack name
    ([], Nothing) -> return $ (first Text.pack <$> contractFuncs contract')
    _ ->
      error $ "EVM contract state indexing no longer supported"
  $logDebugS "getContractsState/storage" $
    Text.unlines
      [ "Storage:",
        Text.pack $ unlines $ map (\s -> ("  " ++) $ show (key s, value s)) $ storage',
        "End of storage"
      ]
  return $ Map.fromList ret

postContractsBatchStates ::
  ( MonadIO m,
    MonadLogger m,
    A.Selectable Address AddressState m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  [PostContractsBatchStatesRequest] ->
  m [GetContractsStateResponses]
postContractsBatchStates = traverse flattenRequest
  where
    flattenRequest PostContractsBatchStatesRequest {..} =
      getContractsState
        postcontractsbatchstatesrequestContractName
        postcontractsbatchstatesrequestAddress
        postcontractsbatchstatesrequestVarName
        postcontractsbatchstatesrequestCount
        postcontractsbatchstatesrequestOffset
        (fromMaybe False postcontractsbatchstatesrequestLength)

getContractsDetails' ::
  ( MonadIO m,
    A.Selectable Address AddressState m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  Address ->
  m Contract
getContractsDetails' contractAddress = do
  let err =
        UserError $
          Text.concat
            [ "getContractsDetails': couldn't find contract details for address ",
              Text.pack $ formatAddressWithoutColor contractAddress
            ]
      aParams = accountsFilterParams
          { _qaAddress = Just contractAddress,
            _qaExternal = Just False,
            _qaLimit = Just 1
          }
  getContractByAccountsFilterParams aParams Nothing >>= \case
    Nothing -> throwIO err
    Just contract -> pure contract

getContractsDetails ::
  ( MonadIO m,
    A.Selectable Address AddressState m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  Address ->
  m Contract
getContractsDetails = getContractsDetails'

getContractsFunctions ::
  ( MonadIO m,
    A.Selectable Address AddressState m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  ContractName ->
  Address ->
  m [FunctionName]
getContractsFunctions _ contractId = do
  contract <- getContractsDetails contractId
  pure . map (FunctionName . Text.pack) . Map.keys $ _functions contract

getContractsSymbols ::
  ( MonadIO m,
    A.Selectable Address AddressState m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  ContractName ->
  Address ->
  m [SymbolName]
getContractsSymbols _ contractId = do
  contract <- getContractsDetails contractId
  pure . map (SymbolName . Text.pack) . Map.keys $ _storageDefs contract

getContractsEnum ::
  ( MonadIO m,
    A.Selectable Address AddressState m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  ContractName ->
  Address ->
  EnumName ->
  m [EnumValue]
getContractsEnum _ contractId (EnumName enumName) = do
  contract <- getContractsDetails contractId
  pure . maybe [] (map (EnumValue . Text.pack) . fst) . Map.lookup (Text.unpack enumName) $ _enums contract

getContractsStateMapping :: -- ( A.Selectable Account AddressState m
-- , (Keccak256 `A.Selectable` SourceMap) m
-- , MonadLogger m
-- , HasBlocEnv m
-- )
  Monad m =>
  ContractName ->
  Address ->
  SymbolName ->
  Text ->
  m GetContractsStateMappingResponse
-- state-translation
getContractsStateMapping _ _ _ _ =
  -- address (SymbolName mappingName) keyName = do
  -- contract' <- getContractsDetails address

  -- storage' <- getStorage'
  --   storageFilterParams{qsAddress = Just address}

  -- fetchLimit <- fromInteger <$> fmap stateFetchLimit getBlocEnv

  -- let storageMap = Map.fromList $ map (\_ -> error "unimplemented: getContractsStateMapping for SolidVM") storage'
  --     storage k = fromMaybe 0 $ Map.lookup k storageMap
  --     ret = valueToSolidityValue <$> decodeMapValue fetchLimit (typeDefs contract') (mainStruct contract') storage mappingName keyName

  -- logDebugS "getContractsStateMapping/storage" $ Text.unlines
  --  [ "Storage:"
  --  , Text.pack $ unlines $ map (\(k, v) -> "  " ++ show k ++ ":" ++ showHex v "") $ Map.toList storageMap
  --  , "End of storage"
  --  ]

  -- case ret of
  --  Left e -> throwIO . UserError $ Text.pack e
  --  Right val -> return $ fromList [(mappingName, Map.fromList [(keyName, val)])]
  return Map.empty

getContractsStates ::
  MonadIO m =>
  ContractName ->
  m [GetContractsStatesResponse] -- state-translation
getContractsStates _ = throwIO $ Unimplemented "getContractsStates"

postContractsCompile ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  [PostCompileRequest] ->
  m [PostCompileResponse]
postContractsCompile = traverse compileOneContract
  where
    compileOneContract PostCompileRequest {..} = do
      eContract <- sourceToContractDetails True postcompilerequestSource
      case eContract of
        Left anns -> throwIO . UserError . Text.pack $ show anns
        Right (srcHash, _) -> pure $ PostCompileResponse (fromMaybe "" postcompilerequestContractName) srcHash

postContractsXabi ::
  MonadIO m =>
  PostXabiRequest ->
  m PostXabiResponse
postContractsXabi PostXabiRequest {..} =
  let xabis :: Either String (Map.Map Text Xabi)
      xabis = do
        let oldXabi = parseXabi "src" (Text.unpack postxabirequestSrc)
        partialXabis <- Map.fromList . snd <$> (case oldXabi of Left _ -> parseSolidXabi "src" (Text.unpack postxabirequestSrc); _ -> oldXabi)
        Map.traverseWithKey completeXabi partialXabis
   in case xabis of
        Left msg ->
          throwIO . UserError
            . ("contract compilation for xabi failed: " <>)
            $ Text.pack msg
        Right xs -> return . PostXabiResponse $ xs

completeXabi :: Text -> Xabi -> Either String Xabi
completeXabi name xabi = do
  c <- xAbiToContract xabi
  return $ contractToXabi name c
