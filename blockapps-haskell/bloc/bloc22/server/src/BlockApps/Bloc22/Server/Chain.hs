{-# LANGUAGE Arrows              #-}
{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Chain where

import           Control.Monad.Except
import qualified Data.Map.Strict                   as Map
import           Data.Maybe                        (isJust)
import qualified Data.Text                         as Text
import           Opaleye                           hiding (not, null, index, sum)

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum
import           BlockApps.SolidityVarReader
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Client           as Strato
import           BlockApps.Strato.TypeLits
import           BlockApps.Strato.Types            hiding (Transaction (..))
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.XAbiConverter           (xAbiToContract)

governanceAddress :: Address
governanceAddress = Address 0x100

postChainInfo :: ChainInput -> Bloc ChainId
postChainInfo (ChainInput src cname lbl balances chaininputArgs members) = do
  when (null members) $ throwError $ UserError "Private chains must include at least one member"
  when (sum (nmap2' balances) == 0) $ throwError $ UserError "At least one account must have a non-zero balance"
  idsAndDetails <- if Text.null src
                     then return Map.empty
                     else snd <$> compileContract src
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
              storage = encodeValues (typeDefs contract) (mainStruct contract) 0 argsText
              contractAcctInfo = ContractWithStorage governanceAddress (0::Integer) contractdetailsCodeHash storage
              codeInfo' = CodeInfo contractdetailsBinRuntime src contractdetailsName
          return ([contractAcctInfo],[codeInfo']) -- Perhaps in the future, we can support multiple contracts
  let nonContractAcctInfo = nmap NonContract balances
      acctInfo = cAcctInfo ++ nonContractAcctInfo
      chainInfo = ChainInfo lbl acctInfo codeInfo members
  chainId <- blocStrato $ Strato.postChain chainInfo
  when (isJust mContract) $ do
    let Just (cmId, _) = mContract
    void . blocModify $ \conn -> runInsertMany conn contractsInstanceTable
      [
      ( Nothing
      , constant cmId
      , constant governanceAddress
      , Nothing
      , constant (Just chainId)
      )
      ]
  return chainId

getChainInfo :: [ChainId] -> Bloc [ChainIdChainOutput]
getChainInfo chainIds = do
  chainIdChainInfos::[ChainIdChainInfo] <- blocStrato $ Strato.getChain chainIds
  return $ map convertChainInfo chainIdChainInfos
    where
      convertChainInfo :: ChainIdChainInfo -> ChainIdChainOutput
      convertChainInfo chp = do
        let chtup = (toTuple chp :: (ChainId, ChainInfo))
        let chinfo =  snd chtup
        let getAddrBalance acct = case acct of
                                    NonContract a b -> (a, b)
                                    ContractNoStorage a b _ -> (a, b)
                                    ContractWithStorage a b _ _ -> (a, b)
        let acctInfo = map (fromTuple . getAddrBalance) $ accountInfo chinfo
        NamedTuple (fst chtup, ChainOutput (chainLabel chinfo) acctInfo (members chinfo)) :: ChainIdChainOutput
