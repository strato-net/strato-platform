{-# LANGUAGE Arrows              #-}
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
import           BlockApps.Strato.Types            hiding (Transaction (..))
import           BlockApps.XAbiConverter

postChain :: ChainInput -> Bloc ChainId
postChain (ChainInput src label accountInfo variableNames members) = do
  idsAndDetails <- compileContract src
  ContractDetails{..} <- case Map.toList idsAndDetails of 
            [] -> throwError $ UserError "You need to supply at least one governance contract"
            [(_, x)] -> return $ snd x
            _ -> throwError $ UserError "Multiple governance contracts are not allowed" 
  let contractAcctInfo = transformXabi contractdetailsXabi (Map.fromList variableNames)
      nonContractAcctInfo = map (\(a, b) -> NonContract a b) accountInfo
      acctInfo = [contractAcctInfo] ++ nonContractAcctInfo
      codeInfo = CodeInfo contractdetailsBin src contractdetailsName
      chainInfo = ChainInfo label acctInfo [codeInfo] members
  chainId <- blocStrato $ Strato.postChain chainInfo
  return chainId 
