{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE LambdaCase           #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE QuasiQuotes          #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.SyncDB
  ( HasSyncDB(..),
    SyncStatus(..),
    getBestBlockInfo,
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

import           BlockApps.Logging
import           Blockchain.BlockDB
import           Blockchain.DB.SQLDB
import           Blockchain.Model.SyncState
import           Blockchain.Model.SyncTask
import           Blockchain.Strato.Model.Host
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.RedisBlockDB.Models as Models
import           Control.Concurrent                    (threadDelay)
import           Control.Monad
import           Control.Monad.Composable.SQL
import           Control.Monad.Trans
import qualified Data.ByteString.Char8                 as S8
import qualified Data.Text                             as T
import           Data.Time
import           Database.Esqueleto.Legacy
import qualified Database.Persist.Sql                  as SQL
import           Database.Redis                        (Redis, RedisCtx)
import qualified Database.Redis                        as REDIS
import           System.Random                         (randomIO)
import qualified Text.Colors                           as CL
import           Text.Format
import           Text.RawString.QQ

newtype SyncStatus = SyncStatus { unSyncStatus :: Bool }

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
  Headers            -> "h:"
  Transactions       -> "t:"
  Numbers            -> "n:"
  Uncles             -> "u:"
  Parent             -> "p:"
  Children           -> "c:"
  Canonical          -> "q:"
  Validators         -> "validators"
  X509Certificates   -> "x509:"
  ParsedSetWhitePage -> "potu:"
  ParsedSetToX509    -> "psx509:"

bestBlockInfoKey :: S8.ByteString
bestBlockInfoKey = S8.pack "<best>"
{-# INLINE bestBlockInfoKey #-}

bestSequencedBlockInfoKey :: S8.ByteString
bestSequencedBlockInfoKey = S8.pack "<best_sequenced>"
{-# INLINE bestSequencedBlockInfoKey #-}

putBestBlockInfo ::
  Keccak256 ->
  Integer ->
  Redis (Either REDIS.Reply REDIS.Status)
putBestBlockInfo newSha newNumber = do
  --liftIO . putStrLn . ("New args" ++) $ show (keccak256ToHex newSha, newNumber, newTDiff)
  oldBBI' <- getBestBlockInfo
  case oldBBI' of
    Nothing -> return (Left $ REDIS.SingleLine "Got no block from getBetstBlockInfo")
    Just (BestBlock oldSha oldNumber) -> do
      --liftIO . putStrLn . ("Old args" ++) $ show (keccak256ToHex oldSha, oldNumber, oldTDiff)
      helper' <- commonAncestorHelper oldNumber newNumber oldSha newSha
      case helper' of
        Left err -> error $ "god save the queen! " ++ show err
        Right (updates, deletions) -> do
          --liftIO . putStrLn $ "Updates: \n" ++ unlines ((\(x, y) -> show (keccak256ToHex x, y)) <$> updates)
          --liftIO . putStrLn $ "Deletions: \n" ++ show deletions
          res <- REDIS.multiExec $ do
            forM_ updates $ \(sha, num) -> REDIS.set (inNamespace Canonical num) (toValue sha)
            unless (null deletions) . void . REDIS.del $ inNamespace Canonical . toKey <$> deletions
            forceBestBlockInfo newSha newNumber
          checkAndUpdateSyncStatus
          case res of
            REDIS.TxSuccess _ -> return $ Right REDIS.Ok
            REDIS.TxAborted -> return . Left $ REDIS.SingleLine (S8.pack "Aborted")
            REDIS.TxError e -> return . Left $ REDIS.SingleLine (S8.pack e)

-- | Used to seed the first bestBlock, e.g. genesis block in strato-setup
forceBestBlockInfo :: RedisCtx m f => Keccak256 -> Integer -> m (f REDIS.Status)
forceBestBlockInfo sha i =
  forceBestBlockInfo' bestBlockInfoKey (BestBlock sha i) --`totalRecall` (,,)

forceBestBlockInfo' :: RedisCtx m f => S8.ByteString -> BestBlock -> m (f REDIS.Status)
forceBestBlockInfo' key = REDIS.set key . toValue

getBestBlockInfo :: Redis (Maybe BestBlock)
getBestBlockInfo = getBestBlockInfo' bestBlockInfoKey

getBestSequencedBlockInfo :: Redis (Maybe BestSequencedBlock)
getBestSequencedBlockInfo =
  REDIS.get bestSequencedBlockInfoKey >>= \case
    Left e  -> error $ "error trying to get BestSequencedBlock: " ++ show e
    Right v ->  return $ fmap fromValue v

putBestSequencedBlockInfo :: RedisCtx m f => BestSequencedBlock -> m (f REDIS.Status)
putBestSequencedBlockInfo = REDIS.set bestSequencedBlockInfoKey . toValue

getBestBlockInfo' :: S8.ByteString -> Redis (Maybe BestBlock)
getBestBlockInfo' key =
  REDIS.get key >>= \case
    Left x -> do
      liftLog $ $logErrorS "getBestBlockInfo'" . T.pack $ "got Left " ++ show x
      return Nothing
    Right v -> case v of
      Nothing -> return Nothing -- return . Left $ REDIS.SingleLine "No BestBlock data set in RedisBlockDB"
      Just bs -> return . Just $ BestBlock sha num
        where
          BestBlock sha num = fromValue bs

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

redisSetNXPX :: (RedisCtx m f) => S8.ByteString -> S8.ByteString -> Int -> m (f REDIS.Status)
redisSetNXPX key value lockTTL = REDIS.sendRequest ["SET", key, value, "NX", "PX", S8.pack (show lockTTL)]

acquireRedlock :: S8.ByteString -> Int -> Redis (Either REDIS.Reply S8.ByteString)
acquireRedlock key lockTTL = do
  random <- S8.pack . (show :: Integer -> String) <$> liftIO randomIO
  reply <- redisSetNXPX key random lockTTL
  return $ case reply of
    Right REDIS.Ok -> Right random
    Right (REDIS.Status "") -> Left $ REDIS.SingleLine "could not acquire the lock due to NX condition unmet"
    Right (REDIS.Status s) -> Left . REDIS.SingleLine $ "Somehow got a nonempty status, which makes no fucking sense: " `S8.append` s
    Right REDIS.Pong -> Left $ REDIS.SingleLine "Somehow got a \"PONG\", which makes no fucking sense."
    Left err -> Left err

releaseRedlock :: S8.ByteString -> S8.ByteString -> Redis (Either REDIS.Reply Bool)
releaseRedlock key lock = REDIS.eval releaseRedlockScript [key] [lock]

acquireWorldBestBlockRedlock :: Int -> Redis (Either REDIS.Reply S8.ByteString)
acquireWorldBestBlockRedlock = acquireRedlock worldBestBlockRedlockKey

releaseWorldBestBlockRedlock :: S8.ByteString -> Redis (Either REDIS.Reply Bool)
releaseWorldBestBlockRedlock = releaseRedlock worldBestBlockRedlockKey

worldBestBlockKey :: S8.ByteString
worldBestBlockKey = "<worldbest>"
{-# INLINE worldBestBlockKey #-}

getWorldBestBlockInfo :: Redis (Maybe BestBlock)
getWorldBestBlockInfo = getBestBlockInfo' worldBestBlockKey

updateWorldBestBlockInfo :: Keccak256 -> Integer -> Redis (Either REDIS.Reply Bool)
updateWorldBestBlockInfo sha num = withRetryCount 0
  where
    withRetryCount :: Int -> Redis (Either REDIS.Reply Bool)
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
              void $ forceBestBlockInfo' worldBestBlockKey (BestBlock sha num)
              checkAndUpdateSyncStatus
              releaseAndFinalize lockID True
            Just (BestBlock _ oldNumber) -> do
              liftLog $ $logDebugS "updateWorldBestBlockInfo" $ T.pack ("oldNumber = " ++ show oldNumber ++ "; newNumber = " ++ show num)
              let willUpdate = oldNumber <= num
              if willUpdate
                then do
                  liftLog $ $logDebugS "updateWorldBestBlockInfo" . T.pack $ "Updating best block: " ++ show num
                  void $ forceBestBlockInfo' worldBestBlockKey (BestBlock sha num)
                  checkAndUpdateSyncStatus
                else liftLog $ $logDebugS "updateWorldBestBlockInfo" "Not updating"
              releaseAndFinalize lockID willUpdate
      where
        releaseAndFinalize lockID didUpdate = do
          didRelease <- releaseWorldBestBlockRedlock lockID
          return $ case didRelease of
            Right True -> Right didUpdate
            Right False -> Left $ REDIS.SingleLine "Couldn't release redlock, it either expired or we had the wrong key"
            err -> err

-- Put this after any "best block" or "world best block" update.
-- We can't put this in the update functions themselves since multiExec fudges things up
checkAndUpdateSyncStatus :: Redis ()
checkAndUpdateSyncStatus = do
  status <- getSyncStatus
  nodeBestBlock <- getBestBlockInfo
  worldBestBlock <- getWorldBestBlockInfo
  let nodeNumber = bestBlockNumber <$> nodeBestBlock
      worldNumber = bestBlockNumber <$> worldBestBlock

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
      let nodeNumber = bestBlockNumber <$> nodeBestBlock
          worldNumber = bestBlockNumber <$> worldBestBlock
      pure $
        Just $ case (status, nodeNumber, worldNumber) of
          (Just False, Just ntd, Just wtd) -> ntd >= wtd
          (Nothing, Just ntd, Just wtd)    -> ntd >= wtd
          (Nothing, Nothing, Just _)       -> False
          _                                -> True

syncStatusKey :: S8.ByteString
syncStatusKey = "<sync_status>"
{-# INLINE syncStatusKey #-}

getSyncStatus :: Redis (Maybe Bool)
getSyncStatus = fmap fromValue . eitherToMaybe <$> REDIS.get syncStatusKey
  where
    eitherToMaybe :: Either a (Maybe b) -> Maybe b
    eitherToMaybe (Left _)  = Nothing
    eitherToMaybe (Right a) = a

putSyncStatus :: RedisCtx m f => Bool -> m (f REDIS.Status)
putSyncStatus status = REDIS.set syncStatusKey $ toValue status

class HasSyncDB m where
  clearAllSyncTasks :: Host -> m ()
  getCurrentSyncTask :: Host -> m (Maybe SyncTask)
  getNewSyncTask :: Host -> Integer -> m (Maybe SyncTask)
  setSyncTaskFinished :: Host -> m ()
  setSyncTaskNotReady :: Host -> m ()

instance HasSQL m => HasSyncDB m where
  clearAllSyncTasks host = sqlQuery $ do
    rawExecute
        [r|
            UPDATE "sync_task"
            SET "host" = ''
            WHERE "host" = ?
        |]
        [toPersistValue host]

  getCurrentSyncTask host = sqlQuery $ do
    vals <-
        select $ from $ \syncTask -> do
          where_ (
            (syncTask^.SyncTaskHost ==. val host)
            &&.
            (syncTask ^. SyncTaskStatus ==. val Assigned)
            )
          return syncTask

    -- This function shouldn't be called unless we have a current task assigned....
    -- A connected peer could still trigger it even if none assigned (ie- by sending an unrequested BlockBody message),
    -- however, this is bad behavior and it is good and right that we throw an erro and hang up on that peer
    -- (hence, "error" is the correct response below).
    case vals of
      [v] -> return $ Just $ SQL.entityVal v
      [] -> return Nothing
      _ -> error $ CL.red $ "multiple sync tasks found in call to getCurrentSyncTask:\n" ++ unlines (map (format . entityVal) vals)

  getNewSyncTask "127.0.0.1" _ = return Nothing -- empirically, I've observed a lot of wasted time trying to sync from the loopback....  Probably should just stop self-connect from even happening, but for now I'll just filter it out here
  getNewSyncTask host highestBlockNum = sqlQuery $ do
    now <- liftIO getCurrentTime
    let oneMinuteAgo = addUTCTime (-60) now

    result <- rawSql
        [r|
            UPDATE "sync_task"
            SET "host" = ?, "assignment_time" = ?, "status" = 'Assigned'
            WHERE "id" = (
                SELECT "id"
                FROM "sync_task"
                WHERE "assignment_time" < ?
                  AND "status" != 'Finished'
                ORDER BY "assignment_time" ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING
        |]
        [toPersistValue host, toPersistValue now, toPersistValue oneMinuteAgo]

    case result of
      oneTask:_ -> return $ Just $ entityVal oneTask
      [] -> do
        --No existing task, make a new one
        results <- SQL.rawSql
          [r|
            INSERT INTO sync_task (host)
            SELECT ?
            WHERE (select count(*) from "sync_task") < ?
            RETURNING
          |] [toPersistValue host, toPersistValue $ 1 + highestBlockNum `div` 1000]

        case results of
          [v] -> return $ Just $ SQL.entityVal v
          []  -> return Nothing
          _   -> error "this seems impossible, getNewSyncTask tried to create one new task, but multiple were created.  Internal error"

  setSyncTaskFinished host = sqlQuery $ do
    update $ \syncTask -> do
      set syncTask [SyncTaskStatus =. val Finished]
      where_ (
        (syncTask^.SyncTaskHost ==. val host)
        &&.
        (syncTask^.SyncTaskStatus ==. val Assigned)
        )
    return ()

  setSyncTaskNotReady host = sqlQuery $ do
    update $ \syncTask -> do
      set syncTask [SyncTaskStatus =. val NotReady]
      where_ (
        (syncTask^.SyncTaskHost ==. val host)
        &&.
        (syncTask^.SyncTaskStatus ==. val Assigned)
        )
    return ()
