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
import           Slipstream.Data.Globals

type StateRoot = Text

data Detail = Incremental | Eventual

data ProcessedContract = ProcessedContract
  { address           :: Address
  , codehash          :: CodePtr
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

  -- map1 ValueMapping (Map.Map SimpleValue Value)

  map1 Map(key1 value1, key2 value2 , key3 value3 )

data ProcessedMapping = ProcessedMapping
  { m_address           :: Address
  , m_codehash          :: CodePtr
  , m_organization      :: Text
  , m_application       :: Text
  , m_contractName      :: Text
  , m_mapName           :: Text
  , m_chain             :: Text
  , m_blockHash         :: Keccak256
  , m_blockTimestamp    :: UTCTime
  , m_blockNumber       :: Integer
  , m_transactionHash   :: Keccak256
  , m_transactionSender :: Address
  , m_mapDataKey        :: V.Value
  , m_mapDataValue      :: V.Value
  } deriving (Show)

data EventTable = EventTable
  { eventOrganization :: Text
  , eventApplication  :: Text
  , eventContractName :: Text
  , eventName         :: Text
  , eventFields       :: TableColumns
  } deriving (Show)


