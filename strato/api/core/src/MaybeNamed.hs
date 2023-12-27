{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module MaybeNamed where

import Control.Applicative ((<|>))
import Control.DeepSeq
import Data.Aeson
import Data.Swagger
import Data.Text (Text)
import GHC.Generics (Generic)
import Servant
import Test.QuickCheck

data MaybeNamed a = Named Text | Unnamed a
  deriving (Eq, Ord, Show, Generic, NFData)

instance ToJSON a => ToJSON (MaybeNamed a) where
  toJSON (Named _name) = toJSON _name
  toJSON (Unnamed a) = toJSON a

instance FromJSON a => FromJSON (MaybeNamed a) where
  parseJSON x = Unnamed <$> parseJSON x <|> Named <$> parseJSON x

instance Arbitrary a => Arbitrary (MaybeNamed a) where
  arbitrary =
    oneof
      [ elements [Named "name1", Named "name2", Named "name3"],
        Unnamed <$> arbitrary
      ]

instance ToHttpApiData a => ToHttpApiData (MaybeNamed a) where
  toUrlPiece (Named _name) = _name
  toUrlPiece (Unnamed a) = toUrlPiece a

instance FromHttpApiData a => FromHttpApiData (MaybeNamed a) where
  parseUrlPiece txt = case parseUrlPiece txt of
    Right a -> Right $ Unnamed a
    _ -> Right $ Named txt

instance ToParamSchema a => ToParamSchema (MaybeNamed a) where
  toParamSchema _ = toParamSchema (Proxy @a)
