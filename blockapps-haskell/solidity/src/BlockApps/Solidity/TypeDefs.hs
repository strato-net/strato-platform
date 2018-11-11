{-# OPTIONS_GHC -fno-warn-orphans #-}
module BlockApps.Solidity.TypeDefs where

import Control.DeepSeq
import Data.Bimap (Bimap, toList)
import Data.Map (Map)
import Data.Text (Text)
import GHC.Generics

import BlockApps.Solidity.Struct

type EnumSet = Bimap Int Text

instance (NFData a, NFData b) => NFData (Bimap a b) where
  rnf = rnf . toList

data TypeDefs =
  TypeDefs {
    enumDefs::Map Text EnumSet,
    structDefs::Map Text Struct
    } deriving (Show, Generic, NFData)
