
module Slipstream.Globals where

import Data.Map (Map)
import Data.Set (Set)

import BlockApps.Solidity.Contract



data Globals =
  Globals {
    contractCache :: Map String ContractAndXabi,
    createdContracts :: Set String
    }
  

data ContractAndXabi =
  ContractAndXabi {
    contract :: Either String Contract,
    xabi :: String,
    name :: String
  } deriving(Show)
