{-# LANGUAGE
      OverloadedStrings
    , DataKinds
    , DeriveGeneric
    , FlexibleInstances
    , KindSignatures , TypeFamilies
#-}

module Slipstream.Events where

import           Data.Map                 (Map)
import           Data.Text                (Text)
import qualified BlockApps.Solidity.Value as V
import           BlockApps.Ethereum (Keccak256, Address)
import           Data.Time

type StateRoot = Text

data Detail = Incremental | Eventual

data ProcessedContract = ProcessedContract {
  address               :: Address
  , codehash            :: Keccak256
  , abi                 :: Text
  , contractName        :: Text
  , chain               :: Text
  , blockHash           :: Keccak256
  , blockTimestamp      :: UTCTime
  , blockNumber         :: Integer
  , transactionHash     :: Keccak256
  , transactionSender   :: Address
  , transactionFuncName :: Text
  , transactionInput    :: Text
  , transactionOutput   :: Text
  , contractData        :: Map Text V.Value
} deriving (Show)
