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
import           GHC.Generics
import qualified BlockApps.Solidity.Value as V
import           BlockApps.Ethereum (Keccak256, Address)
import            Data.Time

type StateRoot = Text

newtype SHA = SHA Integer deriving (Eq, Read, Show, Ord, Generic)

-- | Not a type, but a data kind
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
  , contractData        :: Map Text V.Value
} deriving (Show)
