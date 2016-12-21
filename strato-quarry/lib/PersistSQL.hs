{-# LANGUAGE ScopedTypeVariables #-}

module PersistSQL where

import Blockchain.Data.BlockDB
import Blockchain.Data.DataDefs
import Blockchain.Data.Extra
import Blockchain.Data.Transaction
import Blockchain.Database.MerklePatricia ()

import Control.Monad.IO.Class

import qualified Data.List as List
import qualified Data.Map as Map
import Data.Maybe
import qualified Data.Set as Set
import Data.Time.Clock

import Database.Esqueleto
import Database.Persist.Sql ()

import Debug

type BlockIds = (Key Block, Key BlockDataRef)

deleteBlockQ :: (MonadIO m) => BlockIds -> SqlPersistT m ()
deleteBlockQ (bId, bdId) = do
  delete $ from $ \r -> where_ (r ^. BlockTransactionBlockId ==. val bId)
  delete $ from $ \b -> where_ (b ^. BlockDataRefId ==. val bdId)
  delete $ from $ \b -> where_ (b ^. BlockId ==. val bId)
  return ()

getSiblings :: (MonadIO m) => Entity Block -> SqlPersistT m [BlockData]
getSiblings bE = do
  let b = entityVal bE
      bid = entityKey bE
      pHash = blockDataParentHash $ blockBlockData b
  blocks <-
    select $
    from $ \(block `InnerJoin` blockDR) -> do
      on (blockDR ^. BlockDataRefBlockId ==. block ^. BlockId &&.
          blockDR ^. BlockDataRefParentHash ==. val pHash &&.
          block ^. BlockId !=. val bid)
      return block
  return $ map (blockBlockData . entityVal) blocks

getGreenTXs :: (MonadIO m) => Entity Block -> SqlPersistT m [Transaction]
getGreenTXs blockE = do
  earliest:_ <- do
    txs <-
      select $
      from $ \(rawTX `InnerJoin` blocktx) -> do
        on $ (blocktx ^. BlockTransactionTransaction ==. rawTX ^. RawTransactionId)
          &&.(blocktx ^. BlockTransactionBlockId ==. val (entityKey blockE))
        orderBy [asc $ rawTX ^. RawTransactionTimestamp]
        limit 1
        return rawTX
    return $
      if null txs
      then [blockDataTimestamp . blockBlockData . entityVal $ blockE]
      else map (rawTransactionTimestamp . entityVal) txs

  let timeRadius = 60 :: NominalDiffTime -- seconds
      blockStartTime = addUTCTime (2 * negate timeRadius) earliest
      txStartTime = addUTCTime (negate timeRadius) earliest
  laterBlockEs <-
    select $
    from $ \(block `InnerJoin` blockDR) -> do
      on (blockDR ^. BlockDataRefBlockId ==. block ^. BlockId &&.
          blockDR ^. BlockDataRefTimestamp >. val blockStartTime)
      return block
  let recentBlockEMap = Map.fromList $ do
        recentBlockE@(Entity{entityVal = block}) <- laterBlockEs
        return (blockHash block, recentBlockE)
      recentChain =
        catMaybes $ List.takeWhile isJust $
        Just blockE :
        map (
          flip Map.lookup recentBlockEMap .
          blockDataParentHash .
          blockBlockData .
          entityVal
          )
        recentChain
      recentTXs = concatMap (blockReceiptTransactions . entityVal) recentChain
  alltxs <- fmap (map (rawTX2TX . entityVal)) $
    select $
    from $ \rawTX -> do
      where_ $ (rawTX ^. RawTransactionTimestamp >. val txStartTime)
      orderBy [asc $ rawTX ^. RawTransactionTimestamp]
      return $ rawTX
  debugPrints $ "All recent transactions: \n":
    map (\tx -> "  TX hash: " ++ (showHash $ transactionHash tx) ++ "\n") alltxs
  debugPrints $ "Recent transactions in blocks: \n":
    map (\tx -> "  TX hash: " ++ (showHash $ transactionHash tx) ++ "\n") recentTXs
  debugPrints $ "Taken from the blocks: \n" :
    map (\bl -> "  Block hash: " ++ (showHash $ blockHash $ entityVal bl) ++ "\n")
    recentChain
  debugPrints $ "Hashes of all recent blocks: \n" :
    map (\(h,_) -> "  Block hash: " ++ (showHash h) ++ "\n") (Map.toList recentBlockEMap)
  let greenTXs = Set.toList $
                 (Set.fromList alltxs) Set.\\
                 (Set.fromList recentTXs)        
  return greenTXs

getBestBlock :: (MonadIO m) => SqlPersistT m (Maybe (Entity Block))
getBestBlock = do
    (bhash, _) <- getBestBlockInfoQ
    --bid <- getBestIndexBlockInfoQ
    --b <- getJust bid

    bEntityL <- 
      select $ 
      from $ \(block `InnerJoin` blockDR) -> do
        on (blockDR ^. BlockDataRefHash ==. val bhash &&.
            block ^. BlockId ==. blockDR ^. BlockDataRefBlockId)
        return block

    return $
      if null bEntityL
      then Nothing
      else Just $ head bEntityL
    
    -- if bhash == blockHash b
    -- then do
    --   debugPrints $ ["Best blocks agree: hash ", showHash bhash, "\n"]
    --   return $ Just $ Entity bid b 
    -- else do
    --   debugPrints $ ["Best blocks disagree: \n",
    --                  " VM best block: ", showHash bhash, "\n",
    --                  " Index best block: ", showHash $ blockHash b, "\n"]
    --   return Nothing

