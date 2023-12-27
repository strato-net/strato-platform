{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Bloc.API.AbiBin where

import Data.Aeson
import Data.Swagger
import Data.Text (Text)
import GHC.Generics
import Test.QuickCheck.Instances ()

data AbiBin = AbiBin
  { abi :: Text,
    bin :: Text,
    binRuntime :: Text
  }
  deriving (Eq, Show, Generic)

instance FromJSON AbiBin where
  parseJSON = withObject "AbiBin" $ \obj ->
    AbiBin
      <$> obj .: "abi"
      <*> obj .: "bin"
      <*> obj .: "bin-runtime"

instance ToJSON AbiBin where
  toJSON AbiBin {..} =
    object
      [ "abi" .= abi,
        "bin" .= bin,
        "bin-runtime" .= binRuntime
      ]

instance ToSchema AbiBin
