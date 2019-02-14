{-# OPTIONS_GHC -fno-warn-orphans  #-}

-- {-# OPTIONS_GHC -fno-warn-unused-top-binds #-}



module BlockApps.Ethereum
  ( 
    Address (..)
  , addressString
  , stringAddress
  , ChainId (..)
  , Keccak256 (..)
  ) where

import           Control.DeepSeq (NFData, rnf)
import           Crypto.Hash
import           Data.LargeWord
import           Data.Word
import           Numeric
import           Test.QuickCheck.Instances    ()
import           Text.Read              hiding (String)


instance (NFData a, NFData b) => NFData (LargeKey a b) where
  rnf (LargeKey a b) = rnf a `seq` rnf b `seq` ()

newtype Address = Address { unAddress :: Word160 }
  deriving (Eq, Ord, Show)

padZeros :: Int -> String -> String
padZeros n string = replicate (n - length string) '0' ++ string

show160 :: Word160 -> String
show160 (LargeKey w32 w128) = (show128 w128) ++ (show32 w32)

show128 :: Word128 -> String
show128 (LargeKey w1 w2) = (show64 w2) ++ (show64 w1)

show64 :: Word64 -> String
show64 w64 = padZeros 16 (showHex w64 "")

show32 :: Word32 -> String
show32 w32 = padZeros 8 (showHex w32 "")

addressString :: Address -> String
addressString (Address address) = show160 address

stringAddress :: String -> Maybe Address
stringAddress string = Address . fromInteger <$> readMaybe ("0x" ++ string)

--------------------------------------------------------------------------------

newtype ChainId = ChainId { unChainId :: Word256 }
  deriving (Eq, Ord, Show)

--------------------------------------------------------------------------------

newtype Keccak256 = Keccak256 { digestKeccak256 :: Digest Keccak_256 }
  deriving (Eq,Ord,Show)

