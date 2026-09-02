{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

-- | Runs statediff off the block-processing thread.
--
-- The main thread publishes the newest committed (state root, block hash,
-- block number) to a 'TVar' where it would previously have computed the diff
-- inline. This worker reads that TVar whenever it is free and diffs from the
-- last root it finished against to whatever is current.
--
-- The TVar is the point. A statediff can be taken between any two state roots,
-- so a worker that has fallen behind should jump straight to the newest root
-- and take one larger diff, rather than working through a backlog. A queue
-- would preserve intermediate roots nobody needs; an MVar would make the main
-- thread block on a handoff. An overwritten TVar just means the skipped roots
-- are folded into the next diff, and a diff already in flight is never
-- invalidated or restarted.
--
-- Safety this relies on, both established in "Blockchain.BlockChain":
--
--   * A published state root's trie nodes are already durable. @addBlock@
--     calls @flushPendingMPNodes@ on every valid block and the vm-runner
--     context uses a flush interval of 1, so nodes reach LevelDB before the
--     batch that publishes the root finishes.
--   * @clearPendingMPNodes@ only runs for a block that failed verification,
--     and such a block never becomes best, so its root is never published.
--
-- 'SD.stateDiff'' needs only the trie, the code DB and the hash DB - no
-- MemDBs, no AddressState - so this thread reads immutable historical state
-- and never observes the main thread's in-flight block.
module Blockchain.StateDiffWorker
  ( stateDiffWorker,
  )
where

import BlockApps.Logging
import Blockchain.DB.CodeDB (HasCodeDB)
import Blockchain.DB.HashDB (HasHashDB)
import Blockchain.Strato.Indexer.Kafka (produceIndexEvents)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import qualified Blockchain.Strato.StateDiff as SD
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.VMContext
import Conduit
import Control.Concurrent.STM (retry)
import Control.Monad (void)
import Control.Monad.Change.Alter (Alters)
import Control.Monad.Composable.Streaming (HasStreaming)
import qualified Data.Text as T
import Text.Format (format)
import UnliftIO

-- | Diff forever, one span at a time. Never returns.
--
-- Needs no seeding: until it has finished a diff of its own it uses the base
-- root carried on the target, which is the best root before the batch that
-- published it.
stateDiffWorker ::
  ( MonadUnliftIO m,
    MonadLogger m,
    HasCodeDB m,
    HasHashDB m,
    (MP.StateRoot `Alters` MP.NodeData) m,
    HasStreaming m
  ) =>
  TVar (Maybe StateDiffTarget) ->
  m ()
stateDiffWorker targetVar = go Nothing
  where
    go mLast = do
      target <- awaitNewTarget targetVar mLast
      let newRoot = sdtStateRoot target
          base = maybe (sdtBaseStateRoot target) sdtStateRoot mLast
      result <- try $ diffAndPublish base target
      case result of
        Right () -> go (Just target)
        Left (e :: SomeException) -> do
          -- Leave mLast where it is: the next target is diffed from the last
          -- root we actually published, so a failed span is folded into the
          -- following one rather than silently skipped.
          $logErrorS "stateDiffWorker" . T.pack $
            "statediff " ++ format base ++ " -> " ++ format newRoot
              ++ " failed, will retry from "
              ++ format base
              ++ ": "
              ++ show e
          go mLast

    diffAndPublish lastRoot target = do
      let newRoot = sdtStateRoot target
      $logInfoS "stateDiffWorker" . T.pack $
        "diffing " ++ format lastRoot ++ " -> " ++ format newRoot
          ++ " (block #"
          ++ show (sdtBlockNumber target)
          ++ ")"
      runConduit $
        SD.stateDiff'
          Nothing
          (sdtBlockNumber target)
          (sdtBlockHash target)
          lastRoot
          newRoot
          .| mapM_C (void . produceIndexEvents . pure . StateDiffEntry)

-- | Block until the TVar holds a target we have not handled yet.
--
-- 'retry' parks the thread with no polling, and because we only compare
-- against the newest value, any targets published while we were busy are
-- collapsed into this one span.
--
-- The comparison is on the whole target, not just its state root: a block that
-- changes no state repeats the previous root, and the inline version still
-- emitted an (empty) diff carrying that block's hash and number. Waking on the
-- root alone would drop those.
awaitNewTarget ::
  MonadIO m =>
  TVar (Maybe StateDiffTarget) ->
  Maybe StateDiffTarget ->
  m StateDiffTarget
awaitNewTarget targetVar mLast = liftIO . atomically $ do
  mTarget <- readTVar targetVar
  case mTarget of
    Just t | Just t /= mLast -> pure t
    _ -> retry
