
module Blockchain.BlockSynchronizerSql (
   getBestBlockHash
  ) where

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.SHA

import           Control.Arrow            ((&&&))

import qualified Database.Esqueleto       as E

getBestBlockHash :: HasSQLDB m => m (SHA, Integer)
getBestBlockHash = do
  db <- getSQLDB
  blks <-  E.runSqlPool actions db

  return . head $
    (blockDataRefHash &&& blockDataRefTotalDifficulty) <$> (E.entityVal <$> (blks :: [E.Entity BlockDataRef]))

  where actions = E.select $
                    E.from $ \bdRef -> do
                        E.limit 1
                        E.orderBy [E.desc (bdRef E.^. BlockDataRefTotalDifficulty)]
                        return bdRef
