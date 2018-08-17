{-# LANGUAGE DeriveGeneric #-}

module BlockApps.VaultWrapper.API where

import           Data.Aeson
import           Data.LargeWord          (Word256)
import           Data.Text               (Text)
import           Data.Word               (Word8)
import           Servant.API

import           BlockApps.Ethereum      (Hex(..), Address(..))

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

instance ToJSON UserData
instance FromJSON UserData
