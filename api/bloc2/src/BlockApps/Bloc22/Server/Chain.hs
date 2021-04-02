{-# LANGUAGE Arrows              #-}
{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeFamilies        #-}

module BlockApps.Bloc22.Server.Chain where

import           Control.Applicative               (liftA2)
import           Control.Lens                      ((?~), at)
import           Control.Monad                     (when, unless)
import           Crypto.Random.Entropy
import qualified Data.Aeson                        as Aeson
import qualified Data.ByteString.Base16            as B16
import qualified Data.ByteString.Lazy              as BL
import           Data.Foldable                     (for_)
import           Data.Int                          (Int32)
import qualified Data.Map.Ordered                  as OMap
import qualified Data.Map.Strict                   as Map
import           Data.Maybe                        (catMaybes, fromMaybe)
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import           Data.Text.Encoding                (decodeUtf8, encodeUtf8)
import qualified Data.Vector                       as V

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.Monad
import           BlockApps.Logging
import           BlockApps.SolidityVarReader
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Xabi
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Server.Users     (constructArgValuesAndSource)
import           BlockApps.Bloc22.Server.Utils     (waitFor)
import           BlockApps.XAbiConverter           (xAbiToContract)

import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Json
import           Blockchain.TypeLits
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class     (blockHash)
import           Blockchain.Strato.Model.Keccak256
import           Control.Monad.Change.Alter
import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.CoreAPI
import           Control.Monad.Composable.SQL
import           Handlers.BlkLast
import           Handlers.Chain
import           SQLM

import           UnliftIO

import qualified Handlers.Chain as CORE

governanceAddress :: Address
governanceAddress = Address 0x100

-- TODO: use Value instead of ArgValue here
replaceMembers :: Struct
               -> [Address]
               -> Map.Map Text ArgValue
               -> Map.Map Text ArgValue
replaceMembers Struct{..} addrs m =
  let tag = "__members__"
      members = ArgArray . V.fromList $ map (ArgString . Text.pack . formatAddressWithoutColor) addrs
      m' = Map.alter (const $ Just members) tag m
   in case OMap.lookup tag fields of
        Nothing -> m'
        Just (Left _, _) -> m
        Just (_, ty) -> case ty of
          TypeArrayDynamic (SimpleType TypeAccount) -> m'
          _ -> m

createChainInfo :: (MonadIO m, MonadLogger m, HasBlocSQL m, HasBlocEnv m) =>
                   Keccak256 -> ChainInput -> m (Maybe Int32, ChainInfo)
createChainInfo creationBlockHash (ChainInput src mCodePtr cname lbl balances chaininputArgs members pChain mmd _) = do
  when (null members) $ throwIO $ UserError "Private chains must include at least one member"
  when (sum (nmap2' balances) == 0) $ throwIO $ UserError "At least one account must have a non-zero balance"

  let md = fromMaybe Map.empty mmd
      theVM = fromMaybe "EVM" $ Map.lookup "VM" md
  mContract <- case src of
    (_:_) -> fmap snd <$> getContractDetailsForContract theVM src cname
    _ -> case mCodePtr of
      Just codePtr -> getContractDetailsByCodeHash codePtr
      Nothing -> fmap snd <$> getContractDetailsForContract theVM [] cname
  (cAcctInfo, codeInfo, metaData) <- case mContract of
      Nothing -> return ([],[], md)
      Just (_, ContractDetails{..}) -> do
          contract <- either (throwIO . UserError . Text.pack) return $ xAbiToContract contractdetailsXabi
          let argValues = replaceMembers
                            (mainStruct contract)
                            (nmap1' members)
                            chaininputArgs
          storage <- case theVM of
            "EVM" -> fmap Map.toList . either (throwIO . UserError) return $ encodeValues
                       (typeDefs contract)
                       (mainStruct contract)
                       0
                       (Map.toList argValues)
            _ -> pure []
          let balMap = Map.fromList $ map (unNamedTuple @"address" @"balance") balances
              govBal = fromMaybe 0 $ Map.lookup governanceAddress balMap

          (contractHash, b) <-
            case theVM of
              "EVM" -> return (fromMaybe contractdetailsCodeHash mCodePtr, contractdetailsBinRuntime)
              "SolidVM" -> do
                return (fromMaybe contractdetailsCodeHash mCodePtr, "")
              _ -> throwIO . UserError . Text.pack $ "Unknown VM: " ++ show theVM

          let contractAcctInfo = ContractWithStorage governanceAddress govBal contractHash storage
              b' = fst . B16.decode $ encodeUtf8 b
              jsrc = decodeUtf8 . BL.toStrict $ Aeson.encode src
              codeInfo' = [CodeInfo b' jsrc $ Just contractdetailsName]
          md' <- case theVM of
              "SolidVM" -> do
                let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
                (_, argsAsSource) <- constructArgValuesAndSource (Just argValues) xabiArgs
                pure $ (at "args" ?~ argsAsSource) md
              _ -> pure md
          return ([contractAcctInfo],codeInfo',md') -- Perhaps in the future, we can support multiple contracts
  nonce <- byteStringToWord256 <$> liftIO (getEntropy 32)
  let maybeNonContract a b | a == governanceAddress = Nothing
                           | otherwise = Just $ NonContract a b
      nonContractAcctInfo = catMaybes $ nmap maybeNonContract balances
      acctInfo = cAcctInfo ++ nonContractAcctInfo
      chainInfo = ChainInfo
        (UnsignedChainInfo lbl
                           acctInfo
                           codeInfo
                           (Map.fromList $ unNamedTuple @"address" @"enode" <$> members)
                           pChain
                           creationBlockHash
                           nonce
                           metaData
        )
        Nothing
  return (fst <$> mContract, chainInfo)

withLastBlockHash :: (MonadIO m, MonadLogger m, HasCoreAPI m) =>
                     (Keccak256 -> m b) -> m b

--withLastBlockHash :: Monad m =>
--                     (Keccak256 -> m Bloc) -> m a
withLastBlockHash f = do
  blks <- blocStrato $ getBlkLastClient 1
  case blks of
    (Block' blk _):_ -> f $ blockHash blk
    _ -> throwIO . UserError $ Text.pack "STRATO has not been initialized yet"

postChainInfo :: (MonadIO m, MonadLogger m, HasBlocSQL m,
                  HasBlocEnv m, HasSQL m, HasCoreAPI m) =>
                 ChainInput -> m ChainId
postChainInfo chainInput = withLastBlockHash $ \bHash -> do
  (mCmId, chainInfo') <- createChainInfo bHash chainInput
  chainId <- CORE.postChain chainInfo'
  let isAsync = fromMaybe False $ chaininputAsync chainInput
  unless isAsync $ waitForChainInfo chainId
  for_ mCmId $ \cmId -> insertContractInstance cmId $ Account governanceAddress (Just $ unChainId chainId)
  return chainId

postChainInfos :: (MonadIO m, MonadLogger m, HasBlocSQL m,
                   HasSQL m, HasBlocEnv m, HasCoreAPI m) =>
                  [ChainInput] -> m [ChainId]
postChainInfos chainInputs = withLastBlockHash $ \bHash -> do
  chainInfos <- traverse (createChainInfo bHash) chainInputs
  chainIds <- postChains $ map snd chainInfos
  let asyncInputs = fromMaybe False . chaininputAsync <$> chainInputs
      asyncChains = map snd . filter (not . fst) $ zip asyncInputs chainIds
  unless (null asyncChains) $ waitForChainInfos asyncChains
  let cmIdChains = catMaybes $ zipWith (liftA2 (,)) (map fst chainInfos) (map Just chainIds)
  for_ cmIdChains $ \(cmId, chainId) -> insertContractInstance cmId $ Account governanceAddress (Just $ unChainId chainId)
  return chainIds

waitForChainInfo :: (MonadLogger m, Selectable ChainId ChainInfo m,
                     HasSQL m) =>
                    ChainId -> m ()
waitForChainInfo chainId = waitForChainInfos [chainId]

waitForChainInfos :: (MonadLogger m, Selectable ChainId ChainInfo m,
                      HasSQL m) =>
                     [ChainId] -> m ()
waitForChainInfos chainIds = waitFor "failed to retrieve chain info" go
  where go :: (MonadLogger m, Selectable ChainId ChainInfo m) => m Bool
        go = do
          infos <- getChainInfo chainIds
          $logInfoLS "waitForChainInfo/req" chainIds
          $logDebugLS "waitForChainInfo/resp" infos
          return $ length infos == length chainIds


getChainInfo :: (Selectable ChainId ChainInfo m) =>
                [ChainId] -> m [ChainIdChainOutput]
getChainInfo chainIds = do
  chainIdChainInfos <- getChain chainIds
  return $ map convertChainInfo chainIdChainInfos
    where
      convertChainInfo :: NamedTuple "id" "info" ChainId ChainInfo -> ChainIdChainOutput
      convertChainInfo chp = do
        let chtup = unNamedTuple @"id" @"info" chp
        let chinfo =  chainInfo $ snd chtup
        let getAddrBalance acct = case acct of
                                    NonContract a b -> (a, b)
                                    ContractNoStorage a b _ -> (a, b)
                                    ContractWithStorage a b _ _ -> (a, b)
        let acctInfo = map (NamedTuple @"address" @"balance" . getAddrBalance) $ accountInfo chinfo
            mems = map (NamedTuple @"address" @"enode") . Map.toList $ members chinfo
        NamedTuple (fst chtup, ChainOutput (chainLabel chinfo) acctInfo mems) :: ChainIdChainOutput
