{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.VaultWrapper.Types where

import           Data.Aeson
import           Data.LargeWord          (Word256)
import           Data.Text               (Text)
import           Data.Word               (Word8)
import           GHC.Generics

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

userData :: Word256 -> UserData
userData = UserData . Hex

instance ToJSON UserData
instance FromJSON UserData

--------------------------------------------------------------------------

newtype StatusAndAddress = StatusAndAddress { unStatusAndAddress :: Address } deriving (Show, Generic)

instance ToJSON StatusAndAddress where
  toJSON (StatusAndAddress a) = object
                              [ "status" .= ("success" :: Text) -- hey, don't blame me, this is part of the spec
                              , "address" .= a
                              ]

instance FromJSON StatusAndAddress where
  parseJSON (Object o) = StatusAndAddress <$> (o .: "address")
  parseJSON o = error $ "parseJSON StatusAndAddress: expected object, but got " ++ show o
