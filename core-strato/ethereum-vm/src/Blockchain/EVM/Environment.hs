{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
module Blockchain.EVM.Environment where

import           Control.DeepSeq
import qualified Data.ByteString            as B
import           GHC.Generics

import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Keccak256
import           Data.Map.Strict            (Map)
import qualified Data.IntSet                as I
import           Data.Text                  (Text)

data Environment =
    Environment {
      envOwner       :: Account,
      envOrigin      :: Account,
      envGasPrice    :: Integer,
      envInputData   :: B.ByteString,
      envSender      :: Account,
      envValue       :: Integer,
      envCode        :: Code,
      envJumpDests   :: I.IntSet,
      envBlockHeader :: BlockData,
      envTxHash      :: Keccak256,
      envChainId     :: Maybe Word256,
      envMetadata    :: Maybe (Map Text Text)
    } deriving (Show, Generic, NFData)
