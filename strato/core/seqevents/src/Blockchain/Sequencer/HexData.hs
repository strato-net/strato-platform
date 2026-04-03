{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Sequencer.HexData
  ( HexData (..),
  )
where

import Data.Aeson (FromJSON (..), ToJSON (..), withText)
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Data (Data)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8, decodeUtf8)
import GHC.Generics (Generic)

newtype HexData = HexData { unHexData :: B.ByteString }
  deriving (Show, Read, Eq, Data, Generic)

instance Binary HexData

strip0x :: Text -> Text
strip0x t = case T.stripPrefix "0x" t of
  Just rest -> rest
  Nothing -> t

instance FromJSON HexData where
  parseJSON = withText "HexData" $ \t ->
    case B16.decode (encodeUtf8 $ strip0x t) of
      Right bs -> pure $ HexData bs
      Left err -> fail $ "invalid hex: " ++ err

instance ToJSON HexData where
  toJSON (HexData bs) = toJSON $ T.append "0x" (decodeUtf8 $ B16.encode bs)
