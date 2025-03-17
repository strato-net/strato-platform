{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Strato.Indexer.P2PIndexer (
  p2pIndexerMainLoop,
  indexP2P
  ) where

import BlockApps.Logging
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Indexer.Kafka
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import qualified Data.Text as T
import Text.Format

p2pIndexerMainLoop ::
  ( MonadLogger m,
    HasKafka m,
    (Keccak256 `A.Alters` P2P OutputBlock) m,
    Mod.Modifiable (P2P BestBlock) m
  ) =>
  m ()
p2pIndexerMainLoop = forever $ do
  consume "p2pIndexer" "strato-p2p-indexer" targetTopicName $ \() idxEvents -> do
    indexP2P idxEvents
    return ()

indexP2P ::
  ( MonadLogger m,
    (Keccak256 `A.Alters` P2P OutputBlock) m,
    Mod.Modifiable (P2P BestBlock) m
  ) =>
  [IndexEvent] ->
  m ()
indexP2P idxEvents = do
  forM_ idxEvents $ \case
    RanBlock b -> do
      $logInfoS "p2pIndexer" . T.pack $ "Inserting Redis block with sha: " ++ format (blockHash b)
      A.insert (A.Proxy @(P2P OutputBlock)) (blockHash b) $ P2P b
    NewBestBlock (sha, num) -> do
      $logInfoS "p2pIndexer" . T.pack $
        "Updating RedisBestBlock as (" ++ format sha ++ ", " ++ show num ++ ")"
      Mod.put (Mod.Proxy @(P2P BestBlock)) . P2P $ BestBlock sha num
    _ -> return ()
