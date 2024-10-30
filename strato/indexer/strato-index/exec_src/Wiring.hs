{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}


module Wiring where

import Blockchain.DBM
import Blockchain.Data.Block (BestBlock (..), Private (..))
import Blockchain.Data.BlockDB
import Blockchain.Data.ChainInfo
import Blockchain.Data.ChainInfoDB (putChainInfo)
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction (insertTX)
import Blockchain.Data.ValidatorRef
import Blockchain.DB.SQLDB
import Blockchain.Sequencer.Event
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Validator
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Control.Exception
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Redis
import Control.Monad.IO.Class
import qualified Data.Map.Strict as M
import SelectAccessible ()

instance HasSQLDB m => (Keccak256 `A.Alters` API OutputTx) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Keccak256" "OutputTx"
  delete _ _ = liftIO . throwIO $ Delete "API" "Keccak256" "OutputTx"
  insert _ _ (API OutputTx {..}) = void $ insertTX Log otOrigin Nothing [otBaseTx]

instance HasSQLDB m => (Word256 `A.Alters` API ChainInfo) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Word256" "ChainInfo"
  delete _ _ = liftIO . throwIO $ Delete "API" "Word256" "ChainInfo"
  insert _ cId (API cInfo) = void $ putChainInfo (ChainId cId) cInfo

instance HasSQLDB m => (([Validator], [Validator]) `A.Alters` API (A.Proxy ValidatorRef)) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Vals" "ValidatorRef"
  delete _ _ = liftIO . throwIO $ Delete "API" "Vals" "AddressStateRef"
  insert _ vals _ = void $ addRemoveValidator vals

instance HasSQLDB m => (Keccak256 `A.Alters` API OutputBlock) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "API" "Keccak256" "OutputBlock"
  insert _ _ (API ob) = void $ putBlocks [outputBlockToBlockRetainPayloads ob] False
  insertMany _ =
    void
      . flip putBlocks False
      . map (outputBlockToBlockRetainPayloads . unAPI)
      . M.elems

instance (MonadIO m, HasRedis m) => Mod.Modifiable (P2P BestBlock) m where
  get _ = liftIO . throwIO $ Lookup "P2P" "()" "BestBlock"
  put _ (P2P (BestBlock s n)) = void . execRedis $ RBDB.putBestBlockInfo s n

instance (MonadIO m, HasRedis m) => (Word256 `A.Alters` P2P ChainInfo) m where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Word256" "ChainInfo"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Word256" "ChainInfo"
  insert _ cId =
    void
      . execRedis
      . RBDB.putChainInfo cId
      . unP2P


instance (MonadIO m, HasRedis m) => (Word256 `A.Alters` P2P ChainMembers) m where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Word256" "ChainMembers"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Word256" "ChainMembers"
  insert _ cId =
    void
      . execRedis
      . RBDB.putChainMembers cId --Uses RedisChainMembers which messes things up
      --  . unChainMembers
      . unP2P

instance (MonadIO m, HasRedis m) => (Keccak256 `A.Alters` P2P (Private (Word256, OutputTx))) m where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Keccak256" "Private (Word256, OutputTx)"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Keccak256" "Private (Word256, OutputTx)"
  insert p k v = A.insertMany p $ M.fromList [(k, v)]
  insertMany _ =
    void
      . execRedis
      . RBDB.addPrivateTransactions
      . map (fmap $ unPrivate . unP2P)
      . M.toList

instance (MonadIO m, HasRedis m) => (Keccak256 `A.Alters` P2P OutputBlock) m where
  lookup _ _ = liftIO . throwIO $ Lookup "P2P" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "P2P" "Keccak256" "OutputBlock"
  insert _ _ =
    void
      . execRedis
      . RBDB.putBlock
      . unP2P

