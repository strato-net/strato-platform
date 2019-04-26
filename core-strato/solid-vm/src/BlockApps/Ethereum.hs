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

import           Control.DeepSeq
import           Crypto.Hash
import           Data.Binary
import           Data.Binary.Get
import           Data.Binary.Put
import           Data.ByteArray (convert)
import           Data.Maybe
import           GHC.Generics
import           Test.QuickCheck.Instances    ()
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Address

addressString :: Address -> String
addressString = formatAddress

--------------------------------------------------------------------------------

newtype ChainId = ChainId { unChainId :: Word256 }
  deriving (Eq, Ord, Show, Generic, NFData, Binary)

--------------------------------------------------------------------------------

newtype Keccak256 = Keccak256 { digestKeccak256 :: Digest Keccak_256 }
  deriving (Eq,Ord,Show,Generic,NFData)

instance Binary Keccak256 where
  put (Keccak256 digest) = putByteString $ convert digest
  get = do
    bs <- getByteString 32
    return . Keccak256
           . fromMaybe (error $ "keccak256 corruption: " ++ show bs)
           . digestFromByteString $ bs
