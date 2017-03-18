
module BlockApps.Solidity.Struct where

import Data.Text (Text)

import BlockApps.Solidity.Type

data Struct =
  Struct {
    fields::[(Text, Type)],
    size::Int
    } deriving (Show)

fieldsToStruct::[(Text, Type)]->Struct
fieldsToStruct _ =
  Struct {
    fields=undefined,
    size=32
    }
