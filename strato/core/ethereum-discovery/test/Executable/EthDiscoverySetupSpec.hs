{-# LANGUAGE OverloadedStrings #-}

module Executable.EthDiscoverySetupSpec where

import BlockApps.Logging (runNoLoggingT)
import Blockchain.DB.SQLDB (openPeerSqlite, runPeerStoreMigration)
import qualified Blockchain.Model.SyncTask as SYNCTASK
import Blockchain.Strato.Discovery.Data.Peer (PPeer, TCPPort (..), UDPPort (..))
import Control.Monad
import qualified Data.Text as T
import Database.Persist.Sql
import qualified Database.Sqlite as SQLITE3
import Executable.EthDiscoverySetup (setupSQL)
import System.FilePath ((</>))
import Test.Hspec
import UnliftIO
import UnliftIO.Concurrent (threadDelay)

-- | The peer store file of a node that has never started.
withNewPeerStore :: (FilePath -> IO a) -> IO a
withNewPeerStore act = withSystemTempDirectory "peer-store" $ \dir -> act (dir </> "peers.sqlite")

-- | A connection of its own, as each of the two processes has. SQLite
-- waits for a lock inside a foreign call, so the suite is linked -threaded
-- to let the thread that holds the lock go on meanwhile.
withConn :: FilePath -> (SqlBackend -> IO a) -> IO a
withConn path act = runNoLoggingT $ withSqlConn (openPeerSqlite path) (liftIO . act)

-- | What ethereum-discover runs on the peer store when it starts.
discoverSetup :: SqlBackend -> IO ()
discoverSetup = runNoLoggingT . setupSQL [("bootnode.example", UDPPort 30303, TCPPort 30303)]

-- | What strato-p2p runs on the peer store when it starts.
p2pSetup :: SqlBackend -> IO ()
p2pSetup = runSqlConn (runPeerStoreMigration SYNCTASK.migrateAll)

spec :: Spec
spec = describe "peer store setup on SQLite" $ do
  it "waits for a write lock the other process holds" $ withNewPeerStore $ \path -> do
    locked <- newEmptyMVar
    concurrently_
      ( withConn path . runSqlConn $ do
          rawExecute "CREATE TABLE held (x INTEGER)" []
          putMVar locked ()
          threadDelay 100000
      )
      (takeMVar locked >> withConn path p2pSetup)

  it "closes a connection whose switch to WAL had to be retried" $ withNewPeerStore $ \path -> do
    locked <- newEmptyMVar
    concurrently_
      ( bracket (SQLITE3.open $ T.pack path) SQLITE3.close $ \conn -> do
          exec conn "BEGIN IMMEDIATE"
          putMVar locked ()
          threadDelay 50000
          exec conn "COMMIT"
      )
      (takeMVar locked >> withConn path (const $ return ()))

  it "lets both processes set up a new peer store at the same moment" $
    replicateM_ 100 . withNewPeerStore $ \path -> do
      concurrently_ (withConn path discoverSetup) (withConn path p2pSetup)
      withConn path (runSqlConn $ count ([] :: [Filter PPeer])) `shouldReturn` 1
  where
    exec conn sql = bracket (SQLITE3.prepare conn sql) SQLITE3.finalize (void . SQLITE3.step)
