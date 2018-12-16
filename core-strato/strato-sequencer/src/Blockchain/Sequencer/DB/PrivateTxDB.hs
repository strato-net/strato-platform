{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Sequencer.DB.PrivateTxDB where

import           Blockchain.SHA
import           Control.Lens           ((.~), (%~))
import           Control.Monad          (join)
import           Control.Monad.IO.Class
import           Data.Foldable          (toList)
import           Data.Maybe             (catMaybes)
import qualified Data.Set               as S
import qualified Data.Sequence          as Q
import           Prometheus

import           Blockchain.Sequencer.DB.ChainHashDB
import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Class

lookupTransaction :: HasPrivateHashDB m => SHA -> m (Maybe OutputTx)
lookupTransaction tHash = join . fmap _outputTx <$> getTxHashEntry tHash

insertTransaction :: HasPrivateHashDB m => OutputTx -> m ()
insertTransaction tx = do
  let tHash = txHash tx
  repsertTxHashEntry_ tHash $ return . maybe (txHashEntryWithOutputTx tx) (outputTx .~ Just tx)

insertPrivateHash :: HasPrivateHashDB m => OutputTx -> m ()
insertPrivateHash tx = case txChainId tx of
  Nothing -> error "insertPrivateHash: Trying to insert a public transaction"
  Just chainId -> do
    liftIO $ withLabel txMetrics "private_hash" incCounter
    cHashes <- generateChainHashes tx
    blocks <- toList
            . S.fromList
            . concat
            . map (toList . maybe Q.empty _inBlocks)
          <$> mapM getChainHashEntry cHashes
    bDiffs <- map (fmap (obTotalDifficulty . _outputBlock)) <$> mapM getBlockHashEntry blocks
    let infos = S.fromList . catMaybes $ zipWith (\b -> fmap (flip BlockInfo b)) blocks bDiffs
    repsertChainIdEntry_ chainId $
      return . maybe (chainIdEntryWithBlocks infos)
                     (blocksToRun %~ S.union infos)
    mapM_ (flip insertChainHash chainId) cHashes
    mapM_ (insertChainBufferEntry chainId) cHashes
