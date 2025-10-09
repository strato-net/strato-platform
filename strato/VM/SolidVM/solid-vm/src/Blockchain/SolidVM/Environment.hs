-- {-# OPTIONS -fno-warn-unused-top-binds  #-}

module Blockchain.SolidVM.Environment
  ( Sender (..),
    Environment (..),
  )
where

import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Keccak256
import Data.Text (Text)

newtype Sender = Sender {unSender :: Address}

data Environment = Environment
  { sender :: Address,
    origin :: Address,
    proposer :: Address,
    blockHeader :: BlockHeader,
    txHash :: Keccak256,
    src :: Maybe Code,
    name :: Maybe Text,
    runningTests :: Bool
  }
