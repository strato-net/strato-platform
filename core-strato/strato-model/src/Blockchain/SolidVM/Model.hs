{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.SolidVM.Model where

import Control.DeepSeq
import Data.Aeson
import Data.Aeson.Types
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.DeriveTH
import qualified Data.Text as T
import Data.Text.Encoding
import GHC.Generics
import Test.QuickCheck

import Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)

newtype HexStorage = HexStorage B.ByteString
                   deriving (Eq, Show, Read, Generic)
                   deriving anyclass NFData

word256ToHexStorage :: Word256 -> HexStorage
word256ToHexStorage = HexStorage . word256ToBytes

instance ToJSON HexStorage where
  toJSON (HexStorage hs) = String . decodeUtf8 . B16.encode $ hs

instance FromJSON HexStorage where
  parseJSON (String t) = case B16.decode (encodeUtf8 t) of
    (hs, "") -> return $ HexStorage hs
    _ -> fail $ "non-hex string passed off as hex: " ++ show t
  parseJSON x = typeMismatch "HexStorage" x

data CodeKind = EVM
              | SolidVM
              deriving (Eq, Show, Enum, Ord, Read, Generic, NFData)

instance ToJSON CodeKind where
  toJSON = String . T.pack . show

instance FromJSON CodeKind where
  parseJSON (String t) = return . read . T.unpack $ t
  parseJSON x = typeMismatch "CodeKind" x

derive makeArbitrary ''CodeKind
