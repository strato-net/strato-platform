
-- {-# OPTIONS -fno-warn-unused-top-binds  #-}

module Blockchain.SolidVM.Environment (
  Sender(..),
  Environment(..)
  ) where

import qualified Data.Map                                    as M
import qualified Data.Text                                   as T

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs (BlockData(..))
import           Blockchain.ExtWord
import           Blockchain.SHA

newtype Sender = Sender { unSender :: Address }

data Environment =
  Environment {
    sender :: Address,
    origin :: Address,
    blockHeader :: BlockData,
    txHash :: SHA,
    chainId :: Maybe Word256,
    metadata :: Maybe (M.Map T.Text T.Text)
    }





