{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}

module Blockchain.EVM.Environment where

import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import qualified Data.ByteString as B
import qualified Data.IntSet as I
import Data.Map.Strict (Map)
import Data.Text (Text)
import GHC.Generics

data Environment = Environment
  { envOwner :: Account,
    envOrigin :: Account,
    envGasPrice :: Integer,
    envInputData :: B.ByteString,
    envSender :: Account,
    envValue :: Integer,
    envCode :: Code,
    envJumpDests :: I.IntSet,
    envBlockHeader :: BlockHeader,
    envTxHash :: Keccak256,
    envChainId :: Maybe Word256,
    envMetadata :: Maybe (Map Text Text)
  }
  deriving (Show, Generic, NFData)
