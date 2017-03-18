
module BlockApps.Solidity.Struct where

import Data.Map (Map)
import Data.Text (Text)

import qualified BlockApps.Storage as Storage
import BlockApps.Solidity.Type

data Struct =
  Struct {
    fields::Map Text (Storage.Position, Type),
    size::Int
    } deriving (Show)

fieldsToStruct::[(Text, Type)]->Struct
fieldsToStruct _ =
  Struct {
    fields=undefined,
    size=32
    }
