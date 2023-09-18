{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}

module Data.Source.Map
  ( SourceMap (..),
    namedSource,
    unnamedSource,
    sourceBlob,
    isUnnamedSource,
    hasAnyNonEmptySources,
    serializeSourceMap,
    deserializeSourceMap,
  )
where

import Blockchain.Data.RLP
import Control.DeepSeq
import Control.Lens
import Data.Aeson as Aeson
import Data.Binary
import qualified Data.ByteString.Lazy as BL
import Data.Data
import Data.Hashable (Hashable)
import qualified Data.Map.Strict as M
import Data.Swagger
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

newtype SourceMap = SourceMap {unSourceMap :: [(Text, Text)]}
  deriving (Eq, Show, Generic, Data, Hashable, Semigroup, Monoid)

instance ToJSON SourceMap where
  toJSON (SourceMap [("", src)]) = toJSON src
  toJSON (SourceMap src) = toJSON src

instance FromJSON SourceMap where
  parseJSON (String s) = pure $ unnamedSource s
  parseJSON o@(Object _) = SourceMap . M.toList <$> parseJSON o
  parseJSON a@(Array _) = SourceMap <$> parseJSON a
  parseJSON o = fail $ "parseJSON SourceMap: Expected String, Object, or Array, got " ++ show o

instance Arbitrary SourceMap where
  arbitrary = SourceMap <$> arbitrary

instance ToSchema SourceMap where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "SourceMap")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ toJSON (namedSource "SimpleStorage.sol" "contract SimpleStorage { }")
            & description ?~ "SourceMap"
        )

instance Binary SourceMap

instance NFData SourceMap

instance RLPSerializable SourceMap where
  rlpEncode = rlpEncode . BL.toStrict . Aeson.encode
  rlpDecode = either error id . Aeson.eitherDecode . BL.fromStrict . rlpDecode

namedSource :: Text -> Text -> SourceMap
namedSource filename src = SourceMap [(filename, src)]

unnamedSource :: Text -> SourceMap
unnamedSource = namedSource ""

sourceBlob :: SourceMap -> Text
sourceBlob (SourceMap srcs) = T.intercalate "\n" $ snd <$> srcs

isUnnamedSource :: SourceMap -> Bool
isUnnamedSource (SourceMap [("", _)]) = True
isUnnamedSource _ = False

hasAnyNonEmptySources :: SourceMap -> Bool
hasAnyNonEmptySources (SourceMap src) = any (/= 0) $ T.length . snd <$> src

serializeSourceMap :: SourceMap -> Text
serializeSourceMap src
  | isUnnamedSource src = sourceBlob src
  | otherwise = decodeUtf8 . BL.toStrict $ Aeson.encode src

deserializeSourceMap :: Text -> SourceMap
deserializeSourceMap src = case Aeson.decode (BL.fromStrict $ encodeUtf8 src) of
  Nothing -> unnamedSource src
  Just x -> x
