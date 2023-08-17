{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.SolidVM.Model where

import Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import Control.DeepSeq
import Control.Lens.Operators
import Data.Aeson
import Data.Aeson.Types
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Swagger
import Data.Swagger.Internal.Schema (named)
import qualified Data.Text as T
import Data.Text.Encoding
import GHC.Generics
import qualified LabeledError
import Test.QuickCheck
import Test.QuickCheck.Arbitrary.Generic
import Web.HttpApiData

newtype HexStorage = HexStorage B.ByteString
  deriving (Eq, Ord, Show, Read, Generic)
  deriving anyclass (NFData)

instance ToParamSchema HexStorage where
  toParamSchema _ = mempty & type_ ?~ SwaggerString

word256ToHexStorage :: Word256 -> HexStorage
word256ToHexStorage = HexStorage . word256ToBytes

instance ToHttpApiData HexStorage where
  toUrlPiece (HexStorage hs) = decodeUtf8 (B16.encode hs)

instance FromHttpApiData HexStorage where
  parseQueryParam t = case B16.decode (encodeUtf8 t) of
    Right hs -> pure $ HexStorage hs
    _ -> Left $ "non-hex string passed off as hex: " `T.append` t

instance ToSchema HexStorage where
  declareNamedSchema _ = return $ named "solidvm hex storage" binarySchema

instance ToJSON HexStorage where
  toJSON (HexStorage hs) = String . decodeUtf8 . B16.encode $ hs

instance FromJSON HexStorage where
  parseJSON (String t) = case B16.decode (encodeUtf8 t) of
    Right hs -> return $ HexStorage hs
    _ -> fail $ "non-hex string passed off as hex: " ++ show t
  parseJSON x = typeMismatch "HexStorage" x

data CodeKind
  = EVM
  | SolidVM
  deriving (Eq, Show, Enum, Ord, Read, Generic, NFData, ToSchema, Binary)

instance ToJSON CodeKind where
  toJSON = String . T.pack . show

instance FromJSON CodeKind where
  parseJSON (String t) = return . LabeledError.read "FromJSON/CodeKind" . T.unpack $ t
  parseJSON x = typeMismatch "CodeKind" x

instance Arbitrary CodeKind where
  arbitrary = genericArbitrary
