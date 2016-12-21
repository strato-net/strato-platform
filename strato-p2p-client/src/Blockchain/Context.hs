{-# LANGUAGE OverloadedStrings, TypeSynonymInstances, FlexibleInstances, ScopedTypeVariables, FlexibleContexts #-}

module Blockchain.Context (
  Context(..),
  ContextM,
  getDebugMsg,
  addDebugMsg,
  getBlockHeaders,
  putBlockHeaders,
  clearDebugMsg,
  stampActionTimestamp,
  getActionTimestamp,
  clearActionTimestamp
  ) where


import Control.Monad.Logger
import Control.Monad.Trans.Resource
import Control.Monad.State
import Data.Time.Clock

import Blockchain.Data.BlockHeader
import Blockchain.DB.SQLDB

--import Debug.Trace

data Context =
  Context {
    contextSQLDB::SQLDB,
    vmTrace::[String],
    blockHeaders::[BlockHeader],
    actionTimestamp::Maybe UTCTime
    }

type ContextM = StateT Context (ResourceT (LoggingT IO))

instance (MonadResource m, MonadBaseControl IO m)=>HasSQLDB (StateT Context m) where
  getSQLDB = fmap contextSQLDB get

{-
initContext::String->IO Context
initContext theType = do
  liftIO $ putStr "Loading mining cache.... "
  hFlush stdout
  dataset <- return "" -- mmapFileByteString "dataset0" Nothing
  liftIO $ putStrLn "Finished"
  homeDir <- getHomeDirectory                     
  createDirectoryIfMissing False $ homeDir </> dbDir theType
  return $ Context
      []
      0
      []
      dataset
      False
-}

getDebugMsg::MonadState Context m=>
             m String
getDebugMsg = do
  cxt <- get
  return $ concat $ reverse $ vmTrace cxt

getBlockHeaders::MonadState Context m=>
                 m [BlockHeader]
getBlockHeaders = do
  cxt <- get
  return $ blockHeaders cxt

putBlockHeaders::MonadState Context m=>
                 [BlockHeader]->m ()
putBlockHeaders headers = do
  cxt <- get
  put cxt{blockHeaders=headers}

addDebugMsg::MonadState Context m=>
             String->m ()
addDebugMsg msg = do
  cxt <- get
  put cxt{vmTrace=msg:vmTrace cxt}

clearDebugMsg::MonadState Context m=>
               m ()
clearDebugMsg = do
  cxt <- get
  put cxt{vmTrace=[]}

stampActionTimestamp::(MonadIO m, MonadState Context m)=>
                      m ()
stampActionTimestamp = do
  cxt <- get
  ts <- liftIO $ getCurrentTime
  put cxt{actionTimestamp=Just ts}

getActionTimestamp::MonadState Context m=>
                    m (Maybe UTCTime)
getActionTimestamp = do
  cxt <- get
  return $ actionTimestamp cxt

clearActionTimestamp::MonadState Context m=>
                      m ()
clearActionTimestamp = do
  cxt <- get
  put cxt{actionTimestamp=Nothing}
