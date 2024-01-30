{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module SolidVM.Model.CodeCollection.Def where

import Control.DeepSeq
import Control.Lens (mapped, (&), (?~))
import Data.Aeson
import Data.Binary
import Data.Source
import Data.Swagger
import GHC.Generics
import qualified Generic.Random as GR
import qualified SolidVM.Model.CodeCollection.VarDef as SolidVM
import SolidVM.Model.SolidString
import Test.QuickCheck
import Test.QuickCheck.Instances ()

defAesonOptions :: Options
defAesonOptions = defaultOptions

data DefF a
  = Enum {names :: [SolidString], bytes :: Word, context :: a}
  | Error {params :: [(SolidString, SolidVM.IndexedType)], bytes :: Word, context :: a}
  | Struct {fields :: [(SolidString, SolidVM.FieldType)], bytes :: Word, context :: a}
  | Contract {bytes :: Word, context :: a}
  deriving (Eq, Show, Generic, NFData, Functor)

type Def = Positioned DefF

instance Binary a => Binary (DefF a)

instance Arbitrary a => Arbitrary (DefF a) where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON a => ToJSON (DefF a) where
  toJSON = genericToJSON defAesonOptions

instance FromJSON a => FromJSON (DefF a) where
  parseJSON = genericParseJSON defAesonOptions

instance ToSchema Def where
  declareNamedSchema proxy =
    genericDeclareNamedSchema defaultSchemaOptions proxy
      & mapped . name ?~ "TypeDef"
      & mapped . schema . description ?~ "User defined type (Struct or Enum)"
      & mapped . schema . example
        ?~ toJSON
          ( Enum
              ["SUCCESS", "FAILURE", "NOT_AUTHORIZED"]
              0xdeadbeef
              (SourcePosition "A.sol" 0 0)
          )
