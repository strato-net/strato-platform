
module Blockchain.Strato.Indexer.Model
  ( IndexEvent (..),
  )
where

import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs (EventDB, LogDB, TransactionResult)
import Blockchain.Data.TransactionResult ()
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256
import Data.Binary

data IndexEvent
  = RanBlock OutputBlock
  | NewBestBlock (Keccak256, Integer)
  | LogDBEntry LogDB
  | TxResult TransactionResult
  | UpdateTxResult (Keccak256, Keccak256, Keccak256, Bool) -- Deprecated
  | NewChainInfo Word256 ChainInfo
  | IndexTransaction Timestamp OutputTx
  | EventDBEntry EventDB
  | IndexPrivateTx OutputTx
  deriving (Eq, Show)

instance Binary IndexEvent where
  get = do
    tag <- getWord8
    case tag of
      0 -> RanBlock <$> get
      1 -> NewBestBlock <$> get
      2 -> LogDBEntry <$> get
      3 -> TxResult <$> get
      4 -> UpdateTxResult <$> get
      5 -> NewChainInfo <$> get <*> get
      6 -> IndexTransaction <$> get <*> get
      7 -> EventDBEntry <$> get
      8 -> IndexPrivateTx <$> get
      x -> error $ "Unknown IndexEvent tag in decode `" ++ show x ++ "`"

  put (RanBlock b) = putWord8 0 >> put b
  put (NewBestBlock n) = putWord8 1 >> put n
  put (LogDBEntry e) = putWord8 2 >> put e
  put (TxResult r) = putWord8 3 >> put r
  put (UpdateTxResult s) = putWord8 4 >> put s
  put (NewChainInfo w c) = putWord8 5 >> put w >> put c
  put (IndexTransaction t x) = putWord8 6 >> put t >> put x
  put (EventDBEntry e) = putWord8 7 >> put e
  put (IndexPrivateTx x) = putWord8 8 >> put x
