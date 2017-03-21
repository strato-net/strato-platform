
module BlockApps.Solidity.Struct where

import Data.LargeWord
import Data.Map (Map)
import Data.Text (Text)

import qualified BlockApps.Storage as Storage
import BlockApps.Solidity.Type

data Struct =
  Struct {
    fields::Map Text (Storage.Position, Type),
    size::Word256
    } deriving (Show)

