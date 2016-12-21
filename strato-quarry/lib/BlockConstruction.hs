{-# LANGUAGE OverloadedStrings, FlexibleContexts #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

module BlockConstruction where

import Blockchain.Data.BlockDB
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction
import Blockchain.Database.MerklePatricia hiding (Key)
import Blockchain.EthConf
import Blockchain.SHA
import Blockchain.Verification

import Control.Monad
import Control.Monad.IO.Class

import Data.Time.Clock
import qualified Data.Traversable as Trv

import Database.Esqueleto
import Database.Persist.Sql ()

import Numeric

import PersistSQL
import Debug

makeNewBlock :: (MonadIO m) => SqlPersistT m (Maybe Block)
makeNewBlock = after getBestBlock $ \newBest -> do
  txs <- getGreenTXs newBest
  if (lazyBlocks $ quarryConfig $ ethConf) && null txs
  then do
    debugPrint "Empty block; not creating\n"
    return Nothing
  else do
    b <- constructBlock newBest txs 
    debugPrints [
      startDebugBlock, "Creating block ", show $ blockDataNumber $ blockBlockData b,
      startDebugBlockLine, "Parent hash: ", showHash $ blockDataParentHash $ blockBlockData b,
      startDebugBlockLine, "(Fake) hash: ", showHash $ blockHash b,
      startDebugBlockLine, "Including transactions: ", showTXHashes b,
      endDebugBlock
      ]
    return $ Just b
  where
    after smx smf = do
      mx <- smx
      join <$> (Trv.sequence $ smf <$> mx)

constructBlock :: (MonadIO m) => Entity Block -> [Transaction] -> SqlPersistT m Block
constructBlock parentE txs = do
  let parent = entityVal parentE
      parentData = blockBlockData parent
  parentHash:_ <- select $ from $ \bdr -> do
    where_ (bdr ^. BlockDataRefBlockId ==. val (entityKey parentE))
    return $ bdr ^. BlockDataRefHash
  uncles <- getSiblings parentE
  time <- liftIO getCurrentTime
  return $ Block {
    blockBlockUncles = uncles,
    blockReceiptTransactions = txs,
    blockBlockData = BlockData {
      blockDataParentHash = unValue parentHash,
      blockDataUnclesHash = ommersVerificationValue uncles,
      blockDataCoinbase = fromInteger $ fst $ head $ readHex $ coinbaseAddress $ quarryConfig ethConf,
      blockDataStateRoot = StateRoot "",
      blockDataTransactionsRoot = transactionsVerificationValue txs,
      blockDataReceiptsRoot = receiptsVerificationValue (),
      blockDataLogBloom =
        "0000000000000000000000000000000000000000000000000000000000000000",
      blockDataDifficulty =
        nextDifficulty
        False
        (blockDataNumber parentData)
        (blockDataDifficulty parentData)
        (blockDataTimestamp parentData)
        time,
      blockDataNumber = blockDataNumber (blockBlockData parent) + 1,
      blockDataGasLimit =
        let g = blockDataGasLimit $ blockBlockData parent
            (q,d) = g `quotRem` 1024
        in g + q - (if d == 0 then 1 else 0),
      blockDataGasUsed = 0,
      blockDataTimestamp = time,
      blockDataExtraData = 0,
      blockDataMixHash = SHA 0,
      blockDataNonce = 5
      }
    }
