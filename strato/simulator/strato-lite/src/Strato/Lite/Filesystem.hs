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
-- import Blockchain.GenesisBlocks.Contracts.Governance
import Blockchain.GenesisBlocks.Contracts.GovernanceV2
-- import Blockchain.GenesisBlocks.HeliumGenesisBlock as Helium
-- import qualified Blockchain.GenesisBlocks.ProductionGenesisBlock as Production
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
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Pool (withResource)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Database.LevelDB as LDB
import qualified Database.Persist.Sqlite as Lite
import Executable.EVMFlags
import Executable.EthDiscoverySetup (setupSQL)
import Network.Socket as S
import Strato.Lite.Base
import Strato.Lite.Base.Filesystem
import Strato.Lite.Core
import System.Directory
import UnliftIO
import Prelude hiding (round)

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
  [Host] ->
  Bool ->
  Socket ->
  FilesystemDBs ->
  IO (FilesystemPeer, CorePeer)
createFilesystemPeerAndCorePeer network' privKey selfId name tcpPort udpPort myHost bootNodes valBehav sock fsDBs = do
  let privAndIds = [(privKey, selfId)]
      validatorsPrivKeys = id privAndIds
      vals' = makeValidators validatorsPrivKeys
  certs <- liftIO $ traverse (uncurry selfSignCert) privAndIds
  fsPeer <- createFilesystemPeerIO privKey tcpPort udpPort sock myHost bootNodes fsDBs
  let vals = snd <$> vals'
      genesisInfo = insertBitcoinBridgeContract
                  . insertMercataGovernanceContract vals ((\(Validator v) -> v) <$> take 1 vals)
                  $ insertCertRegistryContract certs defaultGenesisInfo
  -- let genesisInfo = Production.productionGenesisBlock
  -- let genesisInfo = Helium.genesisBlock
  corePeer <- createCorePeer network' (T.unpack name) selfId genesisInfo valBehav
  pure (fsPeer, corePeer)

hoistFilesystem :: FilesystemPeer -> (forall a. FilesystemT (ReaderT MemPeerDBEnv BaseM) a -> BaseM a)
hoistFilesystem p f = runReaderT (runReaderT f p) (_filesystemPeerMap p)

runFilesystemNode :: FilesystemPeer -> CorePeer -> BaseM [Async ()]
runFilesystemNode p c = runNode (hoistFilesystem p) (\f ->
  bracket
    (connectMe $ _filesystemPeerUDPPort p)
    (liftIO . S.close)
    (\s -> local (filesystemPeerUDPSocket .~ s) f)) c

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
  [Host] ->
  Bool ->
  m (FilesystemPeer, CorePeer)
createFilesystemNode dir dbPath network' privKeyFile selfId name tcpPort udpPort myHost bootNodes valBehav = do
  privKey <- liftIO $ do
    createDirectoryIfMissing True dir
    setCurrentDirectory dir
    privBS <- B.readFile privKeyFile
    case bsToPriv privBS of
      Left e -> error $ e ++ ": " ++ BC.unpack privBS
      Right p -> pure p
    -- either error id . bsToPriv <$> B.readFile privKeyFile
  conn <- liftIO . loggingFunc $ Lite.createSqlitePool (T.pack dbPath) 20
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
  liftIO $ createFilesystemPeerAndCorePeer network' privKey selfId name tcpPort udpPort myHost bootNodes valBehav (error "socket not initialized") fsDBs