module BlockApps.Ethereum2
  ( Keccak256 (..),
  )
where

import Crypto.Hash

newtype Keccak256 = Keccak256 (Digest Keccak_256) -- { digestKeccak256 :: Digest Keccak_256 }
  deriving (Show, Eq)
