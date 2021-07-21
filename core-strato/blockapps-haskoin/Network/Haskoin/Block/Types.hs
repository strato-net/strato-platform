-- {-# OPTIONS -fno-warn-unused-top-binds #-}
-- {-# OPTIONS -fno-warn-unused-imports #-}

module Network.Haskoin.Block.Types
( 
  BlockHeader(..)
) where

import Data.Word (Word32)

import Network.Haskoin.Crypto.BigWord
data BlockHeader =
    BlockHeader {
                  -- | Block version information, based on the version of the
                  -- software creating this block.
                  blockVersion   :: !Word32
                  -- | Hash of the previous block (parent) referenced by this
                  -- block.
                , prevBlock      :: !BlockHash
                  -- | Root of the merkle tree of all transactions pertaining
                  -- to this block.
                , merkleRoot     :: !Word256
                  -- | Unix timestamp recording when this block was created
                , blockTimestamp :: !Word32
                  -- | The difficulty target being used for this block
                , blockBits      :: !Word32
                  -- | A random nonce used to generate this block. Additional
                  -- randomness is included in the coinbase transaction of
                  -- this block.
                , bhNonce        :: !Word32
                } deriving (Eq, Show, Read)
