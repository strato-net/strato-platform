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

module Strato.Lite.Filesystem where

import BlockApps.Logging
import Blockchain.Data.BlockDB ()
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.GenesisInfo
import Blockchain.Database.MerklePatricia.MPDB
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.Init.Generator (createGenesisInfo)
import Blockchain.Network
import Blockchain.Sequencer.DB.DependentBlockDB (DependentBlockDB(..))
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
import qualified Database.LevelDB as LDB
import qualified Database.Persist.Sqlite as Lite
import Blockchain.EthConf (ethConf, levelDBConfig)
import qualified Blockchain.EthConf.Model as Conf
import Executable.EthDiscoverySetup (setupSQL)
import GHC.Conc (retry)
import Network.Socket as S
import Strato.Lite.Base
import Strato.Lite.Base.Filesystem
import Strato.Lite.Core
import Strato.Lite.PEM
import Strato.Lite.Utils
import System.Directory
import System.FilePath
import UnliftIO
import Prelude hiding (round)

createFilesystemPeerAndCorePeer ::
  String ->
  PrivateKey ->
  Text ->
  TCPPort ->
  UDPPort ->
  Host ->
  Bool ->
  Socket ->
  FilesystemDBs ->
  (Text -> LoggingT IO () -> IO ()) ->
  IO (FilesystemPeer, CorePeer)
createFilesystemPeerAndCorePeer network' privKey name tcpPort udpPort myHost valBehav sock fsDBs logF = do
  bootNodes <- maybe [] (Host . T.pack . webAddress <$>) <$> getParams network'
  createGenesisInfo network'
  genesisInfo <- getGenesisInfo
  fsPeer <- createFilesystemPeerIO privKey tcpPort udpPort sock myHost bootNodes fsDBs
  corePeer <- createCorePeer network' (T.unpack name) genesisInfo valBehav logF
  pure (fsPeer, corePeer)

hoistFilesystem :: FilesystemPeer -> (forall a. FilesystemT (ReaderT MemPeerDBEnv BaseM) a -> BaseM a)
hoistFilesystem p f = runReaderT (runReaderT f p) (_filesystemPeerMap p)

runFilesystemNode
  :: FilesystemPeer
  -> CorePeer
  -> IO [Async ()]
runFilesystemNode p c = runNode (hoistFilesystem p) (\f ->
  bracket
    (connectMe $ _filesystemPeerUDPPort p)
    (\s -> liftIO $ S.close s >> putStrLn "Closed UDP socket")
    (\s -> local (filesystemPeerUDPSocket .~ s) f)) c

wipeFilesystemNode ::
  MonadIO m =>
  FilePath ->
  String ->
  String ->
  m ()
wipeFilesystemNode dir' network' name = do
  dir <- getNodeDirectory dir' network' name
  liftIO $ removeDirectoryRecursive dir

createFilesystemNode ::
  MonadResource m =>
  FilePath ->
  String ->
  FilePath ->
  Text ->
  TCPPort ->
  UDPPort ->
  Host ->
  Bool ->
  m (FilesystemPeer, CorePeer)
createFilesystemNode dir' network' privKeyFile name tcpPort udpPort myHost valBehav = do
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
    setupSQL Nothing c
  let ldbOptions =
        LDB.defaultOptions
          { LDB.createIfMissing = True,
            LDB.cacheSize = Conf.cacheSize (levelDBConfig ethConf),
            LDB.blockSize = Conf.blockSize (levelDBConfig ethConf)
          }
  let openDB base = LDB.open base ldbOptions
  sdb <- openDB "state"
  hdb <- openDB "hash"
  cdb <- openDB "code"
  bsdb <- openDB "block_summary"
  dbdb <- openDB "dependent_blocks"
  cbdb <- openDB "canonical_blocks"
  bdb <- openDB "blocks"
  kvdb <- openDB "kvs"
  let fsDBs = FilesystemDBs
        { _stateDB = StateDB sdb
        , _hashDB = HashDB hdb
        , _codeDB = CodeDB cdb
        , _blockSummaryDB = BlockSummaryDB bsdb
        , _dependentBlockDB = DependentBlockDB dbdb
        , _canonicalDB = cbdb
        , _blockDB = bdb
        , _kvDB = kvdb
        , _ethSqlPool = ethPool'
        , _cirrusSqlPool = cirrusPool'
        }
  liftIO $ createFilesystemPeerAndCorePeer network' privKey name tcpPort udpPort myHost valBehav (error "socket not initialized") fsDBs logF