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
import           BlockApps.Ethereum (CodePtr)
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.SHA
import           Slipstream.SolidityValue

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
  , contractName      :: Text
  , chain             :: Text
  , blockHash         :: SHA
  , blockTimestamp    :: UTCTime
  , blockNumber       :: Integer
  , transactionHash   :: SHA
  , transactionSender :: Address
  , functionCallData  :: Maybe FunctionCallData
  , contractData      :: Map Text V.Value
  } deriving (Show)

data EventTable = EventTable
  { eventContractName :: Text
  , eventName         :: Text
  , eventFields       :: [Text]
  } deriving (Show)
