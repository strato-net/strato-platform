
module BlockApps.Solidity.Struct where

import           Network.Haskoin.Crypto
import           Data.Map.Ordered        (OMap)
import           Data.Text               (Text)

import           BlockApps.Solidity.Type
import qualified BlockApps.Storage       as Storage

data Struct = Struct { fields::OMap Text (Either Text Storage.Position, Type) , size::Word256 } deriving (Show)
