{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Data.CodeInfo
  ( CodeInfo (..)
  )
where

import Blockchain.Data.RLP
import Blockchain.MiscJSON ()

import Data.Aeson
--import Data.Swagger hiding (Format, format, name)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import qualified Data.Vector as V
import Text.Format
import Text.Tools

data CodeInfo = CodeInfo
  { codeInfoSource :: T.Text,
    codeInfoName :: Maybe T.Text
  }
  deriving (Show, Read, Eq)

instance Format CodeInfo where
  format CodeInfo {..} =
    unlines
      [ "CodeInfo",
        "--------",
        tab' $ "Name:   " ++ show codeInfoName,
        tab' $ "Source: " ++ show codeInfoSource
      ]

instance FromJSON CodeInfo where
  parseJSON (Array v) = do
    -- [a',b',c']

    let (b', c') = case V.toList v of
          [b, c] -> (b, c)
          _ -> error "tried to parse JSON for CodeInfo as an array with too many elements"
    b <- parseJSON b'
    c <- parseJSON c'
    return (CodeInfo b c)
  parseJSON (Object o) =
    CodeInfo
      <$> o .: "src"
      <*> o .: "name"
  parseJSON x = error $ "tried to parse JSON for " ++ show x ++ " as type CodeInfo"

instance ToJSON CodeInfo where
  toJSON (CodeInfo s1 s2) =
    object
      [ "src" .= s1,
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
  rlpEncode (CodeInfo b Nothing) =
    RLPArray [rlpEncode $ encodeUtf8 b]
  rlpEncode (CodeInfo b (Just c)) =
    RLPArray [rlpEncode $ encodeUtf8 b, rlpEncode $ encodeUtf8 c]
  rlpDecode (RLPArray [b]) = CodeInfo (decodeUtf8 $ rlpDecode b) Nothing
  rlpDecode (RLPArray [b, c]) = CodeInfo (decodeUtf8 $ rlpDecode b) (Just $ decodeUtf8 $ rlpDecode c)
  rlpDecode _ = error ("Error in rlpDecode for CodeInfo: bad RLPObject")

{-
instance ToSchema CodeInfo where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "CodeInfo")
        (mempty)
-}
