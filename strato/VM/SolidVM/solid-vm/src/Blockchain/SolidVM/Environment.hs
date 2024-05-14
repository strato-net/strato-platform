-- {-# OPTIONS -fno-warn-unused-top-binds  #-}

module Blockchain.SolidVM.Environment
  ( Sender (..),
    Environment (..),
  )
where

import Blockchain.Data.BlockData
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Keccak256
import qualified Data.Map as M
import qualified Data.Text as T

newtype Sender = Sender {unSender :: Account}

data Environment = Environment
  { sender :: Account,
    origin :: Account,
    blockHeader :: BlockData,
    txHash :: Keccak256,
    metadata :: Maybe (M.Map T.Text T.Text),
    runningTests :: Bool
  }
