{-# LANGUAGE DeriveGeneric #-}

module BlockApps.VaultWrapper.Types where

import           Data.Aeson
import           Network.Haskoin.Crypto          (Word256)
import           Data.Word               (Word8)
import           GHC.Generics

import           BlockApps.Ethereum      (Hex(..))

data SignatureDetails = SignatureDetails
  { r :: Hex Word256
  , s :: Hex Word256
  , v :: Hex Word8
  } deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails

data UserData = UserData {
  msgHash :: Hex Word256
} deriving (Eq, Show, Generic)

userData :: Word256 -> UserData
userData = UserData . Hex

instance ToJSON UserData
instance FromJSON UserData
