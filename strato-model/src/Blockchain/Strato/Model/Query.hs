module Blockchain.Strato.Model.Query where

import Blockchain.Strato.Model.SHA

data BlockQuery = GetBlocksByNumber [Int]
                | GetBlocksByHash [SHA]


data HeaderQuery = GetHeadersByNumbers [Int]
                 | GetHeadersByHash [SHA]

data TransactionQuery = GetTransactionsByBlockHash SHA
