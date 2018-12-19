{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RankNTypes          #-}
{-# LANGUAGE ScopedTypeVariables #-}
module Blockchain.Sequencer.DB.PrivateTxDB where

import           Blockchain.ExtWord
import           Blockchain.SHA
import           Control.Arrow          ((&&&))
import           Control.Lens           ((%=))
import           Control.Monad.IO.Class
import           Data.Foldable          (toList)
import           Data.Maybe             (catMaybes)
import qualified Data.Set               as S
import qualified Data.Sequence          as Q
import           Prometheus

import           Blockchain.Sequencer.DB.ChainHashDB
import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Strato.Model.Class

insertTransaction :: HasPrivateHashDB h t b m => t -> m ()
insertTransaction = uncurry insertTxHashEntry . (txHash &&& id)

findChainHashUses :: HasPrivateHashDB h t b m => Word256 -> [SHA] -> m ()
findChainHashUses chainId cHashes = do
  blocks <- toList
          . S.fromList
          . concat
          . map (toList . maybe Q.empty _inBlocks)
        <$> mapM getChainHashEntry cHashes
  bOrders <- map (fmap blockOrdering) <$> mapM getBlockHashEntry blocks
  let infos = S.fromList . catMaybes $ zipWith (\b -> fmap (BlockInfo b)) blocks bOrders
  modifyChainIdEntryState_ chainId $ blocksToRun %= S.union infos

insertPrivateHash :: HasPrivateHashDB h t b m => t -> m ()
insertPrivateHash tx = case txChainId tx of
  Nothing -> error "insertPrivateHash: Trying to insert a public transaction"
  Just chainId -> do
    liftIO $ withLabel txMetrics "private_hash" incCounter
    cHashes <- generateChainHashes tx
    mapM_ (flip insertChainHash chainId) cHashes
    mapM_ (insertChainBufferEntry chainId) cHashes
    findChainHashUses chainId cHashes
