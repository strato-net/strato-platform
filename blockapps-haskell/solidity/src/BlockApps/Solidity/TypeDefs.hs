{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
-- {-# OPTIONS_GHC -fno-warn-orphans #-}
module BlockApps.Solidity.TypeDefs where

import Control.DeepSeq
import Data.Bimap (Bimap) -- , toList)
import Data.Map (Map)
import Data.Text (Text)
import GHC.Generics

import BlockApps.Solidity.Struct

type EnumSet = Bimap Int Text

data TypeDefs =
  TypeDefs {
    enumDefs::Map Text EnumSet,
    structDefs::Map Text Struct
    } deriving (Show, Generic, NFData)
