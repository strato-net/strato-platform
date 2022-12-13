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
{-# LANGUAGE TypeOperators       #-}


module BlockApps.Bloc22.Server.Chain where

import           Control.Lens                      ((?~), at)
import           Control.Monad                     (join, when, unless)
import qualified Control.Monad.Change.Alter        as A
import           Control.Monad.Composable.Vault
import           Crypto.Random.Entropy
-- import qualified Data.Map.Ordered                  as OMap
import qualified Data.Map.Strict                   as Map
import           Data.Maybe                        (catMaybes, fromMaybe, listToMaybe)
import           Data.Source.Map
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
-- import qualified Data.Set                         as S
import           Data.Text.Encoding                (encodeUtf8)
-- import qualified Data.Vector                       as V
import qualified Database.Esqueleto.Legacy as E

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.Monad
import           BlockApps.Logging
import           BlockApps.SolidityVarReader
-- import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract
-- import           BlockApps.Solidity.Struct
-- import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Xabi
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Server.TransactionResult  (constructArgValuesAndSource)
import           BlockApps.Bloc22.Server.Utils              (waitFor, getSigVals)
import           BlockApps.XAbiConverter                    (xAbiToContract)

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.TypeLits
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Keccak256
import           Control.Monad.Change.Alter
import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.SQL
import           Handlers.Chain
import qualified LabeledError
import           SQLM
import           Strato.Strato23.Client
import           Strato.Strato23.API.Types

import           UnliftIO

import qualified Handlers.Chain as CORE

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

createChainInfo :: ( MonadIO m
                   , A.Selectable Account AddressState m
                   , (Keccak256 `A.Alters` SourceMap) m
                   , MonadLogger m
                   , HasBlocSQL m
                   , HasBlocEnv m
                   , HasVault m
                   )
                => Text -> Keccak256 -> ChainInput -> m ChainInfo
createChainInfo userName creationBlockHash (ChainInput src mCodePtr cname lbl balances chaininputArgs members pChain mmd _) = do
  when (null (unChainMembers members)) $ throwIO $ UserError "Private chains must include at least one member"
  when (sum (nmap2' balances) == 0) $ throwIO $ UserError "At least one account must have a non-zero balance"

  let md = fromMaybe Map.empty mmd
      theVM = fromMaybe "EVM" $ Map.lookup "VM" md
  mContract <-
    if src /= mempty
      then fmap snd <$> getContractDetailsForContract theVM src cname
      else case mCodePtr of
        Just codePtr -> either (const Nothing) Just <$> getContractDetailsByCodeHash codePtr
        Nothing -> fmap snd <$> getContractDetailsForContract theVM mempty cname
  (cAcctInfo, codeInfo, metaData) <- case mContract of
      Nothing -> return ([],[], md)
      Just ContractDetails{..} -> do
          contract <- either (throwIO . UserError . Text.pack) return $ xAbiToContract contractdetailsXabi
          -- let argValues = replaceMembers
          --                   (mainStruct contract)
          --                   (members)
          --                   chaininputArgs
          storage <- case theVM of
            "EVM" -> fmap Map.toList . either (throwIO . UserError) return $ encodeValues
                       (typeDefs contract)
                       (mainStruct contract)
                       0
                       (Map.toList chaininputArgs)
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
              b' = LabeledError.b16Decode "createChainInfo" $ encodeUtf8 b
              jsrc = serializeSourceMap src
              codeInfo' = [CodeInfo b' jsrc $ Just contractdetailsName]
          md' <- case theVM of
              "SolidVM" -> do
                let xabiArgs = maybe Map.empty funcArgs $ xabiConstr contractdetailsXabi
                (_, argsAsSource) <- constructArgValuesAndSource (Just chaininputArgs) xabiArgs
                pure $ (at "args" ?~ argsAsSource) md
              _ -> pure md
          return ([contractAcctInfo],codeInfo',md') -- Perhaps in the future, we can support multiple contracts
  nonce <- byteStringToWord256 <$> liftIO (getEntropy 32)
  let maybeNonContract a b | a == governanceAddress = Nothing
                           | otherwise = Just $ NonContract a b
      nonContractAcctInfo = catMaybes $ nmap maybeNonContract balances
      acctInfo = cAcctInfo ++ nonContractAcctInfo
      unsigned =
        (UnsignedChainInfo lbl
                           acctInfo
                           codeInfo
                           members
                           pChain
                           creationBlockHash
                           nonce
                           metaData
        )
      msgHash = keccak256ToByteString $ rlpHash unsigned
  sig <- blocVaultWrapper $ postSignature (Just userName) (MsgHash msgHash)
  let (r, s, v) = getSigVals sig
      chainInfo = ChainInfo unsigned (Just $ ChainSignature r s v)
  return chainInfo

withLastBlockHash :: (MonadIO m, MonadUnliftIO m, HasSQL m) =>
                     (Keccak256 -> m b) -> m b
withLastBlockHash f = do
  maybeBlkHash <- getLastBlockHash
  case maybeBlkHash of
    Just blkHash -> f blkHash
    _ -> throwIO . UserError $ Text.pack "STRATO has not been initialized yet"

getLastBlockHash :: (MonadIO m, HasSQL m) => m (Maybe Keccak256)
getLastBlockHash = do
    blks <- fmap (map (E.entityVal)) . sqlQuery $ E.select $
        E.from $ \a -> do
          E.limit 1
          E.orderBy [E.desc (a E.^. BlockDataRefNumber)]
          return a

    return $ fmap blockDataRefHash $ listToMaybe blks


postChainInfo :: ( MonadIO m
                 , A.Selectable Account AddressState m
                 , (Keccak256 `A.Alters` SourceMap) m
                 , MonadLogger m
                 , HasBlocSQL m
                 , HasBlocEnv m
                 , HasSQL m
                 , HasVault m
                 )
              => Maybe Text -> ChainInput -> m ChainId
postChainInfo mJwtToken chainInput = case mJwtToken of
  Nothing -> throwIO $ UserError $ Text.pack "Did not find Authorization in the header"
  Just jwtToken -> withLastBlockHash $ \bHash -> do
    evmCompatibleOn <- fmap evmCompatible getBlocEnv
    if evmCompatibleOn
        then throwIO $ UserError $ Text.pack "Error: EVM Compatibility flag is On. This feature cannot be used."
    else do
        chainInfo' <- createChainInfo jwtToken bHash chainInput
        chainId <- CORE.postChain chainInfo'
        let isAsync = fromMaybe False $ chaininputAsync chainInput
        unless isAsync $ waitForChainInfo chainId
        return chainId

postChainInfos :: ( MonadIO m
                  , A.Selectable Account AddressState m
                  , (Keccak256 `A.Alters` SourceMap) m
                  , MonadLogger m
                  , HasBlocSQL m
                  , HasSQL m
                  , HasBlocEnv m
                  , HasVault m
                  )
               => Maybe Text -> [ChainInput] -> m [ChainId]
postChainInfos mJwtToken chainInputs = case mJwtToken of
  Nothing -> throwIO $ UserError $ Text.pack "Did not find Authorization in the header"
  Just userName -> withLastBlockHash $ \bHash -> do
    chainInfos <- traverse (createChainInfo userName bHash) chainInputs
    chainIds <- postChains chainInfos
    let asyncInputs = fromMaybe False . chaininputAsync <$> chainInputs
        asyncChains = map snd . filter (not . fst) $ zip asyncInputs chainIds
    unless (null asyncChains) $ waitForChainInfos asyncChains
    return chainIds

waitForChainInfo :: (MonadLogger m, Selectable ChainFilterParams (NamedMap "id" "info" ChainId ChainInfo) m,
                     HasSQL m) =>
                    ChainId -> m ()
waitForChainInfo chainId = waitForChainInfos [chainId]

waitForChainInfos :: (MonadLogger m, Selectable ChainFilterParams (NamedMap "id" "info" ChainId ChainInfo) m,
                      HasSQL m) =>
                     [ChainId] -> m ()
waitForChainInfos chainIds = waitFor "failed to retrieve chain info" go
  where go = do
          infos <- getChainInfo chainIds Nothing Nothing
          $logInfoLS "waitForChainInfo/req" chainIds
          $logDebugLS "waitForChainInfo/resp" infos
          return $ length infos == length chainIds

getSingleChainInfo :: (MonadIO m, Selectable ChainFilterParams (NamedMap "id" "info" ChainId ChainInfo) m) => 
                ChainId -> m ChainIdChainOutput

getSingleChainInfo chainId = join $ maybe (liftIO . throwIO $ CouldNotFind "chain not found") pure . listToMaybe <$> getChainInfo [chainId] Nothing Nothing
  

getChainInfo :: Selectable ChainFilterParams (NamedMap "id" "info" ChainId ChainInfo) m => 
                [ChainId] -> Maybe Integer -> Maybe Integer -> m [ChainIdChainOutput]
getChainInfo chainIds lim off = do
  chainIdChainInfos <- getChain chainIds lim off
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
            mems = members chinfo
        NamedTuple (fst chtup, ChainOutput (chainLabel chinfo) acctInfo mems) :: ChainIdChainOutput