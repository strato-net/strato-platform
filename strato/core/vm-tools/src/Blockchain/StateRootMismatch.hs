{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.StateRootMismatch
  ( StateRootMismatchM(..),
    formatStateRootMismatch
  )
where

import BlockApps.Logging
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.StateDiff
import Control.Applicative ((<|>))
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Control.Monad.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Foldable (for_)
import Data.List (intercalate)
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import SolidVM.Model.Storable
import Text.Format
import Text.Tools
import UnliftIO

newtype StateRootMismatchM m a = StateRootMismatchM { runStateRootMismatchM :: m a }

instance Functor m => Functor (StateRootMismatchM m) where
  fmap f (StateRootMismatchM a) = StateRootMismatchM $ f <$> a

instance Applicative m => Applicative (StateRootMismatchM m) where
  pure a = StateRootMismatchM $ pure a
  (StateRootMismatchM fa) <*> (StateRootMismatchM fb) = StateRootMismatchM $ fa <*> fb

instance Monad m => Monad (StateRootMismatchM m) where
  (StateRootMismatchM ma) >>= f = StateRootMismatchM $ ma >>= runStateRootMismatchM . f

instance MonadTrans StateRootMismatchM where
  lift = StateRootMismatchM

instance MonadLogger m => MonadLogger (StateRootMismatchM m)

instance MonadIO m => MonadIO (StateRootMismatchM m) where
  liftIO = lift . liftIO

instance MonadUnliftIO m => MonadUnliftIO (StateRootMismatchM m) where
  withRunInIO inner = StateRootMismatchM $ withRunInIO $ \run ->
    inner (run . runStateRootMismatchM)

instance ( MonadUnliftIO m
         , MonadLogger m
         , HasKafka m
         , (MP.StateRoot `A.Alters` MP.NodeData) m
         )
      => (MP.StateRoot `A.Alters` MP.NodeData) (StateRootMismatchM m) where
  lookup _ k = lift (A.lookup (A.Proxy @MP.NodeData) k) >>= \case
    Just nd -> pure $ Just nd
    Nothing -> do
      StateRootMismatchM . void $ writeUnseqEvents [IEGetMPNodes [k]]
      fmap (Just . fromMaybe MP.EmptyNodeData) . timeout 10000000 $
        runConsume "StateRootMismatchM/lookup" "ethereum-vm" seqVmEventsTopicName $ \_ evs -> do
          let findND (VmMPNodesReceived [nd]) | k == MP.sha2StateRoot (rlpHash nd) = Just nd
              findND _ = Nothing
              mND = foldr (<|>) Nothing (findND <$> evs)
          for_ mND $ lift . A.insert (A.Proxy @MP.NodeData) k
          pure (mND, B.empty)
  insert _ = error "StateRootMismatchM insert StateDB"
  delete _ = error "StateRootMismatchM delete StateDB"

formatStateRootMismatch :: StateDiff -> String
formatStateRootMismatch (StateDiff _ _ _ _ c d u) = intercalate "\n" $
  [ "\nAccounts found in local state, but not block state"
  , "--------------------------------------------------"
  , intercalate "\n" $ (\(k,v) -> "Address " ++ format k ++ "\n" ++ tab (showEvAccDiff v)) <$> M.toList c
  , "\nAccounts missing from local state, but found in block state"
  , "-----------------------------------------------------------"
  , intercalate "\n" $ (\(k,v) -> "Address " ++ format k ++ "\n" ++ tab (showEvAccDiff v)) <$> M.toList d
  , "\nAccounts found in both local and block states, but with different values"
  , "------------------------------------------------------------------------"
  , intercalate "\n" $ (\(k,v) -> "Address " ++ format k ++ "\n" ++ tab (showIncAccDiff v)) <$> M.toList u
  ]

showIncAccDiff :: AccountDiff 'Incremental -> String
showIncAccDiff AccountDiff{..} = intercalate "\n"
  [ "Nonce: " ++ maybe "Nothing" (showIncDiff show) nonce
  , "Balance: " ++ maybe "Nothing" (showIncDiff show) balance
  , "Code: " ++ maybe "Nothing" (showIncDiff BC.unpack) code
  , "CodeHash: " ++ format codeHash
  , "Contract Root: " ++ maybe "Nothing" (showIncDiff format) contractRoot
  , "Storage:\n" ++ tab (showIncStorDiff storage)
  ]

showEvAccDiff :: AccountDiff 'Eventual -> String
showEvAccDiff AccountDiff{..} = intercalate "\n"
  [ "Nonce: " ++ maybe "Nothing" (showEvDiff show) nonce
  , "Balance: " ++ maybe "Nothing" (showEvDiff show) balance
  , "Code: " ++ maybe "Nothing" (showEvDiff BC.unpack) code
  , "CodeHash: " ++ format codeHash
  , "Contract Root: " ++ maybe "Nothing" (showEvDiff format) contractRoot
  , "Storage:\n" ++ tab (showEvStorDiff storage)
  ]

showIncStorDiff :: StorageDiff 'Incremental -> String
showIncStorDiff (EVMDiff e) = intercalate "\n" $ (\(k,v) -> format k ++ ": " ++ showIncDiff format v) <$> M.toList e
showIncStorDiff (SolidVMDiff s) = intercalate "\n" $ (\(k,v) -> BC.unpack k ++ ": " ++ showIncDiff (format . rlpDecode @BasicValue . rlpDeserialize) v) <$> M.toList s

showEvStorDiff :: StorageDiff 'Eventual -> String
showEvStorDiff (EVMDiff e) = intercalate "\n" $ (\(k,v) -> format k ++ ": " ++ showEvDiff format v) <$> M.toList e
showEvStorDiff (SolidVMDiff s) = intercalate "\n" $ (\(k,v) -> BC.unpack k ++ ": " ++ showEvDiff (format . rlpDecode @BasicValue . rlpDeserialize) v) <$> M.toList s

showIncDiff :: (a -> String) -> (Diff a 'Incremental) -> String
showIncDiff f (Create a)   = "In local state: " ++ f a
showIncDiff f (Delete a)   = "In block state: " ++ f a
showIncDiff f (Update a b) = "In block state: " ++ f a ++ ", in local state: " ++ f b

showEvDiff :: (a -> String) -> (Diff a 'Eventual) -> String
showEvDiff f (Value a) = f a
