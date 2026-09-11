{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

-- | vm-query: eth_call against the SQL state mirror (phase 5 spike).
--
--   vm-query seed                          migrate the eth tables and insert the sample contract
--   vm-query selector "total(uint)"        4-byte selector for an ABI signature
--   vm-query call <to> <data> [n]          run the call n times: result, SQL round trips, latency
--   vm-query parity <to> <data>            same call on the trie-free in-memory VM seeded from SQL
--
-- Postgres comes from ethconf.yaml ($STRATO_CONF), as for every process.
module Main (main) where

import Blockchain.DB.CodeDB (DBCode)
import Blockchain.DB.MemAddressStateDB (putAddressState)
import Blockchain.DB.RawStorageDB (putRawStorageKeyVal')
import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.JsonRpcCommand (runJsonRpcCommand')
import Blockchain.MemVMContext (runMemContextM)
import Blockchain.Sequencer.Event (JsonRpcCommand (..), JsonRpcResponse (..))
import Blockchain.Sequencer.HexData (HexData (..))
import Blockchain.Sequencer.TxCallObject (TxCallObject (..))
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Blockchain.VMContext (ContextBestBlockInfo (..), ContextState (..))
import Blockchain.VMOptions ()
import Blockchain.VmQuery.Import (importFromNode)
import Blockchain.VmQuery.Seed
import Blockchain.VmQuery.Server (ServerConfig (..), serve)
import Blockchain.VmQuery.SqlContext
import qualified Data.Binary as Bin
import qualified Data.ByteString.Lazy as BL
import Network.HTTP.Client (httpLbs, method, newManager, parseRequest, requestBody, requestHeaders, responseBody, RequestBody (..), defaultManagerSettings)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad (forM, forM_)
import Control.Monad.Composable.SQL (createSQLDB, runSQLMWith)
import Control.Monad.IO.Class (liftIO)
import Control.Monad.Logger (filterLogger, runStderrLoggingT, LogLevel (..))
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List (sort)
import qualified Database.Persist as P
import Data.Text.Encoding (encodeUtf8)
import GHC.Clock (getMonotonicTimeNSec)
import HFlags
import System.Environment (lookupEnv)
import System.Exit (exitFailure)
import Text.Printf (printf)

defineFlag "port" (8546 :: Int) "Port for `vm-query serve`"
defineFlag "maxConcurrent" (16 :: Int) "Commands executing at once in `vm-query serve`; twice this many may wait, the rest are shed"
defineFlag "headerMaxAgeSeconds" (1.0 :: Double) "How long `vm-query serve` reuses the mirror's best block header before re-reading it"
defineFlag "poolSize" (8 :: Int) "Postgres connections for `vm-query serve`"
defineFlag "cacheMaxRows" (200000 :: Int) "Per-context cap on cached mirror storage rows in `vm-query serve`; past it the row cache is dropped and refilled"
defineFlag "prefetchMaxRows" (4096 :: Int) "Contracts with at most this many storage rows are read whole on first access; larger ones slot by slot (`vm-query serve` and `call`)"
defineFlag "prefetchAfterSlots" (64 :: Int) "A contract above the prefetch threshold is prefetched whole (up to the cache cap) once a context has read this many of its slots in one epoch; 0 disables"
defineFlag "snapshotMaxAgeSeconds" (30.0 :: Double) "Longest `vm-query serve` holds a block epoch's repeatable-read snapshot open before re-pinning on the same block"

-- HFlags only sees flags from earlier declaration groups; this splice ends the group.
$(return [])

main :: IO ()
main = do
  -- The VM's option flags are read at runtime; HFlags wants them initialised.
  args <- $initHFlags "vm-query: eth_call against the SQL state mirror"
  dispatch args

dispatch :: [String] -> IO ()
dispatch = \case
  ["seed"] -> withDb $ \db -> runLog (runSQLMWith db (migrateMirror >> seedSample)) >> putStrLn ("seeded " ++ show sampleAddress ++ " with " ++ show sampleMappingSize ++ " mapping keys")
  -- Rebuild the mirror rows a contract needs from a node's public read API
  -- (account, code, storage, best block), following proxies.
  ("import" : nodeUrl : addrs@(_ : _)) -> withDb $ \db -> do
    targets <- either die pure (mapM parseAddr addrs)
    runLog (runSQLMWith db migrateMirror)
    importFromNode db nodeUrl targets
  ["serve"] -> do
    db <- runLog (createSQLDB flags_poolSize)
    serve db ServerConfig {scPort = flags_port, scMaxConcurrent = flags_maxConcurrent, scHeaderMaxAgeSeconds = flags_headerMaxAgeSeconds, scSnapshotMaxAgeSeconds = flags_snapshotMaxAgeSeconds, scCacheMaxRows = flags_cacheMaxRows, scPrefetchMaxRows = flags_prefetchMaxRows, scPrefetchAfterSlots = flags_prefetchAfterSlots}
  -- The wire exchange ethereum-jsonrpc makes, for the harness; with a
  -- count, the same call back to back over one keep-alive connection.
  ("client" : url : toHex : dat : rest) -> do
    let n = case rest of
          (k : _) -> read k
          [] -> 1 :: Int
    cmd <- either die pure (mkCall toHex dat)
    manager <- newManager defaultManagerSettings
    initial <- parseRequest (url ++ "/command")
    let req = initial {method = "POST", requestHeaders = [("Content-Type", "application/octet-stream")], requestBody = RequestBodyLBS (Bin.encode cmd)}
    t0 <- getMonotonicTimeNSec
    results <- forM [1 .. n] $ \_ -> do
      resp <- httpLbs req manager
      case Bin.decodeOrFail (responseBody resp) of
        Left (_, _, err) -> die ("undecodable response: " ++ err ++ " " ++ show (BL.take 200 (responseBody resp)))
        Right (_, _, r) -> pure r
    t1 <- getMonotonicTimeNSec
    forM_ (take 1 results) $ \r -> putStrLn ("result: " ++ showResp r)
    if n > 1 then printf "%d round trips over one connection: %.2f ms each\n" n (fromIntegral (t1 - t0) / 1e6 / fromIntegral n :: Double) else pure ()
  ["selector", sig] -> BC.putStrLn $ "0x" <> B16.encode (B.take 4 (keccak256ToByteString (hash (BC.pack sig))))
  ("call" : toHex : dat : rest) -> withDb $ \db -> do
    let n = case rest of
          (k : _) -> read k
          [] -> 1 :: Int
    env <- newSqlQueryEnv db
    runSqlQueryM env (setCacheMaxRows flags_cacheMaxRows >> setPrefetchMaxRows flags_prefetchMaxRows >> setPrefetchAfterSlots flags_prefetchAfterSlots)
    cmd <- either die pure (mkCall toHex dat)
    -- VMQ_CALL_MODE=service resets the context exactly as the service does
    -- between requests, to compare the two entry points.
    mode <- lookupEnv "VMQ_CALL_MODE"
    best <- runSqlQueryM env bestHeader
    let prepare = if mode == Just "service" then resetForRequest best else pure ()
        wrap = if mode == Just "service" then id else withFreshOverlay
    results <- forM [1 .. n] $ \i -> runSqlQueryM env $ wrap $ do
      prepare
      resetRoundTrips
      t0 <- liftIO getMonotonicTimeNSec
      resp <- runJsonRpcCommand' cmd
      t1 <- liftIO getMonotonicTimeNSec
      trips <- readRoundTrips
      sqlNs <- readSqlNanos
      pure (i, resp, trips, fromIntegral (t1 - t0) / 1e6 :: Double, fromIntegral sqlNs / 1e6 :: Double)
    emptyReads <- runSqlQueryM env readEmptyTrieReads
    forM_ (take 1 results) $ \(_, resp, _, _, _) -> putStrLn ("result: " ++ showResp resp ++ "  (empty-trie root reads over all calls: " ++ show emptyReads ++ ")")
    forM_ (take 3 results) $ \(i, _, trips, ms, sqlMs) -> printf "call %d: %d SQL round trips, %.2f ms (%.2f ms in SQL)\n" i trips ms sqlMs
    let warm = drop 1 results
    if null warm then pure () else do
      let lat = sort [ms | (_, _, _, ms, _) <- warm]
          pct p = lat !! min (length lat - 1) (floor (p * fromIntegral (length lat) :: Double))
          trips = [t | (_, _, t, _, _) <- warm]
          sqlMean = sum [q | (_, _, _, _, q) <- warm] / fromIntegral (length warm)
      printf "warm calls: %d, SQL round trips per call: %d..%d, latency p50 %.2f ms, p95 %.2f ms, max %.2f ms, mean in SQL %.2f ms\n"
        (length warm) (minimum trips) (maximum trips) (pct 0.5) (pct 0.95) (last lat) sqlMean
  ["parity", toHex, dat] -> withDb $ \db -> do
    env <- newSqlQueryEnv db
    cmd <- either die pure (mkCall toHex dat)
    sqlResp <- runSqlQueryM env (withFreshOverlay (runJsonRpcCommand' cmd))
    -- The same call on the in-memory VM, seeded with exactly the rows the
    -- mirror holds for the target: same engine, same state, must agree.
    toAddr <- either die pure (parseAddr toHex)
    (mSt, storage, code, header) <- runLog . runSQLMWith db $ do
      st <- runSqlQueryM' env (loadAddressState toAddr)
      rows <- sqlQuery $ do
        macct <- P.getBy (UniqueAddress toAddr)
        case macct of
          Nothing -> pure []
          Just (P.Entity sid _) -> map P.entityVal <$> P.selectList [StorageAddressStateRefId P.==. sid] []
      codes <- sqlQuery $ map P.entityVal <$> P.selectList [] []
      h <- runSqlQueryM' env bestHeader
      pure (st, rows, codes, h)
    memResp <- runLog $ do
      (r, _) <- runMemContextM Nothing $ do
        forM_ mSt $ putAddressState toAddr
        forM_ code $ \c -> A.insert (A.Proxy @DBCode) (codeRefCodeHash c) (encodeUtf8 (codeRefCode c))
        forM_ storage $ \s -> putRawStorageKeyVal' (toAddr, storageKey s) (storageValue s)
        forM_ header $ \h -> Mod.modify_ (Mod.Proxy @ContextState) (\cs -> pure cs {_bestBlockInfo = ContextBestBlockInfo (hash "") h 0})
        runJsonRpcCommand' cmd
      pure r
    putStrLn ("sql:    " ++ showResp sqlResp)
    putStrLn ("memory: " ++ showResp memResp)
    if showResp sqlResp == showResp memResp then putStrLn "parity: OK" else putStrLn "parity: MISMATCH" >> exitFailure
  _ -> die "usage: vm-query seed | import <nodeUrl> <address>... | serve | selector <sig> | call <to> <data> [n] | parity <to> <data> | client <url> <to> <data> [n]"
  where
    runLog = runStderrLoggingT . filterLogger (\_ lvl -> lvl >= LevelWarn)
    runSqlQueryM' env m = liftIO (runSqlQueryM env m)
    withDb f = do
      db <- runLog (createSQLDB 4)
      f db
    die msg = putStrLn msg >> exitFailure >> error "unreachable"
    parseAddr s = case B16.decode (BC.pack (dropPrefix s)) of
      Right b | B.length b == 20 -> Right (Address (B.foldl' (\acc w -> acc * 256 + fromIntegral w) 0 b))
      _ -> Left ("bad address " ++ s)
    dropPrefix ('0' : 'x' : r) = r
    dropPrefix r = r
    mkCall toHex dat = do
      toAddr <- parseAddr toHex
      bytes <- either (const (Left ("bad hex data " ++ dat))) Right (B16.decode (BC.pack (dropPrefix dat)))
      pure $ JRCCall (TxCallObject {from = Address 0, to = Just toAddr, gas = "0x0", gasPrice = "0x0", value = "0x0", data_ = HexData bytes}) "vm-query" "latest"
    showResp (Success _ b) = "0x" ++ BC.unpack (B16.encode b)
    showResp (Error _ e) = "error: " ++ show e
    showResp (SuccessJson _ v) = "json: " ++ show v
