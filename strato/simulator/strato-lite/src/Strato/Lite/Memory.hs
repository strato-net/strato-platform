{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE Rank2Types #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Lite.Memory where

import BlockApps.Logging
import Blockchain.Data.BlockDB ()
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.GenesisInfo
import Blockchain.Init.Generator (createGenesisInfo)
import Blockchain.Network
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.UDPServer (connectMe)
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Secp256k1
import Conduit
import Control.Lens ((.~))
import Control.Monad.Reader
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Map.Strict as M
import Data.Pool (withResource)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Database.Persist.Sqlite as Lite
import Executable.EthDiscoverySetup (setupSQL)
import GHC.Conc (retry)
import Network.Socket as S
import Strato.Lite.Base
import Strato.Lite.Base.Memory
import Strato.Lite.Core
import Strato.Lite.PEM
import Strato.Lite.Utils
import System.Directory
import System.FilePath
import UnliftIO
import Prelude hiding (round)

createMemoryPeerAndCorePeer ::
  String ->
  PrivateKey ->
  Text ->
  TCPPort ->
  UDPPort ->
  Host ->
  Bool ->
  Socket ->
  MemoryDBs ->
  (Text -> LoggingT IO () -> IO ()) ->
  IO (MemoryPeer, CorePeer)
createMemoryPeerAndCorePeer network' privKey name tcpPort udpPort myHost valBehav sock fsDBs logF = do
  bootNodes <- maybe [] (Host . T.pack . webAddress <$>) <$> getParams network'
  createGenesisInfo network'
  genesisInfo <- getGenesisInfo
  fsPeer <- createMemoryPeerIO privKey tcpPort udpPort sock myHost bootNodes fsDBs
  corePeer <- createCorePeer network' (T.unpack name) genesisInfo valBehav logF
  pure (fsPeer, corePeer)

hoistMemory :: MemoryPeer -> (forall a. MemoryT (ReaderT MemPeerDBEnv BaseM) a -> BaseM a)
hoistMemory p f = runReaderT (runReaderT f p) (_memoryPeerMap p)

runMemoryNode
  :: MemoryPeer
  -> CorePeer
  -> IO [Async ()]
runMemoryNode p c = runNode (hoistMemory p) (\f ->
  bracket
    (connectMe $ _memoryPeerUDPPort p)
    (\s -> liftIO $ S.close s >> putStrLn "Closed UDP socket")
    (\s -> local (memoryPeerUDPSocket .~ s) f)) c

wipeMemoryNode ::
  MonadIO m =>
  FilePath ->
  String ->
  String ->
  m ()
wipeMemoryNode dir' network' name = do
  dir <- getNodeDirectory dir' network' name
  liftIO $ removeDirectoryRecursive dir

createMemoryNode ::
  MonadResource m =>
  FilePath ->
  String ->
  FilePath ->
  Text ->
  TCPPort ->
  UDPPort ->
  Host ->
  Bool ->
  m (MemoryPeer, CorePeer)
createMemoryNode dir' network' privKeyFile name tcpPort udpPort myHost valBehav = do
  dir <- getNodeDirectory dir' network' $ T.unpack name
  logsMapVar <- atomically $ newTVar M.empty
  let logsDir = getLogsDirectory dir
      logF logName f = do
        mHandle <- atomically $ do
          logsMap <- readTVar logsMapVar
          case M.lookup logName logsMap of
            Nothing -> do
              modifyTVar logsMapVar $ M.insert logName Nothing
              pure Nothing
            Just Nothing -> retry
            Just (Just h') -> pure $ Just h'
        h <- case mHandle of
          Just h' -> pure h'
          Nothing -> do
            h' <- openFile (logsDir </> T.unpack logName) AppendMode
            atomically . modifyTVar logsMapVar . M.insert logName $ Just h'
            pure h'
        runLoggingTWithHandle h f
  privKey <- liftIO $ do
    createDirectoryIfMissing True dir
    createDirectoryIfMissing True $ logsDir
    setCurrentDirectory dir
    privKeyFilePath <- resolvePath privKeyFile
    privBS <- catch (B.readFile privKeyFilePath) $ \(_ :: SomeException) -> do
      pk <- newPrivateKey
      let pkBytes = privToBytes $ pk
      B.writeFile privKeyFilePath pkBytes
      pure pkBytes
    case bsToPriv privBS of
      Left e -> error $ e ++ ": " ++ BC.unpack privBS
      Right p -> pure p
    -- either error id . bsToPriv <$> B.readFile privKeyFile
  (ethPool', cirrusPool') <- liftIO . logF "strato-setup" $ do
    eth' <- Lite.createSqlitePool "eth.sqlite" 1
    cirrus <- Lite.createSqlitePool "cirrus.sqlite" 1
    pure (eth', cirrus)
  liftIO . withResource ethPool' $ \c -> logF "strato-setup" $ do
    flip runReaderT c $ do
      Lite.runMigration DataDefs.migrateAuto
      -- Lite.runMigration DataDefs.indexAll
    setupSQL [] c
  sdb <- atomically $ newTVar M.empty
  hdb <- atomically $ newTVar M.empty
  cdb <- atomically $ newTVar M.empty
  bsdb <- atomically $ newTVar M.empty
  dbdb <- atomically $ newTVar M.empty
  cbdb <- atomically $ newTVar M.empty
  bdb <- atomically $ newTVar M.empty
  kvdb <- atomically $ newTVar M.empty
  let fsDBs = MemoryDBs
        { _memStateDB = sdb
        , _memHashDB = hdb
        , _memCodeDB = cdb
        , _memBlockSummaryDB = bsdb
        , _memDependentBlockDB = dbdb
        , _memCanonicalDB = cbdb
        , _memBlockDB = bdb
        , _memKVDB = kvdb
        , _memEthSqlPool = ethPool'
        , _memCirrusSqlPool = cirrusPool'
        }
  liftIO $ createMemoryPeerAndCorePeer network' privKey name tcpPort udpPort myHost valBehav (error "socket not initialized") fsDBs logF