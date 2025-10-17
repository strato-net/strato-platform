{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}

module SolidVM.Model.CodeCollection.Visibility
  ( Visibility (..)
  , tShowVisibility
  )
where

import Control.DeepSeq
import Control.Lens (mapped, (&), (?~))
import Data.Aeson
import Data.Aeson.Casing
import Data.Aeson.Casing.Internal (dropFPrefix)
import Data.Binary
import Data.Swagger
import Data.Text (Text)
import GHC.Generics
import qualified Generic.Random as GR
import Test.QuickCheck
import Test.QuickCheck.Instances ()

data Visibility
  = Private
  | Public
  | Internal
  | External
  deriving (Eq, Show, Generic, NFData)

tShowVisibility :: Visibility -> Text
tShowVisibility Private = "private"
tShowVisibility Public = "public"
tShowVisibility Internal = "internal"
tShowVisibility External = "external"

instance Binary Visibility

instance ToJSON Visibility where
  toJSON = String . tShowVisibility

instance FromJSON Visibility

instance Arbitrary Visibility where arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema Visibility where
  declareNamedSchema proxy =
    genericDeclareNamedSchema schemaOptions proxy
      & mapped . name ?~ "Visibility of a Function"
      & mapped . schema . description ?~ "SolidVM Function Visibility"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: Visibility
      ex = Public
      schemaOptions :: SchemaOptions
      schemaOptions =
        SchemaOptions
          { Data.Swagger.fieldLabelModifier = camelCase . dropFPrefix,
            Data.Swagger.constructorTagModifier = id,
            Data.Swagger.datatypeNameModifier = id,
            Data.Swagger.allNullaryToStringTag = True,
            Data.Swagger.unwrapUnaryRecords = True
          }