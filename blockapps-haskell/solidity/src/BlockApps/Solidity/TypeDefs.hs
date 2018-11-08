
module BlockApps.Solidity.TypeDefs where

import Data.Bimap (Bimap)
import Data.Map (Map)
import Data.Text (Text)

import BlockApps.Solidity.Struct

type EnumSet = Bimap Int Text

data TypeDefs =
  TypeDefs {
    enumDefs::Map Text EnumSet,
    structDefs::Map Text Struct
    } deriving (Show)
