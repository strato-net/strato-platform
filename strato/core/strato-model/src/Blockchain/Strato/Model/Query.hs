module Blockchain.Strato.Model.Query where

import Blockchain.Strato.Model.Keccak256

data BlockQuery
  = GetBlocksByNumber [Int]
  | GetBlocksByHash [Keccak256]

data HeaderQuery
  = GetHeadersByNumbers [Int]
  | GetHeadersByHash [Keccak256]

data TransactionQuery = GetTransactionsByBlockHash Keccak256
