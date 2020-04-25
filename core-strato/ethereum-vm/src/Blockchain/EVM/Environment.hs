module Blockchain.EVM.Environment where

import           Control.DeepSeq
import qualified Data.ByteString            as B
import           GHC.Generics

import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.SHA
import           Data.Map.Strict            (Map)
import qualified Data.IntSet                as I
import           Data.Text                  (Text)

data Environment =
    Environment {
      envOwner       :: Address,
      envOrigin      :: Address,
      envGasPrice    :: Integer,
      envInputData   :: B.ByteString,
      envSender      :: Address,
      envValue       :: Integer,
      envCode        :: Code,
      envJumpDests   :: I.IntSet,
      envBlockHeader :: BlockData,
      envTxHash      :: SHA,
      envChainId     :: Maybe Word256,
      envMetadata    :: Maybe (Map Text Text)
    } deriving (Show, Generic, NFData)
