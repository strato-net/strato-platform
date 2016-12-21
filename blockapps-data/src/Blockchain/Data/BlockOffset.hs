
module Blockchain.Data.BlockOffset (
  putBlockOffsets,
  getBlockOffsetsForNumber,
  getOffsetsForHashes,
  getBlockOffsetsForHashes
  ) where

import Control.Monad
import Control.Monad.Trans.Resource
import qualified Database.Esqueleto as E
import qualified Database.Persist.Postgresql as SQL

import Blockchain.Data.DataDefs
import Blockchain.DB.SQLDB
import Blockchain.SHA

putBlockOffsets::HasSQLDB m=>[BlockOffset]->m ()
putBlockOffsets blockOffsets = do
  db <- getSQLDB
  _ <- runResourceT $
       flip SQL.runSqlPool db $
       forM blockOffsets $ \offset -> SQL.upsert offset []
  return ()

getBlockOffsetsForNumber::HasSQLDB m=>Integer->m [BlockOffset]
getBlockOffsetsForNumber blockOffset = do
  db <- getSQLDB
  ret <-
    runResourceT $
    flip SQL.runSqlPool db $
    SQL.selectList [BlockOffsetNumber SQL.==. blockOffset] []

  return $ map SQL.entityVal ret

getOffsetsForHashes::HasSQLDB m=>[SHA]->m [Integer]
getOffsetsForHashes hashes = do
  db <- getSQLDB
  offsets <-
    runResourceT $
    flip SQL.runSqlPool db $ 
    E.select $
    E.from $ \blockOffset -> do
      E.where_ ((blockOffset E.^. BlockOffsetHash) `E.in_` E.valList hashes)
      return $ blockOffset E.^. BlockOffsetOffset
      
  return $ map E.unValue offsets

getBlockOffsetsForHashes::HasSQLDB m=>[SHA]->m [BlockOffset]
getBlockOffsetsForHashes hashes = do
  db <- getSQLDB
  blockOffsets <-
    runResourceT $
    flip SQL.runSqlPool db $ 
    E.select $
    E.from $ \blockOffset -> do
      E.where_ ((blockOffset E.^. BlockOffsetHash) `E.in_` E.valList hashes)
      return blockOffset
      
  return $ map E.entityVal blockOffsets

