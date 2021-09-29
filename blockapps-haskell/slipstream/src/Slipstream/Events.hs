{-# LANGUAGE
      OverloadedStrings
    , DataKinds
    , FlexibleInstances
    , KindSignatures , TypeFamilies
#-}

module Slipstream.Events where

import           Data.Map                 (Map)
import           Data.Text                (Text)
import           Data.Time

import qualified BlockApps.Solidity.Value as V
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Slipstream.SolidityValue
import           Slipstream.Data.Globals

type StateRoot = Text

data Detail = Incremental | Eventual

data FunctionCallData = FunctionCallData
  { functioncalldataName   :: Text
  , functioncalldataInput  :: [(Text,SolidityValue)]
  , functioncalldataOutput :: [(Text,SolidityValue)]
  } deriving (Show)

data ProcessedContract = ProcessedContract
  { address           :: Address
  , codehash          :: CodePtr
  , abi               :: Text
  , organization      :: Text
  , application       :: Text
  , contractName      :: Text
  , chain             :: Text
  , blockHash         :: Keccak256
  , blockTimestamp    :: UTCTime
  , blockNumber       :: Integer
  , transactionHash   :: Keccak256
  , transactionSender :: Address
  , contractData      :: Map Text V.Value
  } deriving (Show)

data EventTable = EventTable
  { eventOrganization :: Text
  , eventApplication  :: Text
  , eventContractName :: Text
  , eventName         :: Text
  , eventFields       :: TableColumns
  } deriving (Show)


