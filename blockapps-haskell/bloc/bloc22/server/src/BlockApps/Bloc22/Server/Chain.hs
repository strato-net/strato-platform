{-# LANGUAGE Arrows              #-}
{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Chain where

import           Control.Monad.Except
import           Crypto.Random.Entropy
import qualified Data.Map.Ordered                  as OMap
import qualified Data.Map.Strict                   as Map
import           Data.Maybe                        (catMaybes, fromMaybe, isJust)
import           Data.Text                         (Text)
import qualified Data.Text                         as Text

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum                hiding (keccak256)
import           BlockApps.Logging
import           BlockApps.SolidityVarReader
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Client           as Strato
import           BlockApps.Strato.TypeLits
import           BlockApps.Strato.Types            hiding (Transaction (..))
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Server.Utils     (waitFor)
import           BlockApps.XAbiConverter           (xAbiToContract)

governanceAddress :: Address
governanceAddress = Address 0x100

replaceMembers :: Struct
               -> [Address]
               -> Map.Map Text Text
               -> Map.Map Text Text
replaceMembers Struct{..} addrs m =
  let tag = "__members__"
      members = valueToText $ ValueArrayDynamic . tosparse $ map (SimpleValue . ValueAddress) addrs
      m' = Map.alter (const $ Just members) tag m
   in case OMap.lookup tag fields of
        Nothing -> m'
        Just (Left _, _) -> m
        Just (_, ty) -> case ty of
          TypeArrayDynamic (SimpleType TypeAddress) -> m'
          _ -> m

postChainInfo :: ChainInput -> Bloc ChainId
postChainInfo (ChainInput src cname lbl balances chaininputArgs members mmd) = do
  let theVM = fromMaybe "EVM" $ join $ fmap (Map.lookup "VM") mmd
  
  when (null members) $ throwError $ UserError "Private chains must include at least one member"
  when (sum (nmap2' balances) == 0) $ throwError $ UserError "At least one account must have a non-zero balance"
  let shouldCompile = if theVM == "EVM" then Do Compile else Don't Compile
  idsAndDetails <- if (Text.null src)
                     then return Map.empty
                     else sourceToContractDetails shouldCompile src
  mContract <- case Map.toList idsAndDetails of
            [] -> return Nothing
            [(_, x)] -> return $ Just x
            _ -> case cname of
                   Nothing -> throwError $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
                   Just name -> fmap Just $ blocMaybe "Could not find contract name in compilation details"
                                      $ Map.lookup name idsAndDetails
  (cAcctInfo, codeInfo) <- case mContract of
      Nothing -> return ([],[])
      Just (_, ContractDetails{..}) -> do
          contract <- either (throwError . UserError . Text.pack) return $ xAbiToContract contractdetailsXabi
          let argsText = map (fmap argValueToText) $ Map.toList chaininputArgs
              argsText' = replaceMembers
                            (mainStruct contract)
                            (nmap1' members)
                            (Map.fromList argsText)
              storage = encodeValues
                          (typeDefs contract)
                          (mainStruct contract)
                          0
                          (Map.toList argsText')
              balMap = Map.fromList $ map toTuple balances
              govBal = fromMaybe 0 $ Map.lookup governanceAddress balMap
              
          (contractHash, b, s) <-
            case theVM of
              "EVM" -> return (contractdetailsCodeHash, contractdetailsBinRuntime, src)
              "SolidVM" -> do
                return (contractdetailsCodeHash, "", src)
              _ -> throwError . UserError . Text.pack $ "Unknown VM: " ++ show theVM
              
          let contractAcctInfo = ContractWithStorage governanceAddress govBal contractHash storage
              codeInfo' = CodeInfo b s contractdetailsName
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
                           members
                           Nothing
                           creationBlockHash
                           nonce
                           (fromMaybe Map.empty mmd)
        )
        Nothing
  chainId <- blocStrato $ Strato.postChain chainInfo
  waitForChainInfo chainId
  when (isJust mContract) $ do
    let Just (cmId, _) = mContract
    void $ insertContractInstance cmId governanceAddress (Just chainId)
  return chainId

waitForChainInfo :: ChainId -> Bloc ()
waitForChainInfo chainId = waitFor "failed to retrieve chain info" go
  where go :: Bloc Bool
        go = do
          infos <- getChainInfo [chainId]
          $logInfoLS "waitForChainInfo/req" chainId
          $logInfoLS "waitForChainInfo/resp" infos
          return . not $ null infos


getChainInfo :: [ChainId] -> Bloc [ChainIdChainOutput]
getChainInfo chainIds = do
  chainIdChainInfos::[ChainIdChainInfo] <- blocStrato $ Strato.getChain chainIds
  return $ map convertChainInfo chainIdChainInfos
    where
      convertChainInfo :: ChainIdChainInfo -> ChainIdChainOutput
      convertChainInfo chp = do
        let chtup = (toTuple chp :: (ChainId, ChainInfo))
        let chinfo =  chainInfo $ snd chtup
        let getAddrBalance acct = case acct of
                                    NonContract a b -> (a, b)
                                    ContractNoStorage a b _ -> (a, b)
                                    ContractWithStorage a b _ _ -> (a, b)
        let acctInfo = map (fromTuple . getAddrBalance) $ accountInfo chinfo
        NamedTuple (fst chtup, ChainOutput (chainLabel chinfo) acctInfo (members chinfo)) :: ChainIdChainOutput
