{-# OPTIONS_GHC -fno-warn-orphans  #-}

-- {-# OPTIONS_GHC -fno-warn-unused-top-binds #-}



module BlockApps.Ethereum
  (
    Address(..)
  , stringAddress
  , addressString
  , ChainId (..)
  , Keccak256 (..)
  ) where

import           Crypto.Hash
import           Test.QuickCheck.Instances    ()
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Address

addressString :: Address -> String
addressString = formatAddress

--------------------------------------------------------------------------------

newtype ChainId = ChainId { unChainId :: Word256 }
  deriving (Eq, Ord, Show)

--------------------------------------------------------------------------------

newtype Keccak256 = Keccak256 { digestKeccak256 :: Digest Keccak_256 }
  deriving (Eq,Ord,Show)
