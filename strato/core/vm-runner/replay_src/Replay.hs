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
import Blockchain.DB.ChainDB (getChainStateRoot)
import Blockchain.Data.AddressStateDB (AddressState (..))
import Blockchain.Data.BlockHeader (number, stateRoot)
import Blockchain.Data.GenesisBlock (genesisInfoToBlock)
import Blockchain.Data.GenesisInfo (getGenesisInfo)
import Blockchain.EthConf (runStreamMConfigured)
import Blockchain.Event (BlockVerificationFailure, VmOutEvent (..))
import Blockchain.Model.WrappedBlock (OutputBlock (..), outputBlockHash)
import Blockchain.Data.RLP (rlpDecode, rlpDeserialize)
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.Sequencer.Event (VmTask (..))
import Blockchain.Sequencer.Kafka (seqVmTasksTopicName)
import Blockchain.Strato.Model.Options ()
import Blockchain.VMCacheBudget (applyVmCacheBudget)
import Blockchain.VMContext (evalContextM', finalizePendingMPNodes, initReplayContext)
import Blockchain.VMOptions ()
import Conduit
import Control.Monad (forM, unless, when)
import Control.Monad.Composable.Streaming (runConsume)
import Data.Binary (decode, encode, get)
import Data.Binary.Get (Decoder (..), Get, runGetIncremental)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.List (sortOn)
import Data.Time.Clock (diffUTCTime, getCurrentTime)
import Executable.EVMFlags ()
import Executable.EthereumVM (initializeBestBlock, seedDatabases)
import Executable.EthereumVM2 (processBlocks)
import HFlags
import System.Exit (exitFailure, exitSuccess)
import System.IO (Handle, IOMode (ReadMode), hPutStrLn, hSetBinaryMode, stderr, stdin, withBinaryFile)
import Text.Printf

main :: IO ()
main = do
  blockappsInit "vm_replay"
  args <- $initHFlags "vm-replay: isolated processBlocks harness"
  applyVmCacheBudget
  case args of
    ("dump" : nStr : outPath : _) -> dumpBlocks (read nStr) outPath
    ("apply" : inPath : fromStr : toStr : _) -> applyBlocksStreamed defaultStreamChunkSize inPath (Just (read fromStr, read toStr))
    ("apply" : inPath : _) -> applyBlocksStreamed defaultStreamChunkSize inPath Nothing
    ("apply-stream" : inPath : chunkStr : fromStr : toStr : _) ->
      applyBlocksStreamed (read chunkStr) inPath (Just (read fromStr, read toStr))
    ("apply-stream" : inPath : chunkStr : _) ->
      applyBlocksStreamed (read chunkStr) inPath Nothing
    ("apply-preloaded" : inPath : fromStr : toStr : _) ->
      applyBlocksPreloaded inPath (Just (read fromStr, read toStr))
    ("apply-preloaded" : inPath : _) -> applyBlocksPreloaded inPath Nothing
    ("audit" : inPath : fromStr : toStr : _) -> auditBlocks inPath (Just (read fromStr, read toStr))
    ("audit" : inPath : _) -> auditBlocks inPath Nothing
    _ -> do
      hPutStrLn stderr "usage:\n  vm-replay dump <n> <out.bin>\n  vm-replay apply <blocks.bin|-> [from] [to]  # bounded stream, chunk=1024\n  vm-replay apply-stream <blocks.bin|-> <chunk-size> [from] [to]\n  vm-replay apply-preloaded <blocks.bin> [from] [to]  # historical only\n  vm-replay audit <blocks.bin|-> [from] [to]"
      exitFailure

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
      gi <- getGenesisInfo
      seedDatabases (genesisInfoToBlock gi)
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

applyBlocksStreamed :: Int -> FilePath -> Maybe (Integer, Integer) -> IO ()
applyBlocksStreamed chunkSize inPath mRange = do
  when (chunkSize <= 0) $ do
    hPutStrLn stderr "apply-stream: chunk size must be > 0"
    exitFailure
  withBinaryInput inPath $ \input -> do
    source0 <- openLegacyBlockSource input
    (firstSelected, source1) <- prepareLegacySelection mRange source0
    hPutStrLn stderr $
      printf
        "timing=streamed-apply-v1 declared_blocks=%d chunk=%d input=%s"
        (legacyRemaining source0)
        chunkSize
        inPath
    t0 <- getCurrentTime
    (failures, maybeStats, finalSource) <- runLoggingT $ runResourceT $ do
      ctx <- initReplayContext
      lift $ runStreamMConfigured "vm-apply-replay-stream" $ evalContextM' ctx $ do
        gi <- getGenesisInfo
        seedDatabases (genesisInfoToBlock gi)
        initializeBestBlock
        let processChunk [] = pure ([] :: [BlockVerificationFailure])
            processChunk reversedBlocks =
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
            "RESULT fail blocks=%d seconds=%.3f blk_s=%.2f ms_blk=%.1f timing=streamed-apply-v1"
            blockCount
            dt
            rate
            ms
        exitFailure
      [] -> do
        hPutStrLn stderr $
          printf
            "RESULT ok blocks=%d first=%d last=%d seconds=%.3f blk_s=%.2f ms_blk=%.1f last_sr=%s last_hash=%s timing=streamed-apply-v1 chunk=%d"
            blockCount
            firstN
            lastN
            dt
            rate
            ms
            (show expectSR)
            (show expectHash)
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
