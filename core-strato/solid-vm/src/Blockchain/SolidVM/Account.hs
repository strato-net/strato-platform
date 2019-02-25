
module Blockchain.SolidVM.Account where

import qualified Blockchain.Database.MerklePatricia as MP

import CodeCollection

data Account =
  Account {
    nonce :: Integer,
    balance :: Integer,
    storage :: MP.StateRoot,
    contract :: (String, CodeCollection)
  } deriving (Show)



initialAccount :: Account
initialAccount =
  Account {
    nonce=0,
    balance=0,
    storage=MP.emptyTriePtr,
    contract=("", emptyCodeCollection)
  }
