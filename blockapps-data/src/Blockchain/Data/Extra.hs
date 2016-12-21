
module Blockchain.Data.Extra (
  getGenesisHash,
  putGenesisHash,
  getBestBlockInfo, getBestBlockInfoQ,
  putBestBlockInfo,
  getBestIndexBlockInfo, getBestIndexBlockInfoQ,
  putBestIndexBlockInfo
  ) where

import qualified Database.Persist.Sql as SQL

import Blockchain.Data.DataDefs
import Blockchain.DB.SQLDB
import Blockchain.SHA

import Control.Monad.IO.Class

getGenesisHash::HasSQLDB m=>m SHA
getGenesisHash = sqlQuery $ fmap (read . extraValue) $ SQL.getJust (ExtraKey "genesisHash")

putGenesisHash::HasSQLDB m=>SHA->m ()
putGenesisHash hash' = do
  _ <- sqlQuery $ SQL.upsert (Extra "genesisHash" $ show hash') []
  return ()

getBestBlockInfo::HasSQLDB m =>
                  m (SHA, BlockData)
getBestBlockInfo = 
  sqlQuery getBestBlockInfoQ 

getBestBlockInfoQ::MonadIO m =>
                  SQL.SqlPersistT m (SHA, BlockData)
getBestBlockInfoQ = fmap (read . extraValue) $ SQL.getJust (ExtraKey "bestBlock")

putBestBlockInfo::HasSQLDB m=>
                SHA->BlockData->m ()
putBestBlockInfo hash' bd = do
  _ <- sqlQuery $ SQL.upsert (Extra "bestBlock" $ show (hash', bd)) []
  return ()

getBestIndexBlockInfo::HasSQLDB m =>
                       m (SQL.Key Block)
getBestIndexBlockInfo =
  sqlQuery getBestIndexBlockInfoQ

getBestIndexBlockInfoQ::MonadIO m =>
                        SQL.SqlPersistT m (SQL.Key Block)
getBestIndexBlockInfoQ = 
  fmap (read . extraValue) $ SQL.getJust (ExtraKey "bestIndexBlock")

putBestIndexBlockInfo::HasSQLDB m=>
                       SQL.Key Block->m ()
putBestIndexBlockInfo bid = do
  _ <- sqlQuery $ SQL.upsert (Extra "bestIndexBlock" $ show bid) []
  return ()
