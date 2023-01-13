
-- {-# OPTIONS -fno-warn-unused-top-binds  #-}

module Blockchain.SolidVM.Environment (
  Sender(..),
  Environment(..)
  ) where

import qualified Data.Map                                    as M
import qualified Data.Text                                   as T

import           Blockchain.Data.DataDefs (BlockData(..))
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Keccak256

newtype Sender = Sender { unSender :: Account }

data Environment =
  Environment {
    sender :: Account,
    origin :: Account,
    blockHeader :: BlockData,
    txHash :: Keccak256,
    metadata :: Maybe (M.Map T.Text T.Text)
    }





