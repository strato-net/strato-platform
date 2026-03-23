{-# LANGUAGE OverloadedStrings #-}

module Model.HexData
  ( HexData (..),
  )
where

import Data.Aeson (FromJSON (..), ToJSON (..), withText)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8, decodeUtf8)

newtype HexData = HexData { unHexData :: B.ByteString }
  deriving (Show, Eq)

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
