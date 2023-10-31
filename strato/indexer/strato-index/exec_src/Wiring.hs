{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}


module Wiring where

import Blockchain.DBM
import Blockchain.Data.BlockDB
import Blockchain.Data.ChainInfo
import Blockchain.Data.ChainInfoDB (putChainInfo)
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction (insertTX)
import Blockchain.Data.ValidatorRef
import Blockchain.Sequencer.Event
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Arrow ((&&&))
import Control.Exception
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import qualified Data.Map.Strict as M
import SelectAccessible ()

instance HasSQL m => (Keccak256 `A.Alters` API OutputTx) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Keccak256" "OutputTx"
  delete _ _ = liftIO . throwIO $ Delete "API" "Keccak256" "OutputTx"
  insert _ _ (API OutputTx {..}) = void $ insertTX Log otOrigin Nothing [otBaseTx]

instance HasSQL m => (Word256 `A.Alters` API ChainInfo) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Word256" "ChainInfo"
  delete _ _ = liftIO . throwIO $ Delete "API" "Word256" "ChainInfo"
  insert _ cId (API cInfo) = void $ putChainInfo (ChainId cId) cInfo

instance HasSQL m => (([ChainMemberParsedSet], [ChainMemberParsedSet]) `A.Alters` API (A.Proxy ValidatorRef)) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Vals" "ValidatorRef"
  delete _ _ = liftIO . throwIO $ Delete "API" "Vals" "AddressStateRef"
  insert _ vals _ = void $ addRemoveValidator vals

instance HasSQL m => (Keccak256 `A.Alters` API OutputBlock) m where
  lookup _ _ = liftIO . throwIO $ Lookup "API" "Keccak256" "OutputBlock"
  delete _ _ = liftIO . throwIO $ Delete "API" "Keccak256" "OutputBlock"
  insert _ _ (API ob) = void $ putBlocks [(outputBlockToBlockRetainPayloads ob, obTotalDifficulty ob)] False
  insertMany _ =
    void
      . flip putBlocks False
      . map ((outputBlockToBlockRetainPayloads &&& obTotalDifficulty) . unAPI)
      . M.elems
