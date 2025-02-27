{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.SyncDB
  ( getBestBlockInfo,
    putBestBlockInfo,
    getBestSequencedBlockInfo,
    putBestSequencedBlockInfo,
    forceBestBlockInfo,
    commonAncestorHelper,
    getWorldBestBlockInfo,
    updateWorldBestBlockInfo,
    getSyncStatus,
    getSyncStatusNow
  )
where

import BlockApps.Logging
import Blockchain.BlockDB
import Blockchain.Model.SyncState
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.RedisBlockDB.Models as Models
import Control.Concurrent (threadDelay)
import Control.Monad
import Control.Monad.Trans
import qualified Data.ByteString.Char8 as S8
import qualified Data.Text as T
import Database.Redis
import System.Random (randomIO)

liftLog :: LoggingT m a -> m a
liftLog = runLoggingT

inNamespace ::
  RedisDBKeyable k =>
  BlockDBNamespace ->
  k ->
  S8.ByteString
inNamespace ns k = ns' `S8.append` toKey k
  where
    ns' = namespaceToKeyPrefix ns

namespaceToKeyPrefix :: BlockDBNamespace -> S8.ByteString 
namespaceToKeyPrefix ns = case ns of 
  Headers -> "h:"
  Transactions -> "t:"
  Numbers -> "n:"
  Uncles -> "u:"
  Parent -> "p:"
  Children -> "c:"
  Canonical -> "q:"
  Validators -> "validators"
  X509Certificates -> "x509:"
  ParsedSetWhitePage -> "potu:"
  ParsedSetToX509 -> "psx509:"

bestBlockInfoKey :: S8.ByteString
bestBlockInfoKey = S8.pack "<best>"
{-# INLINE bestBlockInfoKey #-}

bestSequencedBlockInfoKey :: S8.ByteString
bestSequencedBlockInfoKey = S8.pack "<best_sequenced>"
{-# INLINE bestSequencedBlockInfoKey #-}

putBestBlockInfo ::
  Keccak256 ->
  Integer ->
  Redis (Either Reply Status)
putBestBlockInfo newSha newNumber = do
  --liftIO . putStrLn . ("New args" ++) $ show (keccak256ToHex newSha, newNumber, newTDiff)
  oldBBI' <- getBestBlockInfo
  case oldBBI' of
    Nothing -> return (Left $ SingleLine "Got no block from getBetstBlockInfo")
    Just (RedisBestBlock oldSha oldNumber) -> do
      --liftIO . putStrLn . ("Old args" ++) $ show (keccak256ToHex oldSha, oldNumber, oldTDiff)
      helper' <- commonAncestorHelper oldNumber newNumber oldSha newSha
      case helper' of
        Left err -> error $ "god save the queen! " ++ show err
        Right (updates, deletions) -> do
          --liftIO . putStrLn $ "Updates: \n" ++ unlines ((\(x, y) -> show (keccak256ToHex x, y)) <$> updates)
          --liftIO . putStrLn $ "Deletions: \n" ++ show deletions
          res <- multiExec $ do
            forM_ updates $ \(sha, num) -> set (inNamespace Canonical $ num) (toValue sha)
            unless (null deletions) . void . del $ inNamespace Canonical . toKey <$> deletions
            forceBestBlockInfo newSha newNumber
          checkAndUpdateSyncStatus
          case res of
            TxSuccess _ -> return $ Right Ok
            TxAborted -> return . Left $ SingleLine (S8.pack "Aborted")
            TxError e -> return . Left $ SingleLine (S8.pack e)

-- | Used to seed the first bestBlock, e.g. genesis block in strato-setup
forceBestBlockInfo :: RedisCtx m f => Keccak256 -> Integer -> m (f Status)
forceBestBlockInfo sha i =
  forceBestBlockInfo' bestBlockInfoKey (RedisBestBlock sha i) --`totalRecall` (,,)

forceBestBlockInfo' :: RedisCtx m f => S8.ByteString -> RedisBestBlock -> m (f Status)
forceBestBlockInfo' key = set key . toValue

getBestBlockInfo :: Redis (Maybe RedisBestBlock)
getBestBlockInfo = getBestBlockInfo' bestBlockInfoKey

getBestSequencedBlockInfo :: Redis (Maybe RedisBestBlock)
getBestSequencedBlockInfo = getBestBlockInfo' bestSequencedBlockInfoKey

putBestSequencedBlockInfo :: RedisCtx m f => Keccak256 -> Integer -> m (f Status)
putBestSequencedBlockInfo sha i =
  forceBestBlockInfo' bestSequencedBlockInfoKey (RedisBestBlock sha i)

getBestBlockInfo' :: S8.ByteString -> Redis (Maybe RedisBestBlock)
getBestBlockInfo' key =
  get key >>= \case
    Left x -> do
      liftLog $ $logErrorS "getBestBlockInfo'" . T.pack $ "got Left " ++ show x
      return Nothing
    Right r -> case r of
      Nothing -> return Nothing -- return . Left $ SingleLine "No BestBlock data set in RedisBlockDB"
      Just bs -> return . Just $ RedisBestBlock sha num
        where
          RedisBestBlock sha num = fromValue bs

releaseRedlockScript :: S8.ByteString
releaseRedlockScript =
  S8.pack . unlines $
    [ "if redis.call(\"get\",KEYS[1]) == ARGV[1] then",
      "    return redis.call(\"del\",KEYS[1])",
      "else",
      "    return 0",
      "end "
    ]

worldBestBlockRedlockKey :: S8.ByteString
worldBestBlockRedlockKey = "<worldbest_redlock>"
{-# INLINE worldBestBlockRedlockKey #-}

defaultRedlockTTL :: Int -- in milliseconds
defaultRedlockTTL = 3000

defaultRedlockBackoff :: Int -- in microseconds
defaultRedlockBackoff = 100 {- ms -} * 1000 {- us/ms -}

redisSetNXPX :: (RedisCtx m f) => S8.ByteString -> S8.ByteString -> Int -> m (f Status)
redisSetNXPX key value lockTTL = sendRequest ["SET", key, value, "NX", "PX", S8.pack (show lockTTL)]

acquireRedlock :: S8.ByteString -> Int -> Redis (Either Reply S8.ByteString)
acquireRedlock key lockTTL = do
  random <- S8.pack . (show :: Integer -> String) <$> liftIO randomIO
  reply <- redisSetNXPX key random lockTTL
  return $ case reply of
    Right Ok -> Right random
    Right (Status "") -> Left $ SingleLine "could not acquire the lock due to NX condition unmet"
    Right (Status s) -> Left . SingleLine $ "Somehow got a nonempty status, which makes no fucking sense: " `S8.append` s
    Right Pong -> Left $ SingleLine "Somehow got a \"PONG\", which makes no fucking sense."
    Left err -> Left err

releaseRedlock :: S8.ByteString -> S8.ByteString -> Redis (Either Reply Bool)
releaseRedlock key lock = eval releaseRedlockScript [key] [lock]

acquireWorldBestBlockRedlock :: Int -> Redis (Either Reply S8.ByteString)
acquireWorldBestBlockRedlock = acquireRedlock worldBestBlockRedlockKey

releaseWorldBestBlockRedlock :: S8.ByteString -> Redis (Either Reply Bool)
releaseWorldBestBlockRedlock = releaseRedlock worldBestBlockRedlockKey

worldBestBlockKey :: S8.ByteString
worldBestBlockKey = "<worldbest>"
{-# INLINE worldBestBlockKey #-}

getWorldBestBlockInfo :: Redis (Maybe RedisBestBlock)
getWorldBestBlockInfo = getBestBlockInfo' worldBestBlockKey

updateWorldBestBlockInfo :: Keccak256 -> Integer -> Redis (Either Reply Bool)
updateWorldBestBlockInfo sha num = withRetryCount 0
  where
    withRetryCount :: Int -> Redis (Either Reply Bool)
    withRetryCount theRetryCount = do
      maybeLockID <- acquireWorldBestBlockRedlock defaultRedlockTTL
      case maybeLockID of
        Left err -> do
          when (theRetryCount /= 0 && theRetryCount `mod` 5 == 0) $ do
            liftLog $ $logWarnS "updateWorldBestBlockInfo" . T.pack $ "Could not acquire redlock after " ++ show theRetryCount ++ " attempts, will retry; " ++ show err
            liftIO $ threadDelay defaultRedlockBackoff -- todo make backoff a factor instead of a fixed backoff
          withRetryCount $ theRetryCount + 1
        Right lockID -> do
          liftLog $ $logDebugS "updateWorldBestBlockInfo" "Acquired lock"
          maybeExistingWBBI <- getWorldBestBlockInfo
          case maybeExistingWBBI of
            Nothing -> do
              liftLog $ $logWarnS "updateWorldBestBlockInfo" "No WorldBestBlock in Redis, will force"
              void $ forceBestBlockInfo' worldBestBlockKey (RedisBestBlock sha num)
              checkAndUpdateSyncStatus
              releaseAndFinalize lockID True
            Just (RedisBestBlock _ oldNumber) -> do
              liftLog $ $logDebugS "updateWorldBestBlockInfo" $ T.pack ("oldNumber = " ++ show oldNumber ++ "; newNumber = " ++ show num)
              let willUpdate = oldNumber <= num
              if willUpdate
                then do
                  liftLog $ $logDebugS "updateWorldBestBlockInfo" . T.pack $ "Updating best block: " ++ show num
                  void $ forceBestBlockInfo' worldBestBlockKey (RedisBestBlock sha num)
                  checkAndUpdateSyncStatus
                else liftLog $ $logDebugS "updateWorldBestBlockInfo" "Not updating"
              releaseAndFinalize lockID willUpdate
      where
        releaseAndFinalize lockID didUpdate = do
          didRelease <- releaseWorldBestBlockRedlock lockID
          return $ case didRelease of
            Right True -> Right didUpdate
            Right False -> Left $ SingleLine "Couldn't release redlock, it either expired or we had the wrong key"
            err -> err

-- Put this after any "best block" or "world best block" update.
-- We can't put this in the update functions themselves since multiExec fudges things up
checkAndUpdateSyncStatus :: Redis ()
checkAndUpdateSyncStatus = do
  status <- getSyncStatus
  nodeBestBlock <- getBestBlockInfo
  worldBestBlock <- getWorldBestBlockInfo
  let nodeNumber = redisBestBlockNumber <$> nodeBestBlock
      worldNumber = redisBestBlockNumber <$> worldBestBlock

  case (status, nodeNumber, worldNumber) of
    (Just False, Just ntd, Just wtd) -> when (ntd >= wtd) (void $ putSyncStatus True)
    (Nothing, Just ntd, Just wtd) -> void $ putSyncStatus (ntd >= wtd)
    (Nothing, Nothing, Just _) -> void $ putSyncStatus False
    _ -> pure ()

getSyncStatusNow :: Redis (Maybe Bool)
getSyncStatusNow = do
  status <- getSyncStatus
  if case status of Just True -> True; _ -> False
    then pure $ Just True
    else do
      nodeBestBlock <- getBestBlockInfo
      worldBestBlock <- getWorldBestBlockInfo
      let nodeNumber = redisBestBlockNumber <$> nodeBestBlock
          worldNumber = redisBestBlockNumber <$> worldBestBlock
      pure $
        Just $ case (status, nodeNumber, worldNumber) of
          (Just False, Just ntd, Just wtd) -> ntd >= wtd
          (Nothing, Just ntd, Just wtd) -> ntd >= wtd
          (Nothing, Nothing, Just _) -> False
          _ -> True

syncStatusKey :: S8.ByteString
syncStatusKey = "<sync_status>"
{-# INLINE syncStatusKey #-}

getSyncStatus :: Redis (Maybe Bool)
getSyncStatus = fmap fromValue . eitherToMaybe <$> get syncStatusKey
  where
    eitherToMaybe :: Either a (Maybe b) -> Maybe b
    eitherToMaybe (Left _) = Nothing
    eitherToMaybe (Right a) = a

putSyncStatus :: RedisCtx m f => Bool -> m (f Status)
putSyncStatus status = set syncStatusKey $ toValue status

