
module Blockchain.Data.ChainInfo
  ( ChainInfo (..)
  )
where

import Blockchain.Data.RLP

--Just a dummy value now, only used as a placeholder for p2p wire messages until all peers stop sending this chain info
data ChainInfo = ChainInfo deriving (Eq, Show)

instance RLPSerializable ChainInfo where
  rlpEncode ChainInfo = RLPArray []
  rlpDecode (RLPArray _) = ChainInfo
  rlpDecode o = error $ "rlpDecode ChainInfo: Expected RLPArray, got " ++ show o
