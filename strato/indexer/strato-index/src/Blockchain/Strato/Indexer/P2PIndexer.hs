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
import Blockchain.Data.Block (BestBlock (..), Private (..))
import Blockchain.Data.ChainInfo
import Blockchain.Sequencer.Event
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Indexer.Kafka
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Model.ChainMember (ChainMembers (..))
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Arrow ((&&&))
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import qualified Data.Map.Strict as M
import Data.Maybe (fromJust)
import qualified Data.Text as T
import Text.Format

p2pIndexerMainLoop ::
  ( MonadLogger m,
    HasKafka m,
    (Keccak256 `A.Alters` P2P (Private (Word256, OutputTx))) m,
    (Keccak256 `A.Alters` P2P OutputBlock) m,
    Mod.Modifiable (P2P BestBlock) m,
    (Word256 `A.Alters` P2P ChainInfo) m,
    (Word256 `A.Alters` P2P ChainMembers) m
  ) =>
  m ()
p2pIndexerMainLoop = forever $ do
  consume "p2pIndexer" "strato-p2p-indexer" targetTopicName $ \() idxEvents -> do
    indexP2P idxEvents
    return ()

indexP2P ::
  ( MonadLogger m,
    (Keccak256 `A.Alters` P2P (Private (Word256, OutputTx))) m,
    (Keccak256 `A.Alters` P2P OutputBlock) m,
    Mod.Modifiable (P2P BestBlock) m,
    (Word256 `A.Alters` P2P ChainInfo) m,
    (Word256 `A.Alters` P2P ChainMembers) m
  ) =>
  [IndexEvent] ->
  m ()
indexP2P idxEvents = do
  let ptxs = [t | IndexPrivateTx t <- idxEvents]
  unless (null ptxs) . A.insertMany (A.Proxy @(P2P (Private (Word256, OutputTx))))
    . M.fromList
    . map (fmap (P2P . Private))
    $ map (txHash &&& (fromJust . txChainId &&& id)) ptxs
  forM_ idxEvents $ \case
    RanBlock b -> do
      $logInfoS "p2pIndexer" . T.pack $ "Inserting Redis block with sha: " ++ format (blockHash b)
      A.insert (A.Proxy @(P2P OutputBlock)) (blockHash b) $ P2P b
    NewBestBlock (sha, num) -> do
      $logInfoS "p2pIndexer" . T.pack $
        "Updating RedisBestBlock as (" ++ format sha ++ ", " ++ show num ++ ")"
      Mod.put (Mod.Proxy @(P2P BestBlock)) . P2P $ BestBlock sha num
    NewChainInfo cId cInfo -> do
      $logInfoS "p2pIndexer" . T.pack $
        "Inserting ChainInfo for chain " ++ format cId ++ ": " ++ show cInfo
      A.insert (A.Proxy @(P2P ChainInfo)) cId $ P2P cInfo
      let cMembers = members $ chainInfo cInfo
      A.insert (A.Proxy @(P2P ChainMembers)) cId (P2P $ cMembers)
    _ -> return ()
