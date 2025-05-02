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
import Bloc.Server.Utils (getBlockTimestamp)
import Bloc.XabiHelper
import BlockApps.Logging
import BlockApps.SolidVMStorageDecoder
import BlockApps.Solidity.Parse.Parser (parseXabi)
import BlockApps.Solidity.Xabi hiding (Func, Public, External)
import BlockApps.Storage as S
import BlockApps.XAbiConverter
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef
import Blockchain.Data.DataDefs
import Blockchain.Model.JsonBlock
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Arrow ((&&&))
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.SQL
import Data.Foldable
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.Source.Map (SourceMap)
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import Handlers.AccountInfo
import Handlers.Storage
import qualified MaybeNamed
import SQLM
import SolidVM.Model.CodeCollection.Contract
import UnliftIO

hexStorageToWord256 :: HexStorage -> Word256
hexStorageToWord256 (HexStorage bs) = bytesToWord256 bs

getContracts ::
  ( MonadLogger m,
    HasSQL m
  ) =>
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  Maybe ChainId ->
  m GetContractsResponse
getContracts mName mOffset mLimit chainId = do
  let addressToVal ts addr cid = AddressCreatedAt (round . utcTimeToPOSIXSeconds $ ts) addr cid
      addressesToMap =
        foldrM
          ( \(AddressStateRef' AddressStateRef {..} _) m -> do
              ts <- getBlockTimestamp addressStateRefLatestBlockDataRefNumber
              case addressStateRefContractName of
                Just n -> pure $ Map.insertWith (++) (Text.pack n) [addressToVal ts addressStateRefAddress chainId] m
                Nothing -> pure m
          )
          Map.empty
  addrStateRefs <-
    getAccount'
      accountsFilterParams
        { _qaChainId = maybeToList chainId,
          _qaExternal = Just False,
          _qaContractName = mName,
          _qaOffset = fromIntegral <$> mOffset,
          _qaLimit = fromIntegral <$> mLimit
        }
  reducedResponseMap <- addressesToMap addrStateRefs
  return . GetContractsResponse $ reducedResponseMap

getContractsData ::
  ( MonadLogger m,
    HasSQL m
  ) =>
  ContractName ->
  m [Address]
getContractsData (ContractName cName) = do
  svmRefs <-
    getAccount'
      accountsFilterParams
        { _qaContractName = Just cName,
          _qaIgnoreChain = Just True
        }
  return $ (\(AddressStateRef' r _) -> addressStateRefAddress r) <$> svmRefs

getContractsContract ::
  ( A.Selectable Address AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    HasSQL m
  ) =>
  ContractName ->
  Address ->
  Maybe ChainId ->
  m Contract
getContractsContract name addr chainId = do
  let err =
        UserError $
          Text.concat
            [ "getContractsContract: Couldn't find contract details for ",
              Text.pack $ show name,
              " at address ",
              Text.pack $ show addr,
              " on chain ",
              maybe "Main" (Text.pack . show) chainId
            ]
  mAddrStateRef <-
    listToMaybe
      <$> getAccount'
        accountsFilterParams
          { _qaChainId = maybeToList chainId,
            _qaAddress = Just addr,
            _qaExternal = Just False,
            _qaLimit = Just 1
          }
  case mAddrStateRef of
    Nothing -> throwIO err
    Just (AddressStateRef' a@AddressStateRef {} _) -> case addressStateRefCodePtr a of
      Nothing -> throwIO err
      Just cp ->
        getContractDetailsByCodeHash cp >>= \case
          Left e -> throwIO $ UserError e
          Right contract -> pure $ snd contract

-- Only for EVM, unimplemented for SolidVM
translateStorageMap :: [StorageAddress] -> S.Storage
translateStorageMap storage' =
  let storageMap = Map.fromList $ map (\StorageAddress {..} -> (hexStorageToWord256 key, hexStorageToWord256 value)) storage'

      storage k = fromMaybe 0 $ Map.lookup k storageMap
   in storage

getContractsState ::
  ( MonadIO m,
    MonadLogger m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasSQL m
  ) =>
  ContractName ->
  Address ->
  Maybe ChainId ->
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  Bool ->
  m GetContractsStateResponses -- state-translation
getContractsState _ address chainId mName mCount mOffset _ = do
  $logInfoS "getContractsState" . Text.pack $ "Getting contract state for " ++ formatAddressWithoutColor address
  -- contract' <- getContractsDetails' address chainId

  storage' <- case mName of
    Nothing ->
      getStorage'
        storageFilterParams
          { qsAddress = Just address,
            qsChainId = MaybeNamed.Unnamed <$> chainId,
            qsOffset = fromInteger <$> mOffset,
            qsLimit = fromInteger <$> mCount
          }
    Just _ -> pure []
  -- let storage = translateStorageMap storage'

  ret <- case (storage', mName) of
    (StorageAddress {kind = SolidVM} : _, Nothing) -> do
      $logInfoS "getContractsState/SolidVM" $
        Text.unlines
          [ "Storage:",
            Text.pack $ unlines $ map (\s -> ("  " ++) . show $ (kind s, key s, value s)) $ storage',
            "End of storage"
          ]
      return $ decodeSolidVMValues $ map (key &&& value) storage'
    (StorageAddress {kind = SolidVM} : _, Just name) ->
      error $ "unimplemented: range based solidVM queries" ++ Text.unpack name
    ([], Nothing) -> return []
    _ ->
      error $ "EVM contract state indexing no longer supported"
  $logDebugS "getContractsState/storage" $
    Text.unlines
      [ "Storage:",
        Text.pack $ unlines $ map (\s -> ("  " ++) $ show (kind s, key s, value s)) $ storage',
        "End of storage"
      ]
  return $ Map.fromList ret

-- where
--   getStorageRange :: (MonadIO m, MonadLogger m) =>
--                      Address -> (Word256, Word256) -> m [StorageAddress]
--   getStorageRange a (o,c) = getStorage'
--       storageFilterParams{ qsAddress = Just a
--                          , qsMinKey = Just . word256ToHexStorage . fromInteger $ toInteger o
--                          , qsMaxKey = Just . word256ToHexStorage . fromInteger $ toInteger (o + c - 1)
--                          , qsChainId = MaybeNamed.Unnamed <$> chainId
--                          }

postContractsBatchStates ::
  ( MonadIO m,
    MonadLogger m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    HasSQL m
  ) =>
  [PostContractsBatchStatesRequest] ->
  m [GetContractsStateResponses]
postContractsBatchStates = traverse flattenRequest
  where
    flattenRequest PostContractsBatchStatesRequest {..} =
      getContractsState
        postcontractsbatchstatesrequestContractName
        postcontractsbatchstatesrequestAddress
        postcontractsbatchstatesrequestChainid
        postcontractsbatchstatesrequestVarName
        postcontractsbatchstatesrequestCount
        postcontractsbatchstatesrequestOffset
        (fromMaybe False postcontractsbatchstatesrequestLength)

getContractsDetails' ::
  ( A.Selectable Address AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    HasSQL m
  ) =>
  Address ->
  Maybe ChainId ->
  m Contract
getContractsDetails' contractAddress chainId = do
  let err =
        UserError $
          Text.concat
            [ "getContractsDetails': couldn't find contract details for address ",
              Text.pack $ formatAddressWithoutColor contractAddress,
              " on chain ",
              maybe "Main" (Text.pack . show) chainId
            ]
  mAddrStateRef <-
    listToMaybe
      <$> getAccount'
        accountsFilterParams
          { _qaChainId = maybeToList chainId,
            _qaAddress = Just contractAddress,
            _qaExternal = Just False,
            _qaLimit = Just 1
          }
  case mAddrStateRef of
    Nothing -> throwIO err
    Just (AddressStateRef' a@AddressStateRef {} _) -> case addressStateRefCodePtr a of
      Nothing -> throwIO err
      Just cp ->
        getContractDetailsByCodeHash cp >>= \case
          Left e -> throwIO $ UserError e
          Right contract -> pure $ snd contract

getContractsDetails ::
  ( A.Selectable Address AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    HasSQL m
  ) =>
  Address ->
  Maybe ChainId ->
  m Contract
getContractsDetails = getContractsDetails'

getContractsFunctions ::
  ( A.Selectable Address AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    HasSQL m
  ) =>
  ContractName ->
  Address ->
  Maybe ChainId ->
  m [FunctionName]
getContractsFunctions _ contractId chainId = do
  contract <- getContractsDetails contractId chainId
  pure . map (FunctionName . Text.pack) . Map.keys $ _functions contract

getContractsSymbols ::
  ( A.Selectable Address AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    HasSQL m
  ) =>
  ContractName ->
  Address ->
  Maybe ChainId ->
  m [SymbolName]
getContractsSymbols _ contractId chainId = do
  contract <- getContractsDetails contractId chainId
  pure . map (SymbolName . Text.pack) . Map.keys $ _storageDefs contract

getContractsEnum ::
  ( A.Selectable Address AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    HasSQL m
  ) =>
  ContractName ->
  Address ->
  EnumName ->
  Maybe ChainId ->
  m [EnumValue]
getContractsEnum _ contractId (EnumName enumName) chainId = do
  contract <- getContractsDetails contractId chainId
  pure . maybe [] (map (EnumValue . Text.pack) . fst) . Map.lookup (Text.unpack enumName) $ _enums contract

getContractsStateMapping :: -- ( A.Selectable Account AddressState m
-- , (Keccak256 `A.Selectable` SourceMap) m
-- , MonadLogger m
-- , HasSQL m
-- , HasBlocEnv m
-- )
  Monad m =>
  ContractName ->
  Address ->
  SymbolName ->
  Text ->
  Maybe ChainId ->
  m GetContractsStateMappingResponse
-- state-translation
getContractsStateMapping _ _ _ _ _ =
  -- address (SymbolName mappingName) keyName chainId = do
  -- contract' <- getContractsDetails address chainId

  -- storage' <- getStorage'
  --   storageFilterParams{qsAddress = Just address}

  -- fetchLimit <- fromInteger <$> fmap stateFetchLimit getBlocEnv

  -- let storageMap = Map.fromList $ map (\s -> case kind s of
  --       EVM -> (hexStorageToWord256 $ key s, hexStorageToWord256 $ value s)
  --       SolidVM -> error "unimplemented: getContractsStateMapping for SolidVM") storage'
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
      eContract <- sourceToContractDetails postcompilerequestSource
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

getSourceMapFromAddress :: 
  ( MonadIO m,
    (Keccak256 `A.Selectable` SourceMap) m, 
    (Address `A.Selectable` AddressState) m
  ) => Address -> m SourceMap
getSourceMapFromAddress cptr = do
  addressState <- A.select (A.Proxy @AddressState) cptr
  mCodeHash <- case addressState of
    Nothing -> throwIO $ UserError "Could not find code hash for contract"
    Just as -> return $ addressStateCodeHash as
  keccak <- case mCodeHash of
    SolidVMCode _ k -> pure k
    _ -> throwIO $ UserError "Could not find code hash for contract"
  sourcy <- A.select (A.Proxy @SourceMap) keccak
  case sourcy of
    Nothing -> throwIO $ UserError "Could not find source map for contract"
    Just sm -> pure sm
