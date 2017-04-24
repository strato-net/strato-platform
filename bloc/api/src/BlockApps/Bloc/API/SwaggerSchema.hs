{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Bloc.API.SwaggerSchema

  ( -- ** Bloc's def
    blocSchemaOptions,

    -- ** re-exports
    plain,
    module Data.Swagger

  )
  where

import           Control.Lens                 ((&), (.~), (?~))
import           Data.Aeson.Casing.Internal   (camelCase, dropFPrefix)
import           Data.Monoid                  ()
import           Data.Swagger
import           Data.Swagger.Internal.Schema (plain)
import           Data.Swagger.SchemaOptions   (SchemaOptions (..),
                                               defaultSchemaOptions)
import           Numeric.Natural

-- | The model's field modifiers will match the JSON instances
blocSchemaOptions :: SchemaOptions
blocSchemaOptions = SchemaOptions
  { fieldLabelModifier = camelCase . dropFPrefix
  , constructorTagModifier = id
  , datatypeNameModifier = id
  , allNullaryToStringTag = True
  , unwrapUnaryRecords = True
  }

--------------------------------------------------------------------------------
-- | Orphans
--------------------------------------------------------------------------------

instance ToParamSchema Natural where
  toParamSchema _ =  mempty
    & type_ .~ SwaggerInteger
    & minimum_ ?~ fromInteger 0

instance ToSchema Natural where
  declareNamedSchema = plain . paramSchemaToSchema
