
module BlockApps.Contract where

import Data.Text (Text)
import Data.Map (Map)

import qualified BlockApps.Storage as Storage
import BlockApps.Types

data Contract =
  Contract{
    storageVars::Map Text (Storage.Position, Type)
    } deriving (Show)
  
