{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}

-- | Receipt persistence layer used by the indexer.
--
-- The vm-runner emits per-block receipt RLP bytes alongside RanBlock; the
-- ApiIndexer stores them in the @receipt_ref@ table so strato-api can serve
-- them (and rebuild the receipts trie for inclusion proofs) without touching
-- LevelDB or re-running the VM.
module Blockchain.Data.ReceiptRef
  ( putReceiptRefs,
    receiptRefsForBlock,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import qualified Database.Esqueleto.Legacy as E
import qualified Database.Persist.Postgresql as SQL

-- | Bulk-insert receipt-ref rows. Idempotent at the @(blockHash, txIndex)@
-- key per the schema's @UniqueReceiptRefBlockTx@; duplicate inserts are
-- swallowed via @insertUnique_@.
putReceiptRefs :: HasSQLDB m => [ReceiptRef] -> m ()
putReceiptRefs refs = sqlQuery $ mapM_ SQL.insertUnique_ refs

-- | Fetch all receipts for a block, in tx-index order. The bytes here are
-- exactly what the vm-runner persisted at block construction time -- safe to
-- feed directly into 'addAllKVs' to reproduce the header's receipts root.
receiptRefsForBlock :: HasSQLDB m => Keccak256 -> m [ReceiptRef]
receiptRefsForBlock bh =
  fmap (map E.entityVal) . sqlQuery $
    E.select $
      E.from $ \rr -> do
        E.where_ $ rr E.^. ReceiptRefBlockHash E.==. E.val bh
        E.orderBy [E.asc (rr E.^. ReceiptRefTxIndex)]
        return rr
