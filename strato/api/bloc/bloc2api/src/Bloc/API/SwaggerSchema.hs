{-# LANGUAGE OverloadedStrings #-}

module Bloc.API.SwaggerSchema
  ( blocSchemaOptions,
    -- | ** Bloc's def
    named,
    module Data.OpenApi,
  )
where

import Data.Aeson.Casing.Internal (camelCase, dropFPrefix)
import Data.OpenApi
import Data.OpenApi.Internal.Schema (named)

-- | The model's field modifiers will match the JSON instances
blocSchemaOptions :: SchemaOptions
blocSchemaOptions =
  defaultSchemaOptions
    { Data.OpenApi.fieldLabelModifier = camelCase . dropFPrefix
    }
