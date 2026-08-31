{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

-- Isolated apply harness: dump OutputBlocks from Kafka, then replay them
-- through processBlocks. Exits non-zero on any state-root / verify failure.
module Main where

import BlockApps.Init
import BlockApps.Logging
import Blockchain.DB.ChainDB (bootstrapChainDB, getChainStateRoot)
import Blockchain.DB.StateDB (setStateDBStateRoot)
import Blockchain.Data.AddressStateDB (AddressState (..))
import Blockchain.Data.BlockHeader (number, stateRoot)
import Blockchain.Data.GenesisBlock (genesisInfoToBlock)
import Blockchain.Data.GenesisInfo (getGenesisInfo)
import qualified Blockchain.Data.GenesisInfo as Genesis
import Blockchain.EthConf (runStreamMConfigured)
import Blockchain.Event (BlockVerificationFailure, VmOutEvent (..))
import Blockchain.Model.WrappedBlock (OutputBlock (..), OutputTx (..), outputBlockHash)
import Blockchain.PhaseProfile (finalizePhaseProfile)
import Blockchain.SolidVM.CodeCollectionDB (parseSource, parseSourceUncached, parseSourceUnitSlices)
import Blockchain.Data.RLP (rlpDecode, rlpDeserialize)
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.Sequencer.Event (VmTask (..))
import Blockchain.Sequencer.Kafka (seqVmTasksTopicName)
import Blockchain.Strato.Model.Class
  ( TransactionLike
      ( txArgs,
        txCode,
        txContractName,
        txFuncName,
        txGasLimit,
        txTxData
      ),
  )
import qualified Blockchain.Strato.Model.Class as Model
import Blockchain.Strato.Model.Code (Code (..))
import Blockchain.Strato.Model.Options ()
import Blockchain.Strato.Model.StateRoot (StateRoot)
import Blockchain.VMContext
  ( evalContextM',
    finalizePendingMPNodes,
    initBatchedContext,
    initReplayContext,
    withCurrentBlockHash,
  )
import Blockchain.VMOptions ()
import Blockchain.Wiring (HasContext)
import Conduit
import Control.DeepSeq (force)
import Control.Exception (evaluate)
import Control.Monad (forM, forM_, unless, when)
import Control.Monad.Composable.Streaming (HasStreaming, runConsume)
import Crypto.Hash (Context, Digest, SHA256, hashFinalize, hashInit, hashUpdate)
import qualified Crypto.Hash as Crypto
import Data.Binary (decode, encode, get)
import Data.Binary.Get (Decoder (..), Get, runGetIncremental)
import Data.Binary.Put (putWord64be, runPut)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as BL
import Data.Default (def)
import Data.IORef
import Data.List (foldl', sortOn, stripPrefix, tails)
import qualified Data.Map.Strict as Map
import Data.Ord (Down (..))
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import Data.Time.Clock (diffUTCTime, getCurrentTime)
import qualified Database.LevelDB as DB
import Executable.EVMFlags ()
import Executable.EthereumVM (initializeBestBlock, routeOutEvents, seedDatabases)
import Executable.EthereumVM2 (processBlocks)
import GHC.Stats (RTSStats (allocated_bytes), getRTSStats, getRTSStatsEnabled)
import HFlags
import System.Exit (exitFailure, exitSuccess)
import System.IO (Handle, IOMode (ReadMode, WriteMode), hPutStrLn, hSetBinaryMode, stderr, stdin, withBinaryFile, withFile)
import System.Mem (performGC)
import Text.Printf

main :: IO ()
main = do
  blockappsInit "vm_replay"
  args <- $initHFlags "vm-replay: isolated processBlocks harness"
  case args of
    ("dump" : nStr : outPath : _) -> dumpBlocks (read nStr) outPath
    ("apply" : inPath : fromStr : toStr : _) -> applyBlocksStreamed False defaultStreamChunkSize inPath (Just (read fromStr, read toStr))
    ("apply" : inPath : _) -> applyBlocksStreamed False defaultStreamChunkSize inPath Nothing
    ("apply-stream" : inPath : chunkStr : fromStr : toStr : _) ->
      applyBlocksStreamed False (read chunkStr) inPath (Just (read fromStr, read toStr))
    ("apply-stream" : inPath : chunkStr : _) ->
      applyBlocksStreamed False (read chunkStr) inPath Nothing
    ("apply-stream-full" : inPath : chunkStr : fromStr : toStr : _) ->
      applyBlocksStreamed True (read chunkStr) inPath (Just (read fromStr, read toStr))
    ("apply-stream-full" : inPath : chunkStr : _) ->
      applyBlocksStreamed True (read chunkStr) inPath Nothing
    ("apply-preloaded" : inPath : fromStr : toStr : _) ->
      applyBlocksPreloaded inPath (Just (read fromStr, read toStr))
    ("apply-preloaded" : inPath : _) -> applyBlocksPreloaded inPath Nothing
    ("audit" : inPath : fromStr : toStr : _) -> auditBlocks inPath (Just (read fromStr, read toStr))
    ("audit" : inPath : _) -> auditBlocks inPath Nothing
    ("scan-corpus" : inPath : windowStr : outPath : _) -> scanCorpus inPath (read windowStr) outPath
    ("dump-disk-state" : inPath : blockStr : outPath : _) -> dumpDiskState inPath (read blockStr) outPath
    ("dump-derived-state" : failureLog : outPath : _) -> dumpDerivedState failureLog outPath
    ("extract-code" : inPath : blockStr : outPrefix : _) -> extractCode inPath (read blockStr) outPrefix
    ("parse-code" : sourcePaths@(_ : _)) -> mapM_ parseCode sourcePaths
    ("parse-code-compare" : sourcePaths@(_ : _)) -> mapM_ parseCodeCompare sourcePaths
    ("parse-code-units" : sourcePaths@(_ : _)) -> mapM_ parseCodeUnits sourcePaths
    ("parse-code-hash" : sourcePaths@(_ : _)) -> mapM_ parseCodeHash sourcePaths
    ("hash-leveldb" : dbPath : _) -> hashLevelDB dbPath
    _ -> do
      hPutStrLn stderr "usage:\n  vm-replay dump <n> <out.bin>\n  vm-replay apply <blocks.bin|-> [from] [to]  # diagnostic: 256-block persistence, no publication\n  vm-replay apply-stream <blocks.bin|-> <chunk-size> [from] [to]  # diagnostic\n  vm-replay apply-stream-full <blocks.bin|-> <chunk-size> [from] [to]  # durable state + Kafka\n  vm-replay apply-preloaded <blocks.bin> [from] [to]  # historical diagnostic only\n  vm-replay audit <blocks.bin|-> [from] [to]\n  vm-replay scan-corpus <blocks.bin|-> <window-size> <out.tsv>\n  vm-replay dump-disk-state <blocks.bin|-> <block> <out.txt>\n  vm-replay dump-derived-state <failed-apply.stderr> <out.txt>\n  vm-replay extract-code <blocks.bin|-> <block> <out-prefix>\n  vm-replay parse-code <source-file>\n  vm-replay parse-code-compare <source-file>...\n  vm-replay parse-code-units <source-file>...\n  vm-replay parse-code-hash <source-file>...\n  vm-replay hash-leveldb <database-dir>"
      exitFailure

parseCodeHash :: FilePath -> IO ()
parseCodeHash sourcePath = do
  bytes <- BS.readFile sourcePath
  units <- case parseSourceUncached (T.pack sourcePath) (Text.decodeUtf8 bytes) of
    Left err -> ioError . userError $ show err
    Right value -> evaluate $ force value
  let encoded = Text.encodeUtf8 . T.pack $ show units
      digest = Crypto.hash encoded :: Digest SHA256
  printf "PARSE_CODE_HASH path=%s units=%d encoded_bytes=%d sha256=%s\n"
    sourcePath (length units) (BS.length encoded) (show digest)

parseCodeUnits :: FilePath -> IO ()
parseCodeUnits sourcePath = do
  bytes <- BS.readFile sourcePath
  let source = Text.decodeUtf8 bytes
  slices <- case parseSourceUnitSlices (T.pack sourcePath) source of
    Left err -> ioError . userError $ show err
    Right value -> evaluate $ force value
  statsEnabled <- getRTSStatsEnabled
  printf "PARSE_CODE_UNITS path=%s bytes=%d units=%d rts_stats=%s\n"
    sourcePath (BS.length bytes) (length slices) (show statsEnabled)
  forM_ (zip [0 :: Int ..] slices) $ \(unitIndex, (label, unitSource)) -> do
    when statsEnabled performGC
    beforeStats <- if statsEnabled then Just <$> getRTSStats else pure Nothing
    t0 <- getCurrentTime
    parsed <- evaluate . force $
      case parseSourceUncached (T.pack $ sourcePath ++ "#" ++ show unitIndex) unitSource of
        Left err -> Left $ show err
        Right value -> Right value
    t1 <- getCurrentTime
    when statsEnabled performGC
    afterStats <- if statsEnabled then Just <$> getRTSStats else pure Nothing
    let seconds = realToFrac (diffUTCTime t1 t0) :: Double
        allocated = case (beforeStats, afterStats) of
          (Just before, Just after) -> fromIntegral (allocated_bytes after - allocated_bytes before) :: Integer
          _ -> -1
        status = either (const "error") (const "ok") parsed :: String
        unitDigest = Crypto.hash (Text.encodeUtf8 unitSource) :: Digest SHA256
    printf "PARSE_CODE_UNIT index=%d label=%s chars=%d sha256=%s status=%s seconds=%.6f allocated_bytes=%d\n"
      unitIndex label (T.length unitSource) (show unitDigest) status seconds allocated

parseCode :: FilePath -> IO ()
parseCode sourcePath = do
  bytes <- BS.readFile sourcePath
  t0 <- getCurrentTime
  units <- case parseSource (T.pack sourcePath) (Text.decodeUtf8 bytes) of
    Left err -> ioError . userError $ show err
    Right value -> evaluate $ force value
  t1 <- getCurrentTime
  let dt = realToFrac (diffUTCTime t1 t0) :: Double
  printf "PARSE_CODE bytes=%d units=%d seconds=%.6f\n" (BS.length bytes) (length units) dt

parseCodeCompare :: FilePath -> IO ()
parseCodeCompare sourcePath = do
  bytes <- BS.readFile sourcePath
  let source = Text.decodeUtf8 bytes
      parseAndForce parser =
        evaluate . force $
          case parser T.empty source of
            Left err -> Left $ show err
            Right value -> Right value
  t0 <- getCurrentTime
  uncached <- parseAndForce parseSourceUncached
  t1 <- getCurrentTime
  cached <- parseAndForce parseSource
  t2 <- getCurrentTime
  cachedAgain <- parseAndForce parseSource
  t3 <- getCurrentTime
  unless (uncached == cached && cached == cachedAgain) $
    ioError . userError . unlines $
      [ "cached parser result differs: " ++ sourcePath,
        "uncached_vs_cached=" ++ describeParseDifference uncached cached,
        "cached_vs_warm=" ++ describeParseDifference cached cachedAgain
      ]
  let uncachedSeconds = realToFrac (diffUTCTime t1 t0) :: Double
      cachedSeconds = realToFrac (diffUTCTime t2 t1) :: Double
      warmSeconds = realToFrac (diffUTCTime t3 t2) :: Double
      (status, unitCount) = either (const ("error" :: String, -1 :: Int)) (\units -> ("ok", length units)) uncached
  printf
    "PARSE_CODE_COMPARE path=%s status=%s bytes=%d units=%d uncached_seconds=%.6f cached_seconds=%.6f warm_seconds=%.6f\n"
    sourcePath
    status
    (BS.length bytes)
    unitCount
    uncachedSeconds
    cachedSeconds
    warmSeconds

describeParseDifference :: (Eq a, Show a) => Either String [a] -> Either String [a] -> String
describeParseDifference (Left leftError) (Left rightError)
  | leftError == rightError = "equal-errors"
  | otherwise = "left-error=" ++ take 500 leftError ++ " right-error=" ++ take 500 rightError
describeParseDifference (Right leftUnits) (Right rightUnits) =
  case [index | (index, (leftUnit, rightUnit)) <- zip [0 :: Int ..] (zip leftUnits rightUnits), leftUnit /= rightUnit] of
    [] -> "unit-prefix-equal lengths=" ++ show (length leftUnits, length rightUnits)
    index : _ ->
      "first-unit=" ++ show index
        ++ " left=" ++ take 1000 (show $ leftUnits !! index)
        ++ " right=" ++ take 1000 (show $ rightUnits !! index)
describeParseDifference left right = "constructor-diff left=" ++ take 500 (show left) ++ " right=" ++ take 500 (show right)

extractCode :: FilePath -> Integer -> FilePath -> IO ()
extractCode inPath blockNo outPrefix =
  withBinaryInput inPath $ \input -> do
    source0 <- openLegacyBlockSource input
    (selected, _) <- prepareLegacySelection (Just (blockNo, blockNo)) source0
    block <- maybe (ioError . userError $ "block not found: " ++ show blockNo) pure selected
    let creations =
          [ (index, contractName, code)
          | (index, tx) <- zip [(0 :: Int)..] (obReceiptTransactions block),
            Just code <- [txCode (otBaseTx tx)],
            let contractName = txContractName (otBaseTx tx)
          ]
    forM_ creations $ \(index, contractName, Code source) -> do
      let path = outPrefix ++ "-tx" ++ show index ++ ".bin"
          bytes = Text.encodeUtf8 source
      BS.writeFile path bytes
      hPutStrLn stderr $ printf "EXTRACT_CODE block=%d tx_index=%d contract=%s bytes=%d path=%s"
        blockNo index (show contractName) (BS.length bytes) path
    when (null creations) $ do
      hPutStrLn stderr $ "no contract creation in block " ++ show blockNo
      exitFailure

hashLevelDB :: FilePath -> IO ()
hashLevelDB dbPath = do
  (digest, entries, keyBytes, valueBytes) <- runResourceT $ do
    db <- DB.open dbPath def
    iterator <- DB.iterOpen db def
    DB.iterFirst iterator
    go iterator hashInit 0 0 0
  putStrLn $
    printf
      "LEVELDB_HASH path=%s sha256=%s entries=%d key_bytes=%d value_bytes=%d"
      dbPath
      (show digest)
      entries
      keyBytes
      valueBytes
  where
    go :: DB.Iterator -> Context SHA256 -> Integer -> Integer -> Integer -> ResourceT IO (Digest SHA256, Integer, Integer, Integer)
    go iterator !context !entries !keyBytes !valueBytes = do
      valid <- DB.iterValid iterator
      if not valid
        then pure (hashFinalize context, entries, keyBytes, valueBytes)
        else do
          maybeKey <- DB.iterKey iterator
          maybeValue <- DB.iterValue iterator
          case (maybeKey, maybeValue) of
            (Just key, Just value) -> do
              let !context' =
                    hashUpdate
                      (hashUpdate
                        (hashUpdate
                          (hashUpdate context $ frameLength key)
                          key)
                        (frameLength value))
                      value
              DB.iterNext iterator
              go
                iterator
                context'
                (entries + 1)
                (keyBytes + fromIntegral (BS.length key))
                (valueBytes + fromIntegral (BS.length value))
            _ -> liftIO . ioError $ userError "LevelDB iterator was valid but key/value was absent"

    frameLength bytes = BL.toStrict . runPut . putWord64be . fromIntegral $ BS.length bytes

dumpBlocks :: Int -> FilePath -> IO ()
dumpBlocks n outPath = do
  when (n <= 0) $ do
    hPutStrLn stderr "dump: n must be > 0"
    exitFailure
  hPutStrLn stderr $ printf "dumping first %d VmBlock(s) from vm_tasks to %s" n outPath
  blocks <- runLoggingT $ runStreamMConfigured "vm-apply-dump" $ do
    acc <- liftIO $ newIORef ([] :: [OutputBlock])
    -- Fresh group each dump-all so we reread vm_tasks from offset 0.
    runConsume "vm-apply-loop-dump-all" seqVmTasksTopicName $ \evs -> do
      let newBlocks = [ob | VmBlock ob <- evs]
      liftIO $ modifyIORef' acc (<> newBlocks)
      got <- liftIO $ readIORef acc
      if length got >= n
        then pure (Just (take n got))
        else do
          when (length got `mod` 10000 < length newBlocks) $
            liftIO $ hPutStrLn stderr $ printf "  dump progress: %d / %d" (length got) n
          -- Kafka at tip: a few empty fetches then stop if we already have a lot.
          if null evs && length got > 1000
            then pure (Just got)
            else pure Nothing
  let ordered = sortOn (number . obBlockData) blocks
      (firstN, lastN) = blockRange ordered
      txCount = sum (map (length . obReceiptTransactions) ordered)
  BL.writeFile outPath (encode ordered)
  hPutStrLn stderr $
    printf
      "wrote %d blocks (#%d–#%d, %d txs) to %s"
      (length ordered)
      firstN
      lastN
      txCount
      outPath

applyBlocksPreloaded :: FilePath -> Maybe (Integer, Integer) -> IO ()
applyBlocksPreloaded inPath mRange = do
  raw <- BL.readFile inPath
  let loaded = decode raw :: [OutputBlock]
      blocks = case mRange of
        Nothing -> loaded
        Just (lo, hi) ->
          filter
            (\b -> let n = number (obBlockData b) in n >= lo && n <= hi)
            loaded
  when (null blocks) $ do
    hPutStrLn stderr "apply: empty block file (or range filtered everything)"
    exitFailure
  let (firstN, lastN) = blockRange blocks
      lastB = lastBlock blocks
      expectSR = stateRoot (obBlockData lastB)
      expectHash = outputBlockHash lastB
      txCount = sum (map (length . obReceiptTransactions) blocks)
  hPutStrLn stderr $
    "timing=legacy-preloaded-v1 " ++
    printf
      "apply %d blocks (#%d–#%d, %d txs); last header sr=%s"
      (length blocks)
      firstN
      lastN
      txCount
      (show expectSR)
  t0 <- getCurrentTime
  failures <- runLoggingT $ runResourceT $ do
    ctx <- initReplayContext
    lift $ runStreamMConfigured "vm-apply-replay" $ evalContextM' ctx $ do
      -- Historical MP nodes come from a copied LevelDB (helium-ldb).
      -- Rebuilding genesis.json storage here hits a BasicValue parse on HTML
      -- strings and is not how a live node boots (strato-setup already wrote the trie).
      genesisInfo <- getGenesisInfo
      let genesisBlock = genesisInfoToBlock genesisInfo
          genesisHash = Model.blockHash genesisBlock
          genesisRoot = Genesis.stateRoot genesisInfo
      withCurrentBlockHash genesisHash $ do
        bootstrapChainDB genesisHash genesisRoot
        setStateDBStateRoot Nothing genesisRoot
        seedDatabases genesisBlock
      initializeBestBlock
      result <- runConduit $ processBlocks blocks .| collectFailures
      finalizePendingMPNodes
      pure result
  t1 <- getCurrentTime
  let dt = realToFrac (diffUTCTime t1 t0) :: Double
      rate = fromIntegral (length blocks) / max dt 1e-9
      ms = 1000 * dt / fromIntegral (length blocks)
  case failures of
    (_ : _) -> do
      hPutStrLn stderr "APPLY FAILED: verification errors (state root or other):"
      mapM_ (hPutStrLn stderr . show) failures
      hPutStrLn stderr $ printf "RESULT fail blocks=%d seconds=%.3f blk_s=%.2f ms_blk=%.1f" (length blocks) dt rate ms
      exitFailure
    [] -> do
      hPutStrLn stderr $
        printf
          "RESULT ok blocks=%d first=%d last=%d seconds=%.3f blk_s=%.2f ms_blk=%.1f last_sr=%s last_hash=%s"
          (length blocks)
          firstN
          lastN
          dt
          rate
          ms
          (show expectSR)
          (show expectHash)
      putStrLn $
        printf
          "ok\t%d\t%d\t%d\t%.6f\t%.4f\t%s"
          (length blocks)
          firstN
          lastN
          dt
          rate
          (show expectSR)
      exitSuccess

defaultStreamChunkSize :: Int
defaultStreamChunkSize = 1024

data LegacyBlockSource = LegacyBlockSource
  { legacyHandle :: !Handle,
    legacyRemaining :: !Int,
    legacyBuffer :: !BS.ByteString
  }

data ReplayStats = ReplayStats
  { replayCount :: !Int,
    replayFirstNumber :: !Integer,
    replayLastNumber :: !Integer,
    replayTxCount :: !Int,
    replayLastBlock :: !OutputBlock
  }

withBinaryInput :: FilePath -> (Handle -> IO a) -> IO a
withBinaryInput "-" action = do
  hSetBinaryMode stdin True
  action stdin
withBinaryInput path action = withBinaryFile path ReadMode action

decodeIncremental :: Handle -> BS.ByteString -> Get a -> IO (a, BS.ByteString)
decodeIncremental handle initial parser =
  drive initial (runGetIncremental parser)
  where
    drive buffered decoder =
      case decoder of
        Done remainingBytes _ value -> value `seq` pure (value, remainingBytes)
        Fail _ offset message ->
          ioError . userError $
            printf "stream decode failed at byte %d: %s" offset message
        Partial continue
          | not (BS.null buffered) ->
              drive BS.empty (continue (Just buffered))
          | otherwise -> do
              chunk <- BS.hGetSome handle (64 * 1024)
              if BS.null chunk
                then
                  case continue Nothing of
                    Partial _ -> ioError $ userError "stream decoder requested input after EOF"
                    finished -> drive BS.empty finished
                else drive BS.empty (continue (Just chunk))

openLegacyBlockSource :: Handle -> IO LegacyBlockSource
openLegacyBlockSource handle = do
  (declared, buffered) <- decodeIncremental handle BS.empty (get :: Get Int)
  when (declared < 0) $
    ioError . userError $ "negative block-list length: " ++ show declared
  pure $ LegacyBlockSource handle declared buffered

readLegacyBlock :: LegacyBlockSource -> IO (Maybe (OutputBlock, LegacyBlockSource))
readLegacyBlock source
  | legacyRemaining source == 0 = pure Nothing
  | legacyRemaining source < 0 =
      ioError $ userError "internal error: negative remaining block count"
  | otherwise = do
      (block, buffered) <-
        decodeIncremental
          (legacyHandle source)
          (legacyBuffer source)
          (get :: Get OutputBlock)
      let nextSource =
            LegacyBlockSource
              (legacyHandle source)
              (legacyRemaining source - 1)
              buffered
      pure $ Just (block, nextSource)

ensureLegacyEnd :: LegacyBlockSource -> IO ()
ensureLegacyEnd source = do
  unless (legacyRemaining source == 0) $
    ioError . userError $
      printf "stream ended early: %d declared block(s) remain" (legacyRemaining source)
  trailing <-
    if BS.null (legacyBuffer source)
      then BS.hGetSome (legacyHandle source) 1
      else pure (legacyBuffer source)
  unless (BS.null trailing) $
    ioError $ userError "trailing bytes after declared block list"

prepareLegacySelection ::
  Maybe (Integer, Integer) ->
  LegacyBlockSource ->
  IO (Maybe OutputBlock, LegacyBlockSource)
prepareLegacySelection Nothing source = pure (Nothing, source)
prepareLegacySelection (Just (lo, hi)) source
  | lo > hi = ioError $ userError "apply: from block must be <= to block"
  | otherwise = go source
  where
    go current =
      readLegacyBlock current >>= \case
        Nothing -> pure (Nothing, current)
        Just (block, next) ->
          if number (obBlockData block) < lo
            then go next
            else pure (Just block, next)

aboveSelection :: Maybe (Integer, Integer) -> OutputBlock -> Bool
aboveSelection Nothing _ = False
aboveSelection (Just (_, hi)) block = number (obBlockData block) > hi

recordReplayBlock :: Maybe ReplayStats -> OutputBlock -> IO ReplayStats
recordReplayBlock Nothing block = do
  let !blockNo = number (obBlockData block)
      !txs = length (obReceiptTransactions block)
  pure $ ReplayStats 1 blockNo blockNo txs block
recordReplayBlock (Just stats) block = do
  let !blockNo = number (obBlockData block)
      !expected = replayLastNumber stats + 1
      !txs = length (obReceiptTransactions block)
  unless (blockNo == expected) $
    ioError . userError $
      printf "non-contiguous block stream: expected #%d, got #%d" expected blockNo
  pure $
    ReplayStats
      (replayCount stats + 1)
      (replayFirstNumber stats)
      blockNo
      (replayTxCount stats + txs)
      block

data CorpusWindow = CorpusWindow
  { corpusWindowStart :: !Integer,
    corpusWindowEnd :: !Integer,
    corpusBlockCount :: !Int,
    corpusTxCount :: !Int,
    corpusNonemptyBlocks :: !Int,
    corpusMaxTxsPerBlock :: !Int,
    corpusCreationCount :: !Int,
    corpusCreationCodeChars :: !Int,
    corpusNamedCallCount :: !Int,
    corpusArgumentChars :: !Int,
    corpusTxDataBytes :: !Int,
    corpusGasLimitSum :: !Integer,
    corpusFunctionCounts :: !(Map.Map T.Text Int),
    corpusContractCounts :: !(Map.Map T.Text Int)
  }

data CorpusTotals = CorpusTotals
  { corpusTotalBlocks :: !Int,
    corpusTotalTxs :: !Int,
    corpusTotalFirst :: !(Maybe Integer),
    corpusTotalLast :: !(Maybe Integer)
  }

emptyCorpusTotals :: CorpusTotals
emptyCorpusTotals = CorpusTotals 0 0 Nothing Nothing

scanCorpus :: FilePath -> Integer -> FilePath -> IO ()
scanCorpus inPath windowSize outPath = do
  when (windowSize <= 0) $
    ioError $ userError "scan-corpus: window size must be > 0"
  withBinaryInput inPath $ \input -> do
    source0 <- openLegacyBlockSource input
    withFile outPath WriteMode $ \output -> do
      hPutStrLn output $
        "window_start\twindow_end\tblocks\ttxs\ttx_per_block\tnonempty_blocks\tmax_txs_per_block"
          ++ "\tcreations\tcreation_code_chars\tcalls\tnamed_calls\targument_chars\ttx_data_bytes"
          ++ "\tgas_limit_sum\tfunction_counts\tcontract_counts"
      (totals, finalSource) <- go output source0 Nothing emptyCorpusTotals
      ensureLegacyEnd finalSource
      case (corpusTotalFirst totals, corpusTotalLast totals) of
        (Just firstN, Just lastN) ->
          hPutStrLn stderr $
            printf
              "SCAN_CORPUS ok declared_blocks=%d blocks=%d first=%d last=%d txs=%d window_size=%d output=%s"
              (legacyRemaining source0)
              (corpusTotalBlocks totals)
              firstN
              lastN
              (corpusTotalTxs totals)
              windowSize
              outPath
        _ -> ioError $ userError "scan-corpus: empty corpus"
  where
    go output source maybeWindow !totals =
      readLegacyBlock source >>= \case
        Nothing -> do
          forM_ maybeWindow $ writeCorpusWindow output
          pure (totals, source)
        Just (block, nextSource) -> do
          let !blockNo = number (obBlockData block)
              !txCount = length (obReceiptTransactions block)
          case corpusTotalLast totals of
            Just previous
              | blockNo /= previous + 1 ->
                  ioError . userError $
                    printf "scan-corpus: non-contiguous block stream: expected #%d, got #%d" (previous + 1) blockNo
            _ -> pure ()
          let !windowStart = (blockNo `div` windowSize) * windowSize
              !totals' =
                CorpusTotals
                  (corpusTotalBlocks totals + 1)
                  (corpusTotalTxs totals + txCount)
                  (case corpusTotalFirst totals of Nothing -> Just blockNo; firstN -> firstN)
                  (Just blockNo)
          nextWindow <-
            case maybeWindow of
              Nothing -> pure $ addCorpusBlock windowSize windowStart block (emptyCorpusWindow windowStart)
              Just current
                | corpusWindowStart current == windowStart -> pure $ addCorpusBlock windowSize windowStart block current
                | otherwise -> do
                    writeCorpusWindow output current
                    pure $ addCorpusBlock windowSize windowStart block (emptyCorpusWindow windowStart)
          go output nextSource (Just nextWindow) totals'

emptyCorpusWindow :: Integer -> CorpusWindow
emptyCorpusWindow windowStart =
  CorpusWindow
    windowStart
    windowStart
    0
    0
    0
    0
    0
    0
    0
    0
    0
    0
    Map.empty
    Map.empty

addCorpusBlock :: Integer -> Integer -> OutputBlock -> CorpusWindow -> CorpusWindow
addCorpusBlock windowSize expectedWindowStart block initial =
  let !blockNo = number (obBlockData block)
      !actualWindowStart = (blockNo `div` windowSize) * windowSize
      txs = map otBaseTx (obReceiptTransactions block)
      !txCount = length txs
      withBlock =
        initial
          { corpusWindowEnd = blockNo,
            corpusBlockCount = corpusBlockCount initial + 1,
            corpusTxCount = corpusTxCount initial + txCount,
            corpusNonemptyBlocks = corpusNonemptyBlocks initial + if txCount == 0 then 0 else 1,
            corpusMaxTxsPerBlock = max (corpusMaxTxsPerBlock initial) txCount
          }
   in if actualWindowStart /= expectedWindowStart
        then error "scan-corpus: internal window mismatch"
        else foldl' addCorpusTransaction withBlock txs

addCorpusTransaction :: (TransactionLike tx) => CorpusWindow -> tx -> CorpusWindow
addCorpusTransaction stats tx =
  let maybeCode = txCode tx
      !creationCount = case maybeCode of Just _ -> 1; Nothing -> 0
      !creationChars = case maybeCode of Just (Code source) -> T.length source; Nothing -> 0
      !namedCallCount = case txFuncName tx of Just _ -> 1; Nothing -> 0
      !argumentChars = sum $ map T.length (txArgs tx)
      !txDataBytes = maybe 0 BS.length (txTxData tx)
      !functionCounts = maybe (corpusFunctionCounts stats) (incrementCount $ corpusFunctionCounts stats) (txFuncName tx)
      !contractCounts = maybe (corpusContractCounts stats) (incrementCount $ corpusContractCounts stats) (txContractName tx)
   in stats
        { corpusCreationCount = corpusCreationCount stats + creationCount,
          corpusCreationCodeChars = corpusCreationCodeChars stats + creationChars,
          corpusNamedCallCount = corpusNamedCallCount stats + namedCallCount,
          corpusArgumentChars = corpusArgumentChars stats + argumentChars,
          corpusTxDataBytes = corpusTxDataBytes stats + txDataBytes,
          corpusGasLimitSum = corpusGasLimitSum stats + txGasLimit tx,
          corpusFunctionCounts = functionCounts,
          corpusContractCounts = contractCounts
        }

incrementCount :: Map.Map T.Text Int -> T.Text -> Map.Map T.Text Int
incrementCount counts label = Map.insertWith (+) label 1 counts

writeCorpusWindow :: Handle -> CorpusWindow -> IO ()
writeCorpusWindow output stats =
  hPutStrLn output $
    printf
      "%d\t%d\t%d\t%d\t%.6f\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%s\t%s"
      (corpusWindowStart stats)
      (corpusWindowEnd stats)
      (corpusBlockCount stats)
      (corpusTxCount stats)
      txPerBlock
      (corpusNonemptyBlocks stats)
      (corpusMaxTxsPerBlock stats)
      (corpusCreationCount stats)
      (corpusCreationCodeChars stats)
      (corpusTxCount stats - corpusCreationCount stats)
      (corpusNamedCallCount stats)
      (corpusArgumentChars stats)
      (corpusTxDataBytes stats)
      (corpusGasLimitSum stats)
      (renderCounts $ corpusFunctionCounts stats)
      (renderCounts $ corpusContractCounts stats)
  where
    txPerBlock = fromIntegral (corpusTxCount stats) / fromIntegral (max 1 $ corpusBlockCount stats) :: Double

renderCounts :: Map.Map T.Text Int -> String
renderCounts counts =
  T.unpack . T.intercalate ";" $
    [ escapeCountLabel label <> "=" <> T.pack (show count)
    | (label, count) <- sortOn (\(label, count) -> (Down count, label)) (Map.toList counts)
    ]

escapeCountLabel :: T.Text -> T.Text
escapeCountLabel = T.concatMap $ \case
  '\t' -> "\\t"
  '\n' -> "\\n"
  '\r' -> "\\r"
  ';' -> "\\x3b"
  '=' -> "\\x3d"
  character -> T.singleton character

scanLegacySelection ::
  Maybe OutputBlock ->
  LegacyBlockSource ->
  Maybe (Integer, Integer) ->
  IO (Maybe ReplayStats, LegacyBlockSource)
scanLegacySelection firstSelected source0 mRange = go firstSelected source0 Nothing
  where
    go pending source stats = do
      next <-
        case pending of
          Just block -> pure $ Just (block, source)
          Nothing -> readLegacyBlock source
      case next of
        Nothing -> pure (stats, source)
        Just (block, source')
          | aboveSelection mRange block -> pure (stats, source')
          | otherwise -> do
              stats' <- recordReplayBlock stats block
              go Nothing source' (Just stats')

applyBlocksStreamed :: Bool -> Int -> FilePath -> Maybe (Integer, Integer) -> IO ()
applyBlocksStreamed fullPipeline chunkSize inPath mRange = do
  when (chunkSize <= 0) $ do
    hPutStrLn stderr "apply-stream: chunk size must be > 0"
    exitFailure
  let timingSchema :: String
      timingSchema = if fullPipeline then "streamed-full-pipeline-v1" else "streamed-diagnostic-v1"
  withBinaryInput inPath $ \input -> do
    source0 <- openLegacyBlockSource input
    (firstSelected, source1) <- prepareLegacySelection mRange source0
    hPutStrLn stderr $
      printf
        "timing=%s declared_blocks=%d chunk=%d input=%s"
        timingSchema
        (legacyRemaining source0)
        chunkSize
        inPath
    t0 <- getCurrentTime
    (failures, maybeStats, finalSource) <- runLoggingT $ runResourceT $ do
      ctx <- if fullPipeline then initBatchedContext else initReplayContext
      lift $ runStreamMConfigured "vm-apply-replay-stream" $ evalContextM' ctx $ do
        -- strato-setup has already populated the genesis state/code tries in
        -- the checkpoint. Install and select that canonical root before block
        -- 1, matching ethereumVM startup without publishing bootstrap events
        -- inside the timed replay.
        genesisInfo <- getGenesisInfo
        let genesisBlock = genesisInfoToBlock genesisInfo
            genesisHash = Model.blockHash genesisBlock
            genesisRoot = Genesis.stateRoot genesisInfo
        withCurrentBlockHash genesisHash $ do
          bootstrapChainDB genesisHash genesisRoot
          setStateDBStateRoot Nothing genesisRoot
          seedDatabases genesisBlock
        initializeBestBlock
        let processChunk [] = pure ([] :: [BlockVerificationFailure])
            processChunk reversedBlocks
              | fullPipeline = do
                  outEvents <- runConduit $
                    processBlocks (reverse reversedBlocks)
                      .| sinkList
                  finalizePendingMPNodes
                  runConduit $
                    yieldMany outEvents
                      .| collectFailuresPublishing
              | otherwise =
                  runConduit $
                    processBlocks (reverse reversedBlocks)
                      .| collectFailures
            finish source reversedBlocks stats = do
              chunkFailures <- processChunk reversedBlocks
              pure (chunkFailures, stats, source)
            go pending source reversedBlocks !chunkLength stats = do
              next <-
                case pending of
                  Just block -> pure $ Just (block, source)
                  Nothing -> liftIO $ readLegacyBlock source
              case next of
                Nothing -> finish source reversedBlocks stats
                Just (block, source')
                  | aboveSelection mRange block ->
                      finish source' reversedBlocks stats
                  | otherwise -> do
                      stats' <- liftIO $ recordReplayBlock stats block
                      let reversedBlocks' = block : reversedBlocks
                          !chunkLength' = chunkLength + 1
                      if chunkLength' >= chunkSize
                        then do
                          chunkFailures <- processChunk reversedBlocks'
                          if null chunkFailures
                            then go Nothing source' [] 0 (Just stats')
                            else pure (chunkFailures, Just stats', source')
                        else
                          go Nothing source' reversedBlocks' chunkLength' (Just stats')
        result <- go firstSelected source1 [] 0 Nothing
        finalizePendingMPNodes
        pure result
    when (null failures && mRange == Nothing) $
      ensureLegacyEnd finalSource
    finalizePhaseProfile
    t1 <- getCurrentTime
    stats <-
      case maybeStats of
        Nothing -> do
          hPutStrLn stderr "apply-stream: empty block file (or range filtered everything)"
          exitFailure
        Just value -> pure value
    let !blockCount = replayCount stats
        !firstN = replayFirstNumber stats
        !lastN = replayLastNumber stats
        !txCount = replayTxCount stats
        lastB = replayLastBlock stats
        expectSR = stateRoot (obBlockData lastB)
        expectHash = outputBlockHash lastB
        dt = realToFrac (diffUTCTime t1 t0) :: Double
        rate = fromIntegral blockCount / max dt 1e-9
        ms = 1000 * dt / fromIntegral blockCount
    hPutStrLn stderr $
      printf
        "streamed %d blocks (#%d–#%d, %d txs); last header sr=%s"
        blockCount
        firstN
        lastN
        txCount
        (show expectSR)
    case failures of
      (_ : _) -> do
        hPutStrLn stderr "APPLY FAILED: verification errors (state root or other):"
        mapM_ (hPutStrLn stderr . show) failures
        hPutStrLn stderr $
          printf
            "RESULT fail blocks=%d seconds=%.3f blk_s=%.2f ms_blk=%.1f timing=%s"
            blockCount
            dt
            rate
            ms
            timingSchema
        exitFailure
      [] -> do
        hPutStrLn stderr $
          printf
            "RESULT ok blocks=%d first=%d last=%d seconds=%.3f blk_s=%.2f ms_blk=%.1f last_sr=%s last_hash=%s timing=%s chunk=%d"
            blockCount
            firstN
            lastN
            dt
            rate
            ms
            (show expectSR)
            (show expectHash)
            timingSchema
            chunkSize
        putStrLn $
          printf
            "ok\t%d\t%d\t%d\t%.6f\t%.4f\t%s"
            blockCount
            firstN
            lastN
            dt
            rate
            (show expectSR)
        exitSuccess

auditBlocks :: FilePath -> Maybe (Integer, Integer) -> IO ()
auditBlocks inPath mRange =
  withBinaryInput inPath $ \input -> do
    source0 <- openLegacyBlockSource input
    (firstSelected, source1) <- prepareLegacySelection mRange source0
    (maybeStats, finalSource) <- scanLegacySelection firstSelected source1 mRange
    when (mRange == Nothing) $ ensureLegacyEnd finalSource
    stats <-
      case maybeStats of
        Nothing -> do
          hPutStrLn stderr "audit: empty block file (or range filtered everything)"
          exitFailure
        Just value -> pure value
    hPutStrLn stderr $
      printf
        "audit stream scanned %d blocks (#%d–#%d, %d txs)"
        (replayCount stats)
        (replayFirstNumber stats)
        (replayLastNumber stats)
        (replayTxCount stats)
    auditLastBlock $ replayLastBlock stats

auditLastBlock :: OutputBlock -> IO ()
auditLastBlock lastB = do
  let expectSR = stateRoot (obBlockData lastB)
      expectHash = outputBlockHash lastB
  (accountCount, storageCount) <- runLoggingT $ runResourceT $ do
    ctx <- initReplayContext
    lift $ runStreamMConfigured "vm-apply-audit" $ evalContextM' ctx $ do
      diskSR <- getChainStateRoot Nothing expectHash
      unless (diskSR == Just expectSR) $
        error $ "AUDIT fail: persisted root mismatch: expected=" ++ show expectSR ++ " disk=" ++ show diskSR
      accountPairs <- MP.unsafeGetAllKeyVals expectSR
      let states =
            [ rlpDecode (rlpDeserialize (rlpDecode encoded)) :: AddressState
            | (_, encoded) <- accountPairs
            ]
      storageCounts <- forM states $ \addressState ->
        length <$> MP.unsafeGetAllKeyVals (addressStateContractRoot addressState)
      pure (length accountPairs, sum storageCounts)
  hPutStrLn stderr $
    printf "AUDIT ok last_hash=%s last_sr=%s accounts=%d storage_entries=%d"
      (show expectHash) (show expectSR) accountCount storageCount
  exitSuccess

-- Emit a stable, line-oriented view of the state actually associated with a
-- block hash on disk. This is intentionally separate from `audit`: when a
-- candidate derives the wrong root, the expected root may not exist in that
-- candidate's trie, but its persisted root still does. Comparing two dumps
-- pinpoints the changed account and storage paths.
dumpDiskState :: FilePath -> Integer -> FilePath -> IO ()
dumpDiskState inPath blockNo outPath =
  withBinaryInput inPath $ \input -> do
    source0 <- openLegacyBlockSource input
    (selected, _) <- prepareLegacySelection (Just (blockNo, blockNo)) source0
    block <- maybe (ioError . userError $ "block not found: " ++ show blockNo) pure selected
    let blockHash = outputBlockHash block
    diskRoot <- runLoggingT $ runResourceT $ do
      ctx <- initReplayContext
      lift $ runStreamMConfigured "vm-dump-disk-state" $ evalContextM' ctx $ do
        getChainStateRoot Nothing blockHash >>= maybe (error "dump-disk-state: block hash has no persisted root") pure
    dumpStateRoot diskRoot outPath
    hPutStrLn stderr $
      printf "DUMP_DISK_STATE block=%d root=%s path=%s"
        blockNo (show diskRoot) outPath

dumpDerivedState :: FilePath -> FilePath -> IO ()
dumpDerivedState failureLog outPath = do
  contents <- readFile failureLog
  let marker = "_derived = "
      roots =
        [ root
        | suffix <- tails contents,
          Just encoded <- [stripPrefix marker suffix],
          (root, _) <- reads encoded :: [(StateRoot, String)]
        ]
  root <- case roots of
    value : _ -> pure value
    [] -> ioError . userError $ "no derived StateRoot in " ++ failureLog
  dumpStateRoot root outPath
  hPutStrLn stderr $ printf "DUMP_DERIVED_STATE root=%s path=%s" (show root) outPath

dumpStateRoot :: StateRoot -> FilePath -> IO ()
dumpStateRoot root outPath = do
  entries <- runLoggingT $ runResourceT $ do
    ctx <- initReplayContext
    lift $ runStreamMConfigured "vm-dump-state-root" $ evalContextM' ctx $ do
      accounts <- sortOn fst <$> MP.unsafeGetAllKeyVals root
      forM accounts $ \(accountKey, encoded) -> do
        let addressState = rlpDecode (rlpDeserialize (rlpDecode encoded)) :: AddressState
        storage <- sortOn fst <$> MP.unsafeGetAllKeyVals (addressStateContractRoot addressState)
        pure (accountKey, encoded, storage)
  withFile outPath WriteMode $ \output -> do
    hPutStrLn output $ "ROOT\t" ++ show root
    forM_ entries $ \(accountKey, encoded, storage) -> do
      hPutStrLn output $ "ACCOUNT\t" ++ show accountKey ++ "\t" ++ show encoded
      forM_ storage $ \(storageKey, value) ->
        hPutStrLn output $ "STORAGE\t" ++ show accountKey ++ "\t" ++ show storageKey ++ "\t" ++ show value
  hPutStrLn stderr $ printf "DUMP_STATE_ROOT root=%s accounts=%d path=%s" (show root) (length entries) outPath

blockRange :: [OutputBlock] -> (Integer, Integer)
blockRange bs = (number (obBlockData (firstBlock bs)), number (obBlockData (lastBlock bs)))

firstBlock :: [OutputBlock] -> OutputBlock
firstBlock (b : _) = b
firstBlock [] = error "vm-replay: empty block list"

lastBlock :: [OutputBlock] -> OutputBlock
lastBlock [b] = b
lastBlock (_ : bs) = lastBlock bs
lastBlock [] = error "vm-replay: empty block list"

collectFailures :: (Monad m) => ConduitT VmOutEvent Void m [BlockVerificationFailure]
collectFailures = go []
  where
    go acc = await >>= \case
      Nothing -> pure (reverse acc)
      Just (OutBlockVerificationFailure fs) -> go (reverse fs ++ acc)
      Just _ -> go acc

collectFailuresPublishing ::
  (MonadLogger m, HasStreaming m, HasContext m) =>
  ConduitT VmOutEvent Void m [BlockVerificationFailure]
collectFailuresPublishing = routeOutEvents .| do
  batches <- sinkList
  pure $ concat batches
