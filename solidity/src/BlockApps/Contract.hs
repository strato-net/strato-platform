
module BlockApps.Contract where

import Data.Bimap (Bimap)
import Data.Map (Map)
import Data.Text (Text)

import qualified BlockApps.Storage as Storage
import BlockApps.Types

data Contract =
  Contract{
    storageVars::Map Text (Storage.Position, Type),
    enumDefs::Bimap Int Text
    } deriving (Show)
  
