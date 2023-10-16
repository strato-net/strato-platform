{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.API.TypeWrappers where

import Blockchain.Strato.Model.ExtendedWord
import Control.Applicative
import Data.Aeson
import Data.Proxy
import Data.Swagger
import Data.Swagger.Internal.Schema (named)
import Data.Word
import GHC.Generics
import Generic.Random
import qualified Generic.Random as GR
import Numeric
import Numeric.Natural
import Test.QuickCheck
import Text.Read
import Text.Read.Lex

newtype Hex n = Hex {unHex :: n} deriving (Eq, Generic, Ord)

instance (Integral n, Show n) => Show (Hex n) where
  show (Hex n) = showHex (toInteger n) ""

instance (Eq n, Num n) => Read (Hex n) where
  readPrec = Hex <$> readP_to_Prec (const readHexP)

--I'm not sure what `d` precision parameter is used for

instance Num n => FromJSON (Hex n) where
  parseJSON value = do
    string <- parseJSON value
    case fmap fromInteger (readMaybe ("0x" ++ string)) of
      Nothing -> fail $ "not hex encoded: " ++ string
      Just n -> return $ Hex n

instance (Integral n, Show n) => ToJSON (Hex n) where
  toJSON = toJSON . show

instance Arbitrary x => Arbitrary (Hex x) where
  arbitrary = genericArbitrary uniform

{-
instance ToSchema (Hex Word160) where
  declareNamedSchema = const . pure $ named "hex word160" binarySchema
-}
instance ToSchema (Hex Word256) where
  declareNamedSchema = const . pure $ named "hex word256" binarySchema

instance ToSchema (Hex Word8) where
  declareNamedSchema = const . pure $ named "hex word8" binarySchema

instance ToSchema (Hex Natural) where
  declareNamedSchema = const . pure $ named "hex natural" $ sketchSchema (Hex (8 :: Natural))

-- hack to deal with weird `ToJSON`s
newtype Strung x = Strung {unStrung :: x} deriving (Eq, Show, Generic)

instance Show x => ToJSON (Strung x) where
  toJSON = toJSON . show . unStrung

instance (FromJSON x, Read x) => FromJSON (Strung x) where
  parseJSON value =
    Strung <$> parseJSON value <|> do
      string <- parseJSON value
      case readMaybe string of
        Nothing -> fail $ "cannot decode Strung: " ++ string
        Just y -> return $ Strung y

instance Arbitrary x => Arbitrary (Strung x) where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema x => ToSchema (Strung x) where
  declareNamedSchema _ = declareNamedSchema (Proxy :: Proxy x)
