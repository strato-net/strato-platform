{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeFamilies          #-}

module Blockchain.Data.BlockDB (
  getBlock,
  putBlocks
) where

import qualified Database.Esqueleto.Legacy          as E
import           Database.Persist                   hiding (get)
import qualified Database.Persist.Postgresql        as SQL

import           Data.Maybe

import           Control.Monad.State

import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Class

blk2BlkDataRef :: Block
               -> Keccak256
               -> Integer
               -> Bool
               -> BlockDataRef
blk2BlkDataRef b hash' difficulty' makeHashOne =
  BlockDataRef pH uH cB sR tR rR lB d n gL gU t eD nc mH hash'' uncles True True difficulty' --- Horrible! Apparently I need to learn the Lens library, yesterday
  where
      hash'' = if makeHashOne then unsafeCreateKeccak256FromWord256 1 else hash'
      bd = blockBlockData b
      uncles = blockBlockUncles b
      pH = blockDataParentHash bd
      uH = blockDataUnclesHash bd
      cB = blockDataCoinbase bd
      sR = blockDataStateRoot bd
      tR = blockDataTransactionsRoot bd
      rR = blockDataReceiptsRoot bd
      lB = blockDataLogBloom bd
      n =  blockDataNumber bd
      d  = blockDataDifficulty bd
      gL = blockDataGasLimit bd
      gU = blockDataGasUsed bd
      t  = blockDataTimestamp bd
      eD = blockDataExtraData bd
      nc = blockDataNonce bd
      mH = blockDataMixHash bd

getBlock :: HasSQLDB m
         => Keccak256
         -> m (Maybe BlockDataRef)
getBlock h = do
  entBlkL <- sqlQuery actions

  case entBlkL of
    []  -> return Nothing
    lst -> return $ Just . entityVal . head $ lst
  where actions = E.select $ E.from $ \bdRef -> do
                                   E.where_ (bdRef E.^. BlockDataRefHash E.==. E.val h )
                                   return bdRef

putBlocks :: HasSQLDB m
          => [(Block, Integer)]
          -> Bool
          -> m [Key BlockDataRef]
putBlocks blocksAndDifficulties makeHashOne = do
  let blocksHashesAndDifficulties = (\(b,d) -> (b, blockHash b, d)) <$> blocksAndDifficulties
  sqlQuery $
    forM blocksHashesAndDifficulties $ \(b, hash', diff) -> do
      insertTXIfNew' (BlockHash $ blockHash b) (Just $ blockDataNumber $ blockBlockData b) (blockReceiptTransactions b)

      existingBlockData <- SQL.selectList [BlockDataRefHash SQL.==.  blockHash b] []

      case existingBlockData of
           [] -> do
             let toInsert = blk2BlkDataRef b hash' diff makeHashOne
             blkDataRefId <- SQL.insert toInsert
             forM_ (blockReceiptTransactions b) $ \tx -> do
               txID <- updateBlockNumber b (transactionHash tx) (txChainId tx)
               SQL.insert $ BlockTransaction blkDataRefId txID
             return blkDataRefId
           [bd] -> return $ SQL.entityKey bd
           _ -> error "DB has multiple blocks with the same hash"

  where
    updateBlockNumber b txHash' cid = do
          ret <- SQL.getBy (UniqueTXHash txHash' $ fromMaybe 0 cid)
          key <-
            case ret of
             Just x  -> return $ entityKey x
             Nothing -> error "error in putBlocks: no transaction exists in the DB, even though I just inserted it"
          SQL.update key [RawTransactionBlockNumber SQL.=. fromIntegral (blockDataNumber (blockBlockData b))]
          return key
