
module Blockchain.Strato.Indexer.Model
  ( IndexEvent (..),
  )
where

import Blockchain.Data.DataDefs (EventDB, LogDB, TransactionResult)
import Blockchain.Data.TransactionResult ()
import Blockchain.DB.MemAddressStateDB (AddressStateModification)
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.StateDiff (StateDiff)
import Data.Binary
import Data.Map (Map)

data IndexEvent
  = RanBlock OutputBlock
  | NewBestBlock (Keccak256, Integer)
  | LogDBEntry LogDB
  | TxResult TransactionResult
  | UpdateTxResult (Keccak256, Keccak256, Keccak256, Bool) -- Deprecated
  | IndexTransaction Timestamp OutputTx
  | EventDBEntry EventDB
  | StateDiffEntry StateDiff
  | AddressStateUpdates (Map Address AddressStateModification)
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
      6 -> IndexTransaction <$> get <*> get
      7 -> EventDBEntry <$> get
      8 -> StateDiffEntry <$> get
      9 -> AddressStateUpdates <$> get
      x -> error $ "Unknown IndexEvent tag in decode `" ++ show x ++ "`"

  put (RanBlock b) = putWord8 0 >> put b
  put (NewBestBlock n) = putWord8 1 >> put n
  put (LogDBEntry e) = putWord8 2 >> put e
  put (TxResult r) = putWord8 3 >> put r
  put (UpdateTxResult s) = putWord8 4 >> put s
  put (IndexTransaction t x) = putWord8 6 >> put t >> put x
  put (EventDBEntry e) = putWord8 7 >> put e
  put (StateDiffEntry d) = putWord8 8 >> put d
  put (AddressStateUpdates m) = putWord8 9 >> put m
