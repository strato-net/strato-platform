{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Data.CodeInfoOld
  ( CodeInfo (..)
  )
where

import Blockchain.Data.RLP
import Blockchain.MiscJSON ()

import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
--import Data.Swagger hiding (Format, format, name)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import qualified Data.Vector as V
import LabeledError
import Text.Format
import Text.Tools

data CodeInfo = CodeInfo
  { codeInfoCode :: B.ByteString,
    codeInfoSource :: T.Text,
    codeInfoName :: Maybe T.Text
  }
  deriving (Show, Read, Eq)

instance Format CodeInfo where
  format CodeInfo {..} =
    unlines
      [ "CodeInfo",
        "--------",
        tab' $ "Name:   " ++ show codeInfoName,
        tab' $ "Source: " ++ show codeInfoSource,
        tab' $ "Code:   " ++ show (decodeUtf8 $ B16.encode codeInfoCode)
      ]

instance FromJSON CodeInfo where
  parseJSON (Array v) = do
    -- [a',b',c']

    let (a', b', c') = case V.toList v of
          [a, b, c] -> (a, b, c)
          _ -> error "tried to parse JSON for CodeInfo as an array with too many elements"
    a <- parseJSON a'
    b <- parseJSON b'
    c <- parseJSON c'
    return (CodeInfo (LabeledError.b16Decode "FromJSON<CodeInfo>" $ C8.pack a) b c)
  parseJSON (Object o) =
    CodeInfo
      <$> ((LabeledError.b16Decode "FromJSON<CodeInfo>" . C8.pack) <$> (o .: "code"))
      <*> o .: "src"
      <*> o .: "name"
  parseJSON x = error $ "tried to parse JSON for " ++ show x ++ " as type CodeInfo"

instance ToJSON CodeInfo where
  toJSON (CodeInfo bs s1 s2) =
    object
      [ "code" .= (C8.unpack $ B16.encode bs),
        "src" .= s1,
        "name" .= s2
      ]
{-
instance Arbitrary CodeInfo where
  arbitrary =
    CodeInfo
      <$> arbitrary
      <*> (T.pack <$> arbitrary)
      <*> (fmap T.pack <$> arbitrary)
-}
instance RLPSerializable CodeInfo where
  rlpEncode (CodeInfo a b Nothing) =
    RLPArray [rlpEncode a, rlpEncode $ encodeUtf8 b]
  rlpEncode (CodeInfo a b (Just c)) =
    RLPArray [rlpEncode a, rlpEncode $ encodeUtf8 b, rlpEncode $ encodeUtf8 c]
  rlpDecode (RLPArray [a, b]) = CodeInfo (rlpDecode a) (decodeUtf8 $ rlpDecode b) Nothing
  rlpDecode (RLPArray [a, b, c]) = CodeInfo (rlpDecode a) (decodeUtf8 $ rlpDecode b) (Just $ decodeUtf8 $ rlpDecode c)
  rlpDecode _ = error ("Error in rlpDecode for CodeInfo: bad RLPObject")

{-
instance ToSchema CodeInfo where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "CodeInfo")
        (mempty)
-}
