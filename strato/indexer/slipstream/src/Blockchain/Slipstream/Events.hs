{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE KindSignatures #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeFamilies #-}

module Blockchain.Slipstream.Events where

import qualified BlockApps.Solidity.Value as V
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Data.Map (Map)
import Data.Text (Text)
import Data.Time

type StateRoot = Text

data Detail = Incremental | Eventual

data ProcessedContract = ProcessedContract
  { address :: Address,
    blockHash :: Keccak256,
    blockTimestamp :: UTCTime,
    blockNumber :: Integer,
    contractData :: Map Text V.Value
  }
  deriving (Show)
