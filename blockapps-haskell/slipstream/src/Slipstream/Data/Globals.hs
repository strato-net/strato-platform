{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.Data.Globals where

import           Control.DeepSeq
import           Data.Cache.LRU
import qualified Data.HashMap.Strict as HM
import qualified Data.Map.Strict     as M
import qualified Data.Set            as S
import           Data.Text
import           Data.Int (Int32)
import           GHC.Generics

import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (ContractDetails(..))
import           Blockchain.Strato.Model.Account
import qualified Blockchain.Strato.Model.CodePtr as CP
import           Blockchain.Strato.Model.Keccak256
import           Slipstream.Data.GlobalsColdStorage (Handle)


instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict


data Globals = Globals { createdEvents :: S.Set (Text, Text) -- (contractName, eventName)
                       , createdContracts :: S.Set CodePtr -- list of contacts with a table
                       , createdInstances :: S.Set CodePtr -- probably redundant, but for now :)
                       , historyList :: S.Set CodePtr
                       , noIndexList :: S.Set CodePtr
                       , functionHistoryList :: S.Set CodePtr
                       , contractABIs :: HM.HashMap Keccak256 (M.Map Text (Int32, ContractDetails))
                       , contractStates :: LRU Account [(Text, Value)]
                       , csHandle :: Handle
                       } deriving (Generic, NFData)


-- Redefined CodePtr to include a contracts organization for SolidVM
data CodePtr = EVMCode Keccak256
             | SolidVMCode String Text Keccak256
             | CodeAtAccount Account String
             deriving (Show, Read, Eq, Ord, Generic, NFData)

convertToSlipCodePtr :: CP.CodePtr -> Text -> CodePtr
convertToSlipCodePtr (CP.EVMCode kec)           _  = EVMCode kec
convertToSlipCodePtr (CP.SolidVMCode name hsh) org = SolidVMCode name org hsh
convertToSlipCodePtr (CP.CodeAtAccount acc s)   _  = CodeAtAccount acc s

convertFromSlipCodePtr :: CodePtr -> CP.CodePtr
convertFromSlipCodePtr (EVMCode kec)          = CP.EVMCode kec
convertFromSlipCodePtr (SolidVMCode name _ hsh) = CP.SolidVMCode name hsh
convertFromSlipCodePtr (CodeAtAccount acc s)  = CP.CodeAtAccount acc s

resolvedCodePtrToSHA :: CodePtr -> Keccak256
resolvedCodePtrToSHA (EVMCode hsh) = hsh
resolvedCodePtrToSHA (SolidVMCode _ _ hsh) = hsh
resolvedCodePtrToSHA _ = emptyHash