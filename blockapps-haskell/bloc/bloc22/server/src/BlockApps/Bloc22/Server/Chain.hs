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

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum
import           BlockApps.Solidity.Contract()
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Client           as Strato
import           BlockApps.Strato.TypeLits
import           BlockApps.Strato.Types            hiding (Transaction (..))

postChain :: ChainInput -> Bloc ChainId
postChain (ChainInput src label accountInfo _ members) = do
  idsAndDetails <- compileContract src
  ContractDetails{..} <- case Map.toList idsAndDetails of
            [] -> throwError $ UserError "You need to supply at least one governance contract"
            [(_, x)] -> return $ snd x
            _ -> throwError $ UserError "Multiple governance contracts are not allowed"
  let varMap = Map.empty -- Map.fromList $ transformXabi contractdetailsXabi (Map.fromList variableNames) -- TODO: this
      contractAcctInfo = ContractWithStorage (Address 0x100) (0::Integer) contractdetailsCodeHash varMap
      nonContractAcctInfo = map (uncurry NonContract) $ map toTuple accountInfo
      acctInfo = [contractAcctInfo] ++ nonContractAcctInfo
      codeInfo = CodeInfo contractdetailsBinRuntime src contractdetailsName
      chainInfo = ChainInfo label acctInfo [codeInfo] members
  chainId <- blocStrato $ Strato.postChain chainInfo
  return chainId

getChain :: ChainId -> Bloc ChainOutput
getChain chainId = do
  chainIdChainInfo <- blocStrato $ Strato.getChain [chainId]
  (ChainInfo cl ai _ mm) <- case chainIdChainInfo of
                                         [] -> throwError $ DBError "No chain matches the chainId"
                                         (idInfo:_) -> return $ snd (toTuple idInfo :: (ChainId, ChainInfo))
  let getAddrBalance acct = case acct of
                              NonContract a b -> (a, b)
                              ContractNoStorage a b _ -> (a, b)
                              ContractWithStorage a b _ _ -> (a, b)
  let acctInfo = map (fromTuple . getAddrBalance) ai
  return $ ChainOutput cl acctInfo mm
