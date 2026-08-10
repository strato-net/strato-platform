{-# LANGUAGE OverloadedStrings #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}
module Bloc.API.SwaggerSchema
  ( blocSchemaOptions,
    -- | ** Bloc's def
    named,
    module Data.OpenApi,
  )
where

import Data.Aeson (Value)
import Data.Aeson.Casing.Internal (camelCase, dropFPrefix)
import Data.OpenApi
import Data.OpenApi.Internal.Schema (named)

-- | The model's field modifiers will match the JSON instances
blocSchemaOptions :: SchemaOptions
blocSchemaOptions =
  defaultSchemaOptions
    { Data.OpenApi.fieldLabelModifier = camelCase . dropFPrefix
    }

-- Orphan needed by API types carrying raw JSON payloads (e.g. simulation
-- traces); previously lived in strato-api's Main.hs.
instance ToSchema Value where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "JSON Value") mempty
