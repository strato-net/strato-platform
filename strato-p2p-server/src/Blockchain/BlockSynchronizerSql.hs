
module Blockchain.BlockSynchronizerSql (
   getBestBlockHash
  ) where

import Blockchain.SHA
import Blockchain.Data.DataDefs
import Blockchain.DB.SQLDB

import qualified Database.Esqueleto as E

getBestBlockHash::HasSQLDB m=>m (SHA, Integer)
getBestBlockHash = do
  db <- getSQLDB
  blks <-  E.runSqlPool actions $ db

  return $ head $ map (\t -> (blockDataRefHash t, blockDataRefTotalDifficulty t))(map E.entityVal (blks :: [E.Entity BlockDataRef])) 
  
  where actions =   E.select $
                       E.from $ \(bdRef) -> do
                       E.limit $ 1 
                       E.orderBy [E.desc (bdRef E.^. BlockDataRefTotalDifficulty)]
                       return bdRef
