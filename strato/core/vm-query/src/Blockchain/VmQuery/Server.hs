{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | vm-query as a service: vm-runner's JSON-RPC commands over HTTP, executed
-- against the SQL state mirror. ethereum-jsonrpc posts a command here
-- instead of onto the consensus VM's queue; the reply is the same
-- 'JsonRpcResponse' it would have read from the queue.
--
--   POST /command   body: Binary-encoded JsonRpcCommand -> Binary-encoded JsonRpcResponse
--   GET  /health    the mirror's best block and its age
--   GET  /metrics   Prometheus
--
-- The mirror is latest-only, so a command that names another block is
-- answered with an @Error@ whose message starts with @vm-query:@, which the
-- caller treats as "ask the consensus VM instead".
module Blockchain.VmQuery.Server
  ( ServerConfig (..),
    serve,
    routable,
  )
where

import Blockchain.DB.SQLDB (SQLDB (..))
import Blockchain.EthConf (connStr, readerConnStr)
import Blockchain.Data.DataDefs (EntityField (BlockDataRefNumber))
import Blockchain.Data.BlockHeader (BlockHeader (..))
import Blockchain.JsonRpcCommand (runJsonRpcCommand')
import Blockchain.Sequencer.Event (JsonRpcCommand (..), JsonRpcResponse (..))
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.Keccak256 (keccak256ToHex)
import Blockchain.VmQuery.SqlContext
import Control.Concurrent (forkIO, runInBoundThread, threadDelay)
import Control.Concurrent.MVar
import Control.Concurrent.QSem
import Control.Concurrent.STM
import Control.Exception (IOException, SomeException, bracket, bracket_, displayException, fromException, throwIO, try)
import Control.Monad (forever, void, when)
import Control.Monad.Trans.Reader (runReaderT)
import Control.Monad.Trans.Resource (ResourceT, runResourceT)
import Data.Pool (destroyResource, putResource, takeResource)
import Database.Persist (Entity (..), SelectOpt (..), selectFirst)
import Database.Persist.Sql (SqlBackend, SqlPersistT, rawExecute)
import Database.PostgreSQL.Simple (SqlError (..))
import qualified Data.Aeson as Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as B8
import qualified Data.Binary as Bin
import Data.Default (def)
import Data.IORef
import qualified Data.Text as T
import Data.Time.Clock (UTCTime, addUTCTime, diffUTCTime, getCurrentTime)
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import GHC.Clock (getMonotonicTimeNSec)
import System.Environment (lookupEnv)
import Network.HTTP.Types (methodGet, methodPost, status200, status404, status405, status503)
import Network.Wai
import Network.Wai.Handler.Warp (run)
import Network.Wai.Middleware.Prometheus (prometheus)
import Prometheus
import Strato.Tracing (initTracing)
import System.IO (BufferMode (..), hSetBuffering, stdout)
import Strato.Tracing.Wai (tracingMiddleware)

data ServerConfig = ServerConfig
  { scPort :: Int,
    -- | Commands executing at once; the rest wait, and past twice this
    -- many waiting the request is shed with 503.
    scMaxConcurrent :: Int,
    -- | How long the best block header is reused before being re-read.
    scHeaderMaxAgeSeconds :: Double,
    -- | Longest a block epoch's snapshot transaction is held open before
    -- being re-pinned on the same block.
    scSnapshotMaxAgeSeconds :: Double,
    -- | Per-context cap on cached storage rows (see SqlContext).
    scCacheMaxRows :: Int,
    scPrefetchMaxRows :: Int,
    scPrefetchAfterSlots :: Int
  }

{-# NOINLINE requestsTotal #-}
requestsTotal :: Vector Label2 Counter
requestsTotal = unsafeRegister . vector ("command", "outcome") . counter $ Info "vm_query_requests_total" "Commands served, by command type and outcome (ok, error, declined, shed)"

{-# NOINLINE commandSeconds #-}
commandSeconds :: Vector Label1 Histogram
commandSeconds = unsafeRegister . vector "command" . histogram (Info "vm_query_command_seconds" "Command execution time") $ [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]

{-# NOINLINE inFlight #-}
inFlight :: Gauge
inFlight = unsafeRegister . gauge $ Info "vm_query_in_flight" "Commands executing now"

{-# NOINLINE poolIdle #-}
poolIdle :: Gauge
poolIdle = unsafeRegister . gauge $ Info "vm_query_pool_idle" "Prepared contexts waiting for a request"

-- | Contexts are reused across requests: allocating one costs a tx-run
-- cache and a handful of references, and resetting it is cheaper. The
-- semaphore already bounds how many are out at once, so the pool never
-- holds more than that many.
newtype ContextPool = ContextPool (TVar [SqlQueryEnv])

withContext :: SQLDB -> ContextPool -> Maybe BlockHeader -> (SqlQueryEnv -> IO a) -> IO a
withContext db (ContextPool ref) best act = bracket acquire release act
  where
    acquire = do
      mEnv <- atomically $ readTVar ref >>= \case
        (e : rest) -> writeTVar ref rest >> pure (Just e)
        [] -> pure Nothing
      env <- maybe (newSqlQueryEnvWith db Nothing) pure mEnv
      runSqlQueryM env (resetForRequest best)
      setGauge poolIdle . fromIntegral . length =<< readTVarIO ref
      pure env
    release env = do
      atomically $ modifyTVar' ref (env :)
      setGauge poolIdle . fromIntegral . length =<< readTVarIO ref

-- | One block epoch's view of the mirror: a repeatable-read, read-only
-- transaction held open on a pooled connection, with the best header read
-- inside it. Every cache miss of the epoch runs on it, so the rows and the
-- header are one consistent state. Requests hold it by reference count;
-- when the best block advances the epoch is retired and its connection
-- goes back to the pool once the last request using it has finished.
data Snapshot = Snapshot
  { snapHeader :: Maybe BlockHeader,
    snapConn :: MVar SqlBackend,
    snapUsers :: IORef Int,
    snapRetired :: IORef Bool,
    -- | Set when a query on the pinned connection failed (a reader endpoint
    -- cancels transactions that conflict with replay, or drops them on a
    -- failover): the next refresh replaces the epoch whatever the block.
    snapBroken :: IORef Bool,
    snapOpened :: UTCTime,
    -- | Ends the transaction and returns the connection to the pool.
    snapClose :: IO ()
  }

-- | Open an epoch on the mirror's read endpoint ('sqlReaderPool': the
-- replica when 'sqlReaderConfig' is set, else the writer). Reads through
-- the epoch are as fresh as that endpoint, and the header is read on the
-- same connection so a call's rows always match the block it runs against.
openSnapshot :: SQLDB -> IO Snapshot
openSnapshot db = do
  (backend, local) <- takeResource (sqlReaderPool db)
  let onConn :: SqlPersistT (ResourceT IO) a -> IO a
      onConn q = runResourceT (runReaderT q backend)
  r <- try $ do
    onConn $ rawExecute "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" []
    fmap (bdrToHeader . entityVal) <$> onConn (selectFirst [] [Desc BlockDataRefNumber])
  case r of
    Left (e :: SomeException) -> do
      -- A connection that failed to open a transaction is not reused.
      destroyResource (sqlReaderPool db) local backend
      throwIO e
    Right header -> do
      now <- getCurrentTime
      conn <- newMVar backend
      users <- newIORef 0
      retired <- newIORef False
      broken <- newIORef False
      let close = do
            wasBroken <- readIORef broken
            ended <- try (withMVar conn $ \b -> runResourceT (runReaderT (rawExecute "ROLLBACK" []) b)) :: IO (Either SomeException ())
            case ended of
              Right () | not wasBroken -> putResource local backend
              -- A connection whose transaction failed is not returned to
              -- the pool: the failure may have been the connection itself.
              _ -> destroyResource (sqlReaderPool db) local backend
      pure Snapshot {snapHeader = header, snapConn = conn, snapUsers = users, snapRetired = retired, snapBroken = broken, snapOpened = now, snapClose = close}

-- | Take a reference to the current epoch for the duration of a request.
withSnapshot :: IORef Snapshot -> (Snapshot -> IO a) -> IO a
withSnapshot ref act = bracket acquire release act
  where
    acquire = do
      snap <- readIORef ref
      atomicModifyIORef' (snapUsers snap) (\n -> (n + 1, ()))
      pure snap
    release snap = do
      left <- atomicModifyIORef' (snapUsers snap) (\n -> (n - 1, n - 1))
      retired <- readIORef (snapRetired snap)
      when (retired && left == 0) $ snapClose snap

-- | Every header refresh interval, look at the mirror through a fresh
-- transaction. If the best block is unchanged and the epoch's transaction
-- is younger than the maximum, keep the epoch (the candidate is closed);
-- otherwise the candidate becomes the epoch, the old one is retired, and
-- its connection returns to the pool once its last request finishes. A
-- reader endpoint may cancel long transactions, which is what the maximum
-- age is for: re-pinning on the same block keeps every cache valid.
-- Rotation is serialised so two refreshes cannot both retire the epoch.
refreshSnapshot :: SQLDB -> ServerConfig -> MVar () -> IORef UTCTime -> IORef Snapshot -> IO Snapshot
refreshSnapshot db cfg lock lastCheck ref = do
  now <- getCurrentTime
  checked <- readIORef lastCheck
  if realToFrac (now `diffUTCTime` checked) < scHeaderMaxAgeSeconds cfg
    then readIORef ref
    else withMVar lock $ \() -> do
      checked' <- readIORef lastCheck
      if realToFrac (now `diffUTCTime` checked') < scHeaderMaxAgeSeconds cfg
        then readIORef ref
        else do
          current <- readIORef ref
          candidate <- openSnapshot db
          writeIORef lastCheck now
          broken <- readIORef (snapBroken current)
          let same = (blockHeaderHash <$> snapHeader candidate) == (blockHeaderHash <$> snapHeader current)
              epochAge = realToFrac (now `diffUTCTime` snapOpened current) :: Double
          if same && not broken && epochAge < scSnapshotMaxAgeSeconds cfg
            then snapClose candidate >> pure current
            else do
              putStrLn $ "vm-query: epoch now block " ++ maybe "none" (show . number) (snapHeader candidate) ++ (if broken then " after a mirror failure" else "") ++ "; previous epoch was " ++ show (round epochAge :: Int) ++ " s old"
              writeIORef ref candidate
              writeIORef (snapRetired current) True
              users <- readIORef (snapUsers current)
              when (users == 0) $ snapClose current
              pure candidate

-- | Which eth endpoint the epochs read: "reader" when 'sqlReaderConfig'
-- names one, else "writer".
sqlEndpoint :: String
sqlEndpoint = if readerConnStr == connStr then "writer" else "reader"

-- | A failure of the mirror connection itself (as opposed to a VM error or
-- a trie access): the epoch is unusable and the command is retried once on
-- a fresh one.
mirrorFailure :: SomeException -> Maybe String
mirrorFailure e
  | Just SqlError {sqlErrorMsg = msg, sqlExecStatus = st} <- fromException e = Just (if B.null msg then "connection lost, " ++ show st else B8.unpack msg)
  | Just (io :: IOException) <- fromException e = Just (displayException io)
  | otherwise = Nothing

-- | Whether the mirror can answer the command: latest state only, and only
-- the read commands. Anything else is declined for the consensus VM.
routable :: JsonRpcCommand -> Maybe BlockHeader -> Either String ()
routable cmd best = case cmd of
  JRCCall {} -> Right ()
  JRCCallV2 {jrcHeader = Nothing} -> Right ()
  JRCTraceCall {jrcHeader = Nothing} -> Right ()
  JRCCallV2 {jrcHeader = Just h} -> latest h
  JRCTraceCall {jrcHeader = Just h} -> latest h
  JRCSimulate {jrcHeader = Nothing} -> Right ()
  JRCSimulate {jrcHeader = Just h} -> latest h
  JRCTraceBlockTxs {} -> Left "vm-query: block replay needs the parent state, which the mirror does not hold"
  _ -> Left "vm-query: command is not served from the mirror"
  where
    latest h = case best of
      Just b | blockHeaderHash b == blockHeaderHash h -> Right ()
      _ -> Left ("vm-query: latest state only, block " ++ show (number h) ++ " requested")

serve :: SQLDB -> ServerConfig -> IO ()
serve db cfg = do
  hSetBuffering stdout LineBuffering
  initTracing "vm-query"
  snapRef <- newIORef =<< openSnapshot db
  lastCheck <- newIORef =<< getCurrentTime
  rotateLock <- newMVar ()
  sem <- newQSem (scMaxConcurrent cfg)
  waiting <- newIORef (0 :: Int)
  pool <- ContextPool <$> newTVarIO []
  putStrLn $ "vm-query serving on port " ++ show (scPort cfg) ++ ", reading the mirror through the " ++ sqlEndpoint ++ " endpoint"
  when (sqlEndpoint == "writer") $ putStrLn "vm-query: no sqlReaderConfig, so reads go to the writer; point sqlReaderConfig at the reader before scaling this out"
  -- Epochs are otherwise refreshed only by requests, so an idle server
  -- would hold its first epoch's repeatable-read transaction open for as
  -- long as it lives. A snapshot that old is more than stale: an Aurora
  -- reader reports its oldest snapshot to the writer, which then cannot
  -- vacuum anything newer, so one idle vm-query froze the writer's dead
  -- rows in place for 18 hours and slowed the indexer to a crawl. The
  -- timer keeps every epoch's transaction within snapshotMaxAge.
  void . forkIO . forever $ do
    threadDelay (max 1000000 (round (scSnapshotMaxAgeSeconds cfg * 1000000)))
    r <- try (refreshSnapshot db cfg rotateLock lastCheck snapRef) :: IO (Either SomeException Snapshot)
    either (\e -> putStrLn ("vm-query: timed epoch refresh failed: " ++ displayException e)) (const (pure ())) r
  run (scPort cfg) . prometheus def . tracingMiddleware "vm-query" $ app db cfg (rotateLock, lastCheck, snapRef) sem waiting pool

app :: SQLDB -> ServerConfig -> (MVar (), IORef UTCTime, IORef Snapshot) -> QSem -> IORef Int -> ContextPool -> Application
app db cfg (rotateLock, lastCheck, snapRef) sem waiting pool req respond = case (requestMethod req, pathInfo req) of
  (m, ["health"]) | m == methodGet -> do
    snap <- refreshSnapshot db cfg rotateLock lastCheck snapRef
    now <- getCurrentTime
    let body = case snapHeader snap of
          Nothing -> Aeson.object ["ok" .= False, "reason" .= ("mirror has no blocks" :: T.Text)]
          Just hdr ->
            Aeson.object
              [ "ok" .= True,
                "bestBlock" .= number hdr,
                "bestBlockHash" .= keccak256ToHex (blockHeaderHash hdr),
                "bestBlockAgeSeconds" .= (realToFrac (now `diffUTCTime` timestamp hdr) :: Double),
                "bestBlockTimestamp" .= (realToFrac (utcTimeToPOSIXSeconds (timestamp hdr)) :: Double),
                "snapshotAgeSeconds" .= (realToFrac (now `diffUTCTime` snapOpened snap) :: Double),
                "cacheMaxRows" .= scCacheMaxRows cfg,
                "prefetchMaxRows" .= scPrefetchMaxRows cfg,
                "prefetchAfterSlots" .= scPrefetchAfterSlots cfg,
                "sqlEndpoint" .= T.pack sqlEndpoint
              ]
    respond $ responseLBS status200 [("Content-Type", "application/json")] (Aeson.encode body)
  (m, ["command"]) | m == methodPost -> do
    body <- strictRequestBody req
    case Bin.decodeOrFail body of
      Left (_, _, err) -> reply (Error "?" ("vm-query: undecodable command: " ++ err))
      Right (_, _, cmd) -> do
        void $ refreshSnapshot db cfg rotateLock lastCheck snapRef
        snapNow <- readIORef snapRef
        let best = snapHeader snapNow
        case routable cmd best of
          Left why -> do
            count cmd "declined"
            reply (Error (jrcId cmd) why)
          Right () -> do
            queued <- atomicModifyIORef' waiting (\n -> (n + 1, n + 1))
            if queued > 2 * scMaxConcurrent cfg
              then do
                void $ atomicModifyIORef' waiting (\n -> (n - 1, ()))
                count cmd "shed"
                respond $ responseLBS status503 [("Content-Type", "text/plain")] "vm-query: too many commands in flight"
              else do
                resp <- bracket_ (waitQSem sem >> incGauge inFlight) (signalQSem sem >> decGauge inFlight >> atomicModifyIORef' waiting (\n -> (n - 1, ()))) $ do
                  first <- withSnapshot snapRef $ \snap -> execute db cfg pool snap cmd
                  case first of
                    -- The epoch's connection failed under this command:
                    -- rotate now (the refresh replaces a broken epoch) and
                    -- run it once more on the new one.
                    Left why -> do
                      putStrLn $ "vm-query: mirror connection failed (" ++ why ++ "); reopening the snapshot"
                      count cmd "mirror_failure"
                      writeIORef lastCheck . addUTCTime (-86400) =<< getCurrentTime
                      void $ refreshSnapshot db cfg rotateLock lastCheck snapRef
                      second <- withSnapshot snapRef $ \snap -> execute db cfg pool snap cmd
                      pure $ either (\why' -> Error (jrcId cmd) ("vm-query: mirror connection failed twice: " ++ why')) id second
                    Right r -> pure r
                count cmd (case resp of Error {} -> "error"; _ -> "ok")
                reply resp
  _ -> respond $ responseLBS (if pathInfo req `elem` [["command"], ["health"]] then status405 else status404) [] ""
  where
    reply r = respond $ responseLBS status200 [("Content-Type", "application/octet-stream")] (Bin.encode r)
    count cmd outcome = withLabel requestsTotal (commandName cmd, outcome) incCounter

-- | One command on a pooled context: the overlay, caches and best block are
-- reset per request; the code collection cache is process-wide.
execute :: SQLDB -> ServerConfig -> ContextPool -> Snapshot -> JsonRpcCommand -> IO (Either String JsonRpcResponse)
execute db cfg pool snap cmd = do
  t0 <- getMonotonicTimeNSec
  (r, tAcquired, tRan) <- withContext db pool (snapHeader snap) $ \env -> do
    runSqlQueryM env (setSnapshot (Just (snapConn snap)) >> setCacheMaxRows (scCacheMaxRows cfg) >> setPrefetchMaxRows (scPrefetchMaxRows cfg) >> setPrefetchAfterSlots (scPrefetchAfterSlots cfg))
    ta <- getMonotonicTimeNSec
    -- On a bound thread: libpq's calls and socket waits from an unbound
    -- warp thread cost about twice the time of the same round trips from a
    -- bound one (measured 4.4 ms vs 2.3 ms for two queries).
    r <- runInBoundThread $ try $ runSqlQueryM env (runJsonRpcCommand' cmd)
    tr <- getMonotonicTimeNSec
    trips <- runSqlQueryM env readRoundTrips
    sqlNs <- runSqlQueryM env readSqlNanos
    pure (r, ta, (tr, (trips, sqlNs)))
  t1 <- getMonotonicTimeNSec
  timing <- lookupEnv "VM_QUERY_TIMING"
  case timing of
    Just _ -> putStrLn $ "timing " ++ T.unpack (commandName cmd) ++ ": acquire+reset " ++ show ((tAcquired - t0) `div` 1000) ++ " us, run " ++ show ((fst tRan - tAcquired) `div` 1000) ++ " us, " ++ show (fst (snd tRan)) ++ " sql round trips taking " ++ show (snd (snd tRan) `div` 1000) ++ " us, release " ++ show ((t1 - fst tRan) `div` 1000) ++ " us"
    Nothing -> pure ()
  withLabel commandSeconds (commandName cmd) (`observe` (fromIntegral (t1 - t0) / 1e9))
  case r of
    Right resp -> pure (Right resp)
    Left (e :: SomeException) -> case fromException e of
      Just (TrieAccess what) -> pure $ Right $ Error (jrcId cmd) ("vm-query: trie access, not served from the mirror: " ++ what)
      Nothing -> case mirrorFailure e of
        Just why -> do
          writeIORef (snapBroken snap) True
          pure (Left why)
        Nothing -> pure $ Right $ Error (jrcId cmd) ("vm-query: internal: " ++ displayException e)

commandName :: JsonRpcCommand -> T.Text
commandName = \case
  JRCCall {} -> "call"
  JRCCallV2 {} -> "callV2"
  JRCTraceCall {} -> "traceCall"
  JRCTraceBlockTxs {} -> "traceBlockTxs"
  JRCSimulate {} -> "simulate"
  JRCGetBalance {} -> "getBalance"
  JRCGetCode {} -> "getCode"
  JRCGetTransactionCount {} -> "getTransactionCount"
  JRCGetStorageAt {} -> "getStorageAt"

(.=) :: Aeson.ToJSON v => Aeson.Key -> v -> (Aeson.Key, Aeson.Value)
k .= v = (k, Aeson.toJSON v)
