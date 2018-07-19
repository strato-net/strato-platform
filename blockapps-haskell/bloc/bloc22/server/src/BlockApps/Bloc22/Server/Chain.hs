{-# LANGUAGE Arrows              #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Chain where

import           Control.Concurrent
import           Control.Arrow
import           Control.Exception.Lifted          (catch)
import           Control.Monad
import           Control.Monad.Except
import           Control.Monad.Log
import           Control.Monad.Reader
import           Control.Monad.Trans.State.Lazy    (StateT(..), get, put, runStateT)
import           Crypto.Secp256k1
import qualified Data.Aeson                        as Aeson
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Lazy              as BL
import qualified Data.ByteString.Base16            as Base16
import           Data.Either
import           Data.Foldable
import           Data.Int                          (Int32)
import           Data.List                         (sortOn)
import           Data.Map.Strict                   (Map)
import qualified Data.Map.Strict                   as Map
import qualified Data.Map.Ordered                  as OMap
import           Data.Maybe
import           Data.Monoid
import           Data.RLP
import           Data.Set                          (isSubsetOf)
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Traversable
import           Opaleye                           hiding (not, null, index)
import           Database.PostgreSQL.Simple        (SqlError(..))

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Crypto
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import qualified BlockApps.Bloc22.Monad            as M
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract()
import qualified BlockApps.Solidity.Contract       as C
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Storage
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Type      as Xabi
import           BlockApps.SolidityVarReader
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
  contractAcctInfo <- transformXabi contractdetailsXabi (Map.fromList variableNames)
  let nonContractAcctInfo = map (\(a, b) -> NonContract a b) accountInfo
      acctInfo = [contractAcctInfo] ++ nonContractAcctInfo
      codeInfo = CodeInfo contractdetailsBin src contractdetailsName
      chainInfo = ChainInfo label acctInfo [codeInfo] members
  chainId <- blocStrato $ Strato.postChain chainInfo
  return chainId 
