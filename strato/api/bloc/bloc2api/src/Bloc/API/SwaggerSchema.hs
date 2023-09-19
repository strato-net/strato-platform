{-# LANGUAGE OverloadedStrings #-}

module Bloc.API.SwaggerSchema
  ( blocSchemaOptions,
    -- | ** Bloc's def
    named,
    module Data.Swagger,
  )
where

import Data.Aeson.Casing.Internal (camelCase, dropFPrefix)
import Data.Swagger
import Data.Swagger.Internal.Schema (named)

-- | The model's field modifiers will match the JSON instances
blocSchemaOptions :: SchemaOptions
blocSchemaOptions =
  SchemaOptions
    { fieldLabelModifier = camelCase . dropFPrefix,
      constructorTagModifier = id,
      datatypeNameModifier = id,
      allNullaryToStringTag = True,
      unwrapUnaryRecords = True
    }
