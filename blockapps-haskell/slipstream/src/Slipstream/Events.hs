{-# LANGUAGE
      OverloadedStrings
    , DataKinds
    , DeriveAnyClass
    , DeriveGeneric
    , FlexibleInstances
    , KindSignatures , TypeFamilies
#-}

module Slipstream.Events where

import           Control.DeepSeq
import           Data.Map                 (Map)
import           Data.Text                (Text)
import           GHC.Generics
import qualified BlockApps.Solidity.Value as V
import           BlockApps.Ethereum (Keccak256, Address)
import           Data.Time
import           Slipstream.SolidityValue

type StateRoot = Text

data Detail = Incremental | Eventual

data FunctionCallData = FunctionCallData
  { functioncalldataName   :: Text
  , functioncalldataInput  :: [(Text,SolidityValue)]
  , functioncalldataOutput :: [(Text,SolidityValue)]
  } deriving (Show, Generic, NFData)

data ProcessedContract = ProcessedContract
  { address           :: Address
  , codehash          :: Keccak256
  , abi               :: Text
  , contractName      :: Text
  , chain             :: Text
  , blockHash         :: Keccak256
  , blockTimestamp    :: UTCTime
  , blockNumber       :: Integer
  , transactionHash   :: Keccak256
  , transactionSender :: Address
  , functionCallData  :: Maybe FunctionCallData
  , contractData      :: Map Text V.Value
  } deriving (Show, Generic, NFData)
