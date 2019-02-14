
module Account where

import Data.Map (Map)
import qualified Data.Map as M

import CodeCollection
import Value

data Account =
  Account {
    nonce :: Integer,
    balance :: Integer,
    storage :: Map String Variable,
    contract :: (String, CodeCollection)
  } deriving (Show)



initialAccount :: Account
initialAccount =
  Account {
    nonce=0,
    balance=0,
    storage=M.empty,
    contract=("", emptyCodeCollection)
  }
