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
import qualified Data.Text                         as Text
import           Opaleye                           hiding (not, null, index)

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
postChainInfo (ChainInput src lbl accountInfo chaininputArgs members) = do
  idsAndDetails <- compileContract src
  (cmId, ContractDetails{..}) <- case Map.toList idsAndDetails of
            [] -> throwError $ UserError "You need to supply at least one governance contract"
            [(_, x)] -> return x
            _ -> throwError $ UserError "Multiple governance contracts are not allowed"
  contract <- either (throwError . UserError . Text.pack) return $ xAbiToContract contractdetailsXabi
  let argsText = map (fmap argValueToText) $ Map.toList chaininputArgs
      storage = encodeValues (typeDefs contract) (mainStruct contract) 0 argsText
      contractAcctInfo = ContractWithStorage governanceAddress (0::Integer) contractdetailsCodeHash storage
      nonContractAcctInfo = map (uncurry NonContract) $ map toTuple accountInfo
      acctInfo = [contractAcctInfo] ++ nonContractAcctInfo
      codeInfo = CodeInfo contractdetailsBinRuntime src contractdetailsName
      chainInfo = ChainInfo lbl acctInfo [codeInfo] members
  chainId <- blocStrato $ Strato.postChain chainInfo
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
