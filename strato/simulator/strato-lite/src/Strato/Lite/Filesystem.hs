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
import BlockApps.X509.Certificate as X509
import BlockApps.X509.Keys as X509
import Blockchain.Data.BlockDB ()
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.GenesisInfo
import Blockchain.Database.MerklePatricia.MPDB
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.GenesisBlocks.Contracts.BitcoinBridge
import Blockchain.GenesisBlocks.Contracts.CertRegistry
import Blockchain.GenesisBlocks.Contracts.GovernanceV2
import Blockchain.GenesisBlocks.HeliumGenesisBlock as Helium
import qualified Blockchain.GenesisBlocks.ProductionGenesisBlock as Production
import Blockchain.Network
import Blockchain.Sequencer.DB.DependentBlockDB (DependentBlockDB(..))
import Blockchain.Strato.Discovery.Data.MemPeerDB
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.UDPServer (connectMe)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Conduit
import Control.Lens ((.~))
import Control.Monad.Reader
import qualified Data.Aeson as JSON
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.List (isPrefixOf)
import qualified Data.Map.Strict as M
import Data.Pool (withResource)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Database.LevelDB as LDB
import qualified Database.Persist.Sqlite as Lite
import Executable.EVMFlags
import Executable.EthDiscoverySetup (setupSQL)
import GHC.Conc (retry)
import Network.Socket as S
import Strato.Lite.Base
import Strato.Lite.Base.Filesystem
import Strato.Lite.Core
import System.Directory
import System.FilePath
import UnliftIO
import Prelude hiding (round)

expandHome :: MonadIO m => FilePath -> m FilePath
expandHome path
  | "~/" `isPrefixOf` path = do
      home <- liftIO getHomeDirectory
      pure $ home </> drop 2 path
  | otherwise = pure path

resolvePath :: MonadIO m => FilePath -> m FilePath
resolvePath path = do
  expanded <- expandHome path
  if isAbsolute expanded
    then pure expanded
    else liftIO $ makeAbsolute expanded

makeValidators :: [(PrivateKey, a)] -> [(Address, a)]
makeValidators = map (\(a,b) -> (fromPrivateKey a, b))

selfSignCert :: PrivateKey -> Validator -> IO X509Certificate
selfSignCert pk (Validator c) = flip runReaderT pk $ do
  let iss = Issuer (T.unpack c) "" (Just "") Nothing
      sub = Subject (T.unpack c) "" (Just "") Nothing (derivePublicKey pk)
  makeSignedCert Nothing Nothing iss sub

createFilesystemPeerAndCorePeer ::
  String ->
  PrivateKey ->
  Validator ->
  Text ->
  TCPPort ->
  UDPPort ->
  Host ->
  Bool ->
  Socket ->
  FilesystemDBs ->
  (Text -> LoggingT IO () -> IO ()) ->
  IO (FilesystemPeer, CorePeer)
createFilesystemPeerAndCorePeer network' privKey selfId name tcpPort udpPort myHost valBehav sock fsDBs logF = do
  bootNodes <- maybe [] (Host . T.pack . webAddress <$>) <$> getParams network'
  genesisInfo' <- case network' of
    "mercata" -> pure Production.productionGenesisBlock
    "mercata-hydrogen" -> pure Production.productionGenesisBlock
    "helium" -> pure Helium.genesisBlock
    _ -> do
      let privAndIds = [(privKey, selfId)]
          validatorsPrivKeys = id privAndIds
          vals' = makeValidators validatorsPrivKeys
      certs <- liftIO $ traverse (uncurry selfSignCert) privAndIds
      let vals = snd <$> vals'
      pure . insertBitcoinBridgeContract
           . insertMercataGovernanceContract vals ((\(Validator v) -> v) <$> take 1 vals)
           $ insertCertRegistryContract certs defaultGenesisInfo
  B.writeFile "genesis.json" . BL.toStrict $ JSON.encode genesisInfo'
  genesisInfo <- getGenesisInfo
  fsPeer <- createFilesystemPeerIO privKey tcpPort udpPort sock myHost bootNodes fsDBs
  corePeer <- createCorePeer network' (T.unpack name) selfId genesisInfo valBehav logF
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

getNodeDirectory :: MonadIO m => FilePath -> String -> String -> m FilePath
getNodeDirectory dir' network' nodeName = do
  dir <- resolvePath dir'
  pure $ dir </> network' </> nodeName

getLogsDirectory :: FilePath -> FilePath
getLogsDirectory = (</> "logs")

wipeFilesystemNode ::
  MonadIO m =>
  FilePath ->
  String ->
  String ->
  m ()
wipeFilesystemNode dir' network' name = do
  dir <- getNodeDirectory dir' network' name
  liftIO $ removeDirectoryRecursive dir

getFilesystemLogs ::
  (MonadUnliftIO m, MonadThrow m) =>
  FilePath ->
  String ->
  String ->
  String ->
  Bool ->
  m ()
getFilesystemLogs dir' network' name logFileName _ = do
  dir <- getNodeDirectory dir' network' name
  let logsDir = getLogsDirectory dir
      logFilePath = logsDir </> logFileName
  runConduitRes $ sourceFile logFilePath .| decodeUtf8C .| awaitForever (liftIO . putStr . T.unpack)

createFilesystemNode ::
  MonadResource m =>
  FilePath ->
  FilePath ->
  String ->
  FilePath ->
  Validator ->
  Text ->
  TCPPort ->
  UDPPort ->
  Host ->
  Bool ->
  m (FilesystemPeer, CorePeer)
createFilesystemNode dir' dbPath network' privKeyFile selfId name tcpPort udpPort myHost valBehav = do
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
  conn <- liftIO . loggingFunc $ Lite.createSqlitePool (T.pack dbPath) 1
  liftIO . withResource conn $ \c -> loggingFunc $ do
    flip runReaderT c $ do
      Lite.runMigration DataDefs.migrateAuto
      -- Lite.runMigration DataDefs.indexAll
    setupSQL Nothing c
  let ldbOptions =
        LDB.defaultOptions
          { LDB.createIfMissing = True,
            LDB.cacheSize = flags_ldbCacheSize,
            LDB.blockSize = flags_ldbBlockSize
          }
  let openDB base = LDB.open base ldbOptions
  sdb <- openDB "state"
  hdb <- openDB "hash"
  cdb <- openDB "code"
  bsdb <- openDB "block_summary"
  dbdb <- openDB "dependent_blocks"
  xdb <- openDB "x509"
  cbdb <- openDB "canonical_blocks"
  bdb <- openDB "blocks"
  kvdb <- openDB "kvs"
  let fsDBs = FilesystemDBs
        { _stateDB = StateDB sdb
        , _hashDB = HashDB hdb
        , _codeDB = CodeDB cdb
        , _blockSummaryDB = BlockSummaryDB bsdb
        , _dependentBlockDB = DependentBlockDB dbdb
        , _x509DB = xdb
        , _canonicalDB = cbdb
        , _blockDB = bdb
        , _kvDB = kvdb
        , _sqlPool = conn
        }
  liftIO $ createFilesystemPeerAndCorePeer network' privKey selfId name tcpPort udpPort myHost valBehav (error "socket not initialized") fsDBs logF