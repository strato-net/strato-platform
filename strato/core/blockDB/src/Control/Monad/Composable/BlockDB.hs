{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Control.Monad.Composable.BlockDB
  ( BlockDBEnv,
    BlockDBM,
    HasBlockDB,
    runBlockDB,
    getBlockHeader,
    getCanonicalBlockHeaders,
    getBlockBodies,
  ) where

import Blockchain.DB.SQLDB (SQLDB, runSqlPool)
import Blockchain.Data.Block (blockBlockData)
import Blockchain.Data.BlockHeader (BlockHeader)
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction (Transaction, rawTX2TX)
import Blockchain.Model.JsonBlock (getBlockSql, getBlocksSql)
import Blockchain.Strato.Model.Class (blockHeaderBlockNumber)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Control.Monad.Composable.Base
import qualified Data.Map.Strict as M
import qualified Database.Esqueleto.Legacy as E
import qualified Database.Persist.Sql as SQL
import UnliftIO (MonadUnliftIO)

newtype BlockDBEnv = BlockDBEnv SQLDB

type BlockDBM es = Eff (BlockDBEnv ': es)

type HasBlockDB m = (MonadUnliftIO m, AccessibleEnv BlockDBEnv m)

runBlockDB :: SQLDB -> BlockDBM es a -> Eff es a
runBlockDB = provide . BlockDBEnv

getBlockHeader :: HasBlockDB m => Keccak256 -> m (Maybe BlockHeader)
getBlockHeader sha = do
  BlockDBEnv pool <- accessEnv
  fmap (fmap blockBlockData) $ runSqlPool (getBlockSql sha) pool

getCanonicalBlockHeaders :: HasBlockDB m => [Integer] -> m (M.Map Integer BlockHeader)
getCanonicalBlockHeaders numbers = do
  BlockDBEnv pool <- accessEnv
  blocks <- runSqlPool (getBlocksSql
    [BlockDataRefNumber SQL.<-. numbers, BlockDataRefPowVerified SQL.==. True, BlockDataRefIsConfirmed SQL.==. True]) pool
  return $ M.fromList [(blockHeaderBlockNumber header, header) | block <- blocks, let header = blockBlockData block]

getBlockBodies :: HasBlockDB m => [Keccak256] -> m (M.Map Keccak256 [Transaction])
getBlockBodies hashes = do
  BlockDBEnv pool <- accessEnv
  runSqlPool (do
    rows <- E.select $ E.from $ \(block `E.LeftOuterJoin` btx `E.LeftOuterJoin` tx) -> do
      E.on (tx E.?. RawTransactionId E.==. btx E.?. BlockTransactionTransaction)
      E.on (E.just (block E.^. BlockDataRefId) E.==. btx E.?. BlockTransactionBlockDataRefId)
      E.where_ $ block E.^. BlockDataRefHash `E.in_` E.valList hashes
      E.orderBy [E.asc (btx E.?. BlockTransactionId)]
      return (block E.^. BlockDataRefHash, tx)
    return $ M.map reverse $ M.fromListWith (++)
      [(E.unValue sha, maybe [] (\row -> [rawTX2TX $ E.entityVal row]) tx) | (sha, tx) <- rows]) pool
