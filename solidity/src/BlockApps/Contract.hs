
module BlockApps.Contract where

import Data.Text (Text)
import Data.Map (Map)

import BlockApps.Types

data Contract =
  Contract{
    storageVars::Map Text Type
    }
  
