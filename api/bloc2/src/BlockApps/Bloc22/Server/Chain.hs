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

module BlockApps.Bloc22.Server.Chain where

import           Control.Applicative               (liftA2)
import           Control.Monad                     (when, unless)
import           Control.Monad.Trans.Control
import           Crypto.Random.Entropy
import qualified Data.ByteString.Base16            as B16
import           Data.Foldable                     (for_)
import           Data.Int                          (Int32)
import qualified Data.Map.Ordered                  as OMap
import qualified Data.Map.Strict                   as Map
import           Data.Maybe                        (catMaybes, fromJust, fromMaybe)
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import           Data.Text.Encoding                (encodeUtf8)
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
import           BlockApps.Bloc22.Server.Utils     (waitFor)
import           BlockApps.XAbiConverter           (xAbiToContract)

import           Blockchain.Data.ChainInfo
import           Blockchain.TypeLits
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Keccak256
import           Control.Monad.Change.Alter
import           Control.Monad.Composable.BlocSQL
import           Handlers.Chain

import           UnliftIO


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
          TypeArrayDynamic (SimpleType TypeAddress) -> m'
          _ -> m

createChainInfo :: (MonadIO m, MonadBaseControl IO m, MonadLogger m, HasBlocSQL m, HasBlocEnv m) =>
                   ChainInput -> m (Maybe Int32, ChainInfo)
createChainInfo (ChainInput msrc cname lbl balances chaininputArgs members mmd _) = do
  when (null members) $ throwIO $ UserError "Private chains must include at least one member"
  when (sum (nmap2' balances) == 0) $ throwIO $ UserError "At least one account must have a non-zero balance"

  let src = fromMaybe "" msrc
  let theVM = fromMaybe "EVM" $ Map.lookup "VM" =<< mmd
  mContract <- fmap snd <$> getContractDetailsForContract theVM src cname
  (cAcctInfo, codeInfo) <- case mContract of
      Nothing -> return ([],[])
      Just (_, ContractDetails{..}) -> do
          contract <- either (throwIO . UserError . Text.pack) return $ xAbiToContract contractdetailsXabi
          let argValues = replaceMembers
                            (mainStruct contract)
                            (nmap1' members)
                            chaininputArgs
          storage <- fmap Map.toList . either (throwIO . UserError) return $ encodeValues
                       (typeDefs contract)
                       (mainStruct contract)
                       0
                       (Map.toList argValues)
          let balMap = Map.fromList $ map (unNamedTuple @"address" @"balance") balances
              govBal = fromMaybe 0 $ Map.lookup governanceAddress balMap

          (contractHash, b, s) <-
            case theVM of
              "EVM" -> return (contractdetailsCodeHash, contractdetailsBinRuntime, src)
              "SolidVM" -> do
                return (contractdetailsCodeHash, "", src)
              _ -> throwIO . UserError . Text.pack $ "Unknown VM: " ++ show theVM

          let contractAcctInfo = ContractWithStorage governanceAddress govBal contractHash storage
              b' = fst . B16.decode $ encodeUtf8 b
              codeInfo' = CodeInfo b' s cname
          return ([contractAcctInfo],[codeInfo']) -- Perhaps in the future, we can support multiple contracts
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
                           Nothing
                           creationBlockHash
                           nonce
                           (fromMaybe Map.empty mmd)
        )
        Nothing
  return (fst <$> mContract, chainInfo)

creationBlockHash :: Keccak256
creationBlockHash = fromJust $
  stringKeccak256 "0000000000000000000000000000000000000000000000000000000000000000"

postChainInfo :: ChainInput -> Bloc ChainId
postChainInfo chainInput = do
  (mCmId, chainInfo) <- createChainInfo chainInput
  chainId <- blocStrato $ postChainClient chainInfo
  let isAsync = fromMaybe False $ chaininputAsync chainInput
  unless isAsync $ undefined chainId -- TODO- put waitForChainInfos back in here
--  unless isAsync $ waitForChainInfo chainId
  for_ mCmId $ \cmId -> insertContractInstance cmId governanceAddress (Just chainId)
  return chainId

postChainInfos :: (MonadIO m, MonadBaseControl IO m, MonadLogger m, HasBlocSQL m, HasBlocEnv m) =>
                  [ChainInput] -> m [ChainId]
postChainInfos chainInputs = do
  chainInfos <- traverse createChainInfo chainInputs
  chainIds <- blocStrato . postChainsClient $ map snd chainInfos
  let asyncInputs = fromMaybe False . chaininputAsync <$> chainInputs
      asyncChains = map snd . filter (not . fst) $ zip asyncInputs chainIds
  unless (null asyncChains) $ undefined asyncChains -- TODO- put waitForChainInfos back in here
--  unless (null asyncChains) $ waitForChainInfos asyncChains
  let cmIdChains = catMaybes $ zipWith (liftA2 (,)) (map fst chainInfos) (map Just chainIds)
  for_ cmIdChains $ \(cmId, chainId) -> insertContractInstance cmId governanceAddress (Just chainId)
  return chainIds

waitForChainInfo :: (MonadIO m, MonadLogger m, Selectable ChainId ChainInfo m) =>
                    ChainId -> m ()
waitForChainInfo chainId = waitForChainInfos [chainId]

waitForChainInfos :: (MonadIO m, MonadLogger m, Selectable ChainId ChainInfo m) =>
                     [ChainId] -> m ()
waitForChainInfos chainIds = waitFor "failed to retrieve chain info" go
  where go :: (MonadLogger m, Selectable ChainId ChainInfo m) => m Bool
        go = do
          infos <- getChainInfo chainIds
          $logInfoLS "waitForChainInfo/req" chainIds
          $logDebugLS "waitForChainInfo/resp" infos
          return $ length infos == length chainIds


getChainInfo :: Selectable ChainId ChainInfo m =>
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
