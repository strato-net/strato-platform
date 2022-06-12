{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Bloc22.API.TypeWrappers where

import           Control.Applicative
import           Data.Aeson
import           Data.Proxy
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named)
import           Data.Word
import qualified Generic.Random               as GR
import           GHC.Generics
import           Numeric.Natural
import           Test.QuickCheck
import           Text.Read


import           BlockApps.Ethereum
import           Blockchain.Strato.Model.ExtendedWord

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
newtype Strung x = Strung { unStrung :: x } deriving (Eq, Show, Generic)

instance Show x => ToJSON (Strung x) where
  toJSON = toJSON . show . unStrung
    
instance (FromJSON x, Read x) => FromJSON (Strung x) where
  parseJSON value = Strung <$> parseJSON value <|> do
    string <- parseJSON value
    case readMaybe string of
      Nothing -> fail $ "cannot decode Strung: " ++ string
      Just y  -> return $ Strung y

instance Arbitrary x => Arbitrary (Strung x) where
  arbitrary = GR.genericArbitrary GR.uniform
  
instance ToSchema x => ToSchema (Strung x) where
  declareNamedSchema _ = declareNamedSchema (Proxy :: Proxy x)
