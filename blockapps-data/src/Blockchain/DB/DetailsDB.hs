
module Blockchain.DB.DetailsDB (
  getBestBlockHash,
  getGenesisBlockHash,
  getBestBlock
  ) where

import Data.Maybe
import qualified Database.Esqueleto as E

import Blockchain.Data.BlockDB
import Blockchain.Data.DataDefs
import Blockchain.DB.SQLDB
import Blockchain.Format
import Blockchain.SHA

getBestBlockHash::HasSQLDB m=>
                  m SHA
getBestBlockHash = do
  ret <- sqlQuery $
         E.select $ E.from $ \a -> do
           E.limit 1
           E.orderBy [E.desc (a E.^. BlockDataRefTotalDifficulty)]
           return $ a E.^. BlockDataRefHash
  case ret of
    [x] -> return $ E.unValue x
    [] -> error "Ethereum DBs are blank, you need to set them up by running 'ethereum-setup'"
    _ -> error "getBestBlockHash can't handle a tie yet, yet that is what we have."

getGenesisBlockHash::HasSQLDB m=>
                     m SHA
getGenesisBlockHash = do
  ret <- sqlQuery $
         E.select $ E.from $ \a -> do
           E.where_ (a E.^. BlockDataRefNumber E.==. E.val 0)
           return $ a E.^. BlockDataRefHash
  case ret of
    [x] -> return $ E.unValue x
    [] -> error "Ethereum DBs are blank, you need to set them up by running 'ethereum-setup'"
    _ -> error "getGenesisBlockHash called, but there are multiple genesis blocks!  This is an error."

getBestBlock::HasSQLDB m=>
              m Block
getBestBlock = do
  bestBlockHash <- getBestBlockHash
  bestBlock <- getBlock bestBlockHash
  return $ fromMaybe (error $ "Missing block in database: " ++ format (bestBlockHash)) bestBlock

