module Blockchain.Data.Log (
  Log(..)
  ) where

import           Blockchain.Strato.Model.Account
import           Control.DeepSeq
import qualified Data.ByteString           as B
import           GHC.Generics
import           Network.Haskoin.Internals (Word256, Word512)

data Log =
  Log {
    account :: Account,
    bloom   :: Word512,
    logData :: B.ByteString,
    topics  :: [Word256]
    } deriving (Eq, Read, Show, Generic)

instance NFData Log
