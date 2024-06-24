{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE Arrows #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Bloc.Server.Chain where

import API.Parametric
import Bloc.API.Chain
import Bloc.Database.Queries
import Bloc.Monad
import Bloc.Server.TransactionResult (constructArgValuesAndSource)
import Bloc.Server.Utils (getSigVals, maybeChainBatchResult, waitFor)
import BlockApps.Logging
import BlockApps.Solidity.XabiContract
import BlockApps.SolidityVarReader
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
-- import Blockchain.Data.Block
-- import Blockchain.Data.BlockHeader
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Data.TransactionResultStatus
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Keccak256
import Blockchain.TypeLits
import Control.Arrow ((***))
import Control.Lens (at, (?~))
import Control.Monad (join, unless, when)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Strato
import Control.Monad.Composable.Vault
import Crypto.Random.Entropy
import qualified Data.Map.Strict as Map
import Data.Maybe (catMaybes, fromMaybe, listToMaybe)
import Data.Source.Map
import Data.Text (Text)
import qualified Data.Text as Text
import GHC.Stack
import Handlers.Chain
import qualified Handlers.BlkLast as CORE
import qualified Handlers.Chain as CORE
import SQLM
import SolidVM.Model.CodeCollection.Contract hiding (errors)
import SolidVM.Model.CodeCollection.Function
import Strato.Strato23.API.Types
import Strato.Strato23.Client
import Text.Format
import UnliftIO

governanceAddress :: Address
governanceAddress = Address 0x100

-- TODO: use Value instead of ArgValue here
-- Will not bbe used anymore due to new Chain Member type
-- replaceMembers :: Struct
--                -> ChainMembers
--                -> Map.Map Text ArgValue
--                -> Map.Map Text ArgValue
-- replaceMembers Struct{..} cms m =
--   let tag = "__members__"
--       members = ArgArray . V.fromList $ map (ArgString . Text.pack) (map chainMemberParsedSetToString (S.toList $ unChainMembers cms))
--       m' = Map.alter (const $ Just members) tag m
--    in case OMap.lookup tag fields of
--         Nothing -> m'
--         Just (Left _, _) -> m
--         Just (_, ty) -> case ty of
--           TypeArrayDynamic (SimpleType TypeAccount) -> m'
--           _ -> m

createChainInfo ::
  ( A.Selectable Account AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    MonadIO m,
    MonadLogger m,
    HasVault m
  ) =>
  HeaderList ->
  Keccak256 ->
  ChainInput ->
  m ChainInfo
createChainInfo headers creationBlockHash (ChainInput src mCodePtr cname lbl balances chaininputArgs members pChains mmd _) = do
  when (null (unChainMembers members)) $ throwIO $ UserError "Private chains must include at least one member"
  when (sum (nmap2' balances) == 0) $ throwIO $ UserError "At least one account must have a non-zero balance"

  let md = fromMaybe Map.empty mmd
  mContract <-
    if src /= mempty
      then getContractDetailsForContract src cname
      else case mCodePtr of
        Just codePtr -> either (const Nothing) Just <$> getContractDetailsByCodeHash codePtr
        Nothing -> getContractDetailsForContract mempty cname
  (cAcctInfo, codeInfo, metaData) <- case mContract of
    Nothing -> return ([], [], md)
    Just (resolvedCodePtr, contract) -> do
      let balMap = Map.fromList $ map (unNamedTuple @"address" @"balance") balances
          govBal = fromMaybe 0 $ Map.lookup governanceAddress balMap

      let contractHash = fromMaybe resolvedCodePtr mCodePtr

      let contractAcctInfo = ContractWithStorage governanceAddress govBal contractHash []
          jsrc = serializeSourceMap src
          codeInfo' = [CodeInfo "" jsrc $ Just . Text.pack $ _contractName contract]
      md' <- do
        let f = sequence . ((Text.pack . fromMaybe "") *** indexedTypeToEvmIndexedType)
            xabiArgs = Map.fromList . catMaybes . maybe [] (map f . _funcArgs) $ _constructor contract
        (_, argsAsSource) <- constructArgValuesAndSource (Just chaininputArgs) xabiArgs
        pure $ (at "args" ?~ argsAsSource) md
      return ([contractAcctInfo], codeInfo', md') -- Perhaps in the future, we can support multiple contracts
  nonce <- byteStringToWord256 <$> liftIO (getEntropy 32)
  let maybeNonContract a b
        | a == governanceAddress = Nothing
        | otherwise = Just $ NonContract a b
      nonContractAcctInfo = catMaybes $ nmap maybeNonContract balances
      acctInfo = cAcctInfo ++ nonContractAcctInfo
      unsigned =
        ( UnsignedChainInfo
            lbl
            acctInfo
            codeInfo
            members
            pChains
            creationBlockHash
            nonce
            metaData
        )
      msgHash = keccak256ToByteString $ rlpHash unsigned
  let userName = getHeader "X-USER-ACCESS-TOKEN" headers
  sig <- blocVaultWrapper $ postSignature userName (MsgHash msgHash)
  let (r, s, v) = getSigVals sig
      chainInfo = ChainInfo unsigned (ChainSignature r s v)
  return chainInfo

withLastBlockHash ::
  (MonadIO m, MonadLogger m, HasStrato m, HasCallStack) =>
  (Keccak256 -> m b) ->
  m b
withLastBlockHash f = do
  maybeBlkHash <- getLastBlockHash
  case maybeBlkHash of
    Just blkHash -> f blkHash
    _ -> throwIO . UserError $ Text.pack "STRATO has not been initialized yet"

getLastBlockHash :: (MonadIO m, MonadLogger m, HasStrato m, HasCallStack) => m (Maybe Keccak256)
getLastBlockHash = do
  blk <- blocStrato $ CORE.getBlkLastClient 1
  case blk of
    (Block' _ _ : _) -> pure . Just $ unsafeCreateKeccak256FromWord256 0
    -- (Block' b _ : _) -> pure . Just . headerHash . blockBlockData $ b
    [] -> pure Nothing

postChainInfo ::
  ( A.Selectable Account AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    MonadLogger m,
    HasStrato m,
    HasVault m,
    MonadUnliftIO m,
    HasCallStack
  ) =>
  HeaderList ->
  ChainInput ->
  m ChainId
postChainInfo headers chainInput = withLastBlockHash $ \bHash -> do
      chainInfo' <- createChainInfo headers bHash chainInput
      chainId <- blocStrato $ CORE.postChainClient chainInfo'
      let isAsync = fromMaybe False $ chaininputAsync chainInput
      unless isAsync $ do
        info <- waitForChainInfo chainId
        case info of
          Nothing -> pure ()
          Just info' -> do
            let status = transactionResultStatus $ fst info'
            when (status /= Just Success) . throwIO . UserError . Text.pack $
              "Chain creation for " <> format (unChainId chainId) <> " failed: " <> show status
      pure chainId

postChainInfos ::
  ( A.Selectable Account AddressState m,
    HasCodeDB m,
    (Keccak256 `A.Selectable` SourceMap) m,
    MonadLogger m,
    MonadUnliftIO m,
    HasStrato m,
    HasVault m
  ) =>
  HeaderList ->
  [ChainInput] ->
  m [ChainId]
postChainInfos headers chainInputs = withLastBlockHash $ \bHash -> do
    chainInfos <- traverse (createChainInfo headers bHash) chainInputs
    chainIds <- blocStrato $ CORE.postChainsClient chainInfos
    let asyncInputs = fromMaybe False . chaininputAsync <$> chainInputs
        asyncChains = map snd . filter (not . fst) $ zip asyncInputs chainIds
    unless (null asyncChains) $ do
      infos <- waitForChainInfos asyncChains
      case infos of
        Nothing -> pure ()
        Just infos' -> do
          let infos'' = zip asyncChains infos'
          let errors = filter ((/= Just Success) . transactionResultStatus . fst . snd) infos''
          unless (null errors) . throwIO . UserError . Text.pack . unlines . flip map errors $
            \(cId, (txr, _)) -> "Chain creation for " <> format (unChainId cId) <> " failed: " <> show (transactionResultStatus txr)
    pure chainIds

waitForChainInfo ::
  ( MonadLogger m,
    HasStrato m,
    MonadUnliftIO m,
    HasCallStack
  ) =>
  ChainId ->
  m (Maybe (TransactionResult, Maybe ChainInfo))
waitForChainInfo chainId = do
  result <- waitForChainInfos [chainId]
  case result of
    Nothing -> do
      $logInfoS "waitForChainInfo" "Timed out!"
      return Nothing
    Just (x : _) -> return $ Just x
    Just [] -> return Nothing

waitForChainInfos ::
  ( MonadLogger m,
    MonadUnliftIO m,
    HasStrato m,
    HasCallStack
  ) =>
  [ChainId] ->
  m (Maybe [(TransactionResult, Maybe ChainInfo)])
waitForChainInfos chainIds = waitFor go
  where
    go = do
      infos <- catMaybes <$> maybeChainBatchResult chainIds
      $logInfoLS "waitForChainInfo/req" chainIds
      $logDebugLS "waitForChainInfo/resp" infos
      return (length infos == length chainIds, infos)

getSingleChainInfo ::
  ( MonadLogger m,
    MonadUnliftIO m,
    HasStrato m,
    HasCallStack
  ) =>
  ChainId ->
  m ChainIdChainOutput
getSingleChainInfo chainId = join $ maybe (liftIO . throwIO $ CouldNotFind "chain not found") pure . listToMaybe <$> getChainInfo [chainId] Nothing Nothing Nothing

getChainInfo ::
  ( MonadLogger m,
    MonadUnliftIO m,
    HasStrato m,
    HasCallStack
  ) =>
  [ChainId] ->
  Maybe Text ->
  Maybe Integer ->
  Maybe Integer ->
  m [ChainIdChainOutput]
getChainInfo chainIds mChainLabel lim off =
  --do
  (blocStrato $ getChainClient chainIds mChainLabel lim off) >>= (\chainIdChainInfos -> return $ map convertChainInfo chainIdChainInfos)
  where
    convertChainInfo :: NamedTuple "id" "info" ChainId ChainInfo -> ChainIdChainOutput
    convertChainInfo chp = do
      let chtup = unNamedTuple @"id" @"info" chp
      let chinfo = chainInfo $ snd chtup
      let getAddrBalance acct = case acct of
            NonContract a b -> (a, b)
            ContractNoStorage a b _ -> (a, b)
            ContractWithStorage a b _ _ -> (a, b)
            SolidVMContractWithStorage a b _ _ -> (a, b)
      let acctInfo = map (NamedTuple @"address" @"balance" . getAddrBalance) $ accountInfo chinfo
          mems = members chinfo
      NamedTuple (fst chtup, ChainOutput (chainLabel chinfo) acctInfo mems) :: ChainIdChainOutput
