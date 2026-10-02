{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

-- | The API indexer's durable progress marker.
--
-- @indexer_progress@ holds, per writer, the highest block number whose block
-- row, transactions, receipts and state diffs are all committed. The indexer
-- updates it inside the same transaction as those writes, so the marker
-- never claims a block whose rows are missing. A standby core promoted to
-- writer reads it to know where to resume, and it is the authoritative
-- "eth tables tip" for health checks.
module Blockchain.Data.IndexerProgress
  ( apiIndexerProgressRow,
    setIndexerProgressSql,
    getIndexerProgressSql,
    getIndexerProgress,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Control.Monad (void)
import Control.Monad.IO.Class (MonadIO)
import Data.Text (Text)
import qualified Database.Persist.Postgresql as SQL

-- | Row name for the API indexer. There is one writer per database, so one row.
apiIndexerProgressRow :: Text
apiIndexerProgressRow = "strato-indexer"

-- | Record that every block at or below @n@ is fully committed. Run this
-- inside the transaction that commits those blocks. The marker never moves
-- backwards, so replaying an already-applied batch after a crash is harmless.
setIndexerProgressSql :: MonadIO m => Integer -> SQL.SqlPersistT m ()
setIndexerProgressSql n = do
  void . SQL.insertUnique $ IndexerProgress apiIndexerProgressRow n
  SQL.updateWhere
    [IndexerProgressName SQL.==. apiIndexerProgressRow, IndexerProgressBlockNumber SQL.<. n]
    [IndexerProgressBlockNumber SQL.=. n]

getIndexerProgressSql :: MonadIO m => SQL.SqlPersistT m (Maybe Integer)
getIndexerProgressSql =
  fmap (indexerProgressBlockNumber . SQL.entityVal)
    <$> SQL.getBy (UniqueIndexerProgressName apiIndexerProgressRow)

-- | 'Nothing' until the indexer has committed its first batch.
getIndexerProgress :: HasSQLDB m => m (Maybe Integer)
getIndexerProgress = sqlQuery getIndexerProgressSql
