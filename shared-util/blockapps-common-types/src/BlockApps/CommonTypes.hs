{-# LANGUAGE OverloadedStrings #-}
module BlockApps.CommonTypes where

import Data.Aeson
import Data.Aeson.Types
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.Text as T
import Data.Text.Encoding

newtype HexStorage = HexStorage B.ByteString deriving (Eq, Show, Read)

instance ToJSON HexStorage where
  toJSON (HexStorage hs) = String . decodeUtf8 . B16.encode $ hs

instance FromJSON HexStorage where
  parseJSON (String t) = case B16.decode (encodeUtf8 t) of
    (hs, "") -> return $ HexStorage hs
    _ -> fail $ "non-hex string passed off as hex: " ++ show t
  parseJSON x = typeMismatch "HexStorage" x

data CodeKind = EVM
              | SolidVM
              deriving (Eq, Show, Enum, Ord, Read)

instance ToJSON CodeKind where
  toJSON = String . T.pack . show

instance FromJSON CodeKind where
  parseJSON (String t) = return . read . T.unpack $ t
  parseJSON x = typeMismatch "CodeKind" x
