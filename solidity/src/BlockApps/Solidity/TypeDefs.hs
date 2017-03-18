
module BlockApps.Solidity.TypeDefs where

import Data.Bimap (Bimap)
import Data.Map (Map)
import Data.Text (Text)

import BlockApps.Solidity.Struct

type EnumSet = Bimap Int Text
type EnumDefs = Map Text EnumSet
type StructDefs = Map Text Struct

data TypeDefs =
  TypeDefs {
    enumDefs::EnumDefs,
    structDefs::StructDefs
    } deriving (Show)  
