{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE KindSignatures #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeFamilies #-}

module Slipstream.Events where

import qualified BlockApps.Solidity.Value as V
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256
import Data.Map (Map)
import Data.Text (Text)
import Data.Time

type StateRoot = Text

data Detail = Incremental | Eventual

data ProcessedContract = ProcessedContract
  { address :: Address,
    codehash :: CodePtr,
    creator :: Text,
    cc_creator :: Maybe Text,
    root :: Text,
    application :: Text,
    contractName :: Text,
    chain :: Text,
    blockHash :: Keccak256,
    blockTimestamp :: UTCTime,
    blockNumber :: Integer,
    transactionHash :: Keccak256,
    transactionSender :: Address,
    contractData :: Map Text V.Value
  }
  deriving (Show)
