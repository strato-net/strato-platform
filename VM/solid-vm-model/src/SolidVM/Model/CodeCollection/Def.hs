{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module SolidVM.Model.CodeCollection.Def where

import           Control.Lens                 (mapped, (&), (?~))
import           Data.Aeson
import           Data.Source
import           Data.Swagger
import           Data.Text                    (Text)
import qualified Generic.Random               as GR
import           GHC.Generics
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()


import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM

defAesonOptions :: Options
defAesonOptions = defaultOptions{sumEncoding=defaultTaggedObject{tagFieldName="type"}}

data DefF a = Enum { names::[Text], bytes::Word, context :: a}
            | Struct { fields::[(Text, SolidVM.FieldType)], bytes::Word, context :: a}
            | Contract { bytes::Word, context :: a}
         deriving (Eq, Show, Generic, Functor)

type Def = Positioned DefF

instance Arbitrary a => Arbitrary (DefF a) where arbitrary = GR.genericArbitrary GR.uniform
instance ToJSON a => ToJSON (DefF a) where
  toJSON = genericToJSON defAesonOptions
instance FromJSON a => FromJSON (DefF a) where
  parseJSON = genericParseJSON defAesonOptions

instance ToSchema Def where
  declareNamedSchema proxy = genericDeclareNamedSchema defaultSchemaOptions proxy
    & mapped.name ?~ "TypeDef"
    & mapped.schema.description ?~ "User defined type (Struct or Enum)"
    & mapped.schema.example ?~ toJSON (Enum ["SUCCESS", "FAILURE", "NOT_AUTHORIZED"]
                                            0xdeadbeef
                                            (SourcePosition "A.sol" 0 0))
