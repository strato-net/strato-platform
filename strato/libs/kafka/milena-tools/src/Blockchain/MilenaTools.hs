{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

{-# OPTIONS -fno-warn-redundant-constraints #-}

module Blockchain.MilenaTools where

-- import           Control.Monad               (when, void)

-- import Control.Monad.Reader (Monad)

import BlockApps.Logging
import Control.Concurrent (threadDelay)
import Control.Exception
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Except (ExceptT (..), runExceptT, throwError)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Control.Monad.Trans.State
import Data.List (find)
import qualified Data.Text as T
import Network.Kafka
import Network.Kafka.Protocol
import Prelude

_kMetadata :: Metadata -> KafkaString
_kMetadata (Metadata x) = x

fetchSingleOffset :: Kafka m => ConsumerGroup -> TopicName -> Partition -> m (Either KafkaError (Offset, Metadata))
fetchSingleOffset groupName topic partition = do
  let retry = fetchSingleOffset groupName topic partition

  ret <- fetchOffset $ OffsetFetchReq (groupName, [(topic, [partition])])
  case ret of
    (OffsetFetchResp [(_, [(_, ofs, md, err)])]) ->
      case (err, ofs) of
        (NoError, -1) -> return $ Left UnknownTopicOrPartition -- todo: stop simulating ZK behavior!
        (NoError, _) -> return $ Right (ofs, md)
        (NotCoordinatorForConsumerCode, _) -> retry
        (ConsumerCoordinatorNotAvailableCode, _) -> retry
        (OffsetsLoadInProgressCode, _) -> retry
        (err', _) -> return $ Left err'
    _ -> error "unexpected response from fetchOffset in call to fetchSingleOffset"

commitSingleOffset :: Kafka m => ConsumerGroup -> TopicName -> Partition -> Offset -> Metadata -> m (Either KafkaError ())
commitSingleOffset groupName topic partition offset ofsMetadata = do
  ret <-
    commitOffset $
      OffsetCommitReq (groupName, -1, "", -1, [(topic, [(partition, offset, ofsMetadata)])])

  case ret of
    (OffsetCommitResp [(_, [(_, err)])]) -> do
      case err of
        NoError -> pure $ Right ()
        RequestTimedOut -> throwError $ KafkaFailedToFetchGroupCoordinator RequestTimedOut
        _ -> pure $ Left err
    _ -> error "unexpected response from commitOffset in call to commitSingleOffset"

-- Functions that parse kafka responses for errors that are hidden within the list of responses
parseKafkaResponse :: ProduceResponse -> IO ()
parseKafkaResponse pr =
  case maybeError of
    (Just e) -> throwIO e
    Nothing -> return ()
  where
    scd = concatMap snd $ _produceResponseFields pr -- type [(Partition, KafkaError, Offset)]
    es = map (\(_, ke, _) -> ke) scd -- type [KafkaError]
    maybeError = find (/= NoError) es

-- if (any (/= NoError) e) then
--   throwIO $ e !! 0
-- else
--   return ()

withKafkaRetry :: (MonadIO m, MonadLogger m, Mod.Modifiable KafkaState m, Show a) => Int -> StateT KafkaState (ExceptT KafkaClientError IO) a -> m a
withKafkaRetry t k = do
  s <- Mod.get (Mod.Proxy @KafkaState)
  let go = do
        r <- liftIO . runExceptT $ runStateT k s
        case r of
          Right a -> do
            return a
          Left e -> do
            $logErrorS "withKafkaRetry" . T.pack $ show e
            (liftIO $ threadDelay (1000 * t)) >> go
  (a, newS) <- go
  Mod.put (Mod.Proxy @KafkaState) newS
  return a

withKafkaRetry1s :: (MonadIO m, MonadLogger m, Mod.Modifiable KafkaState m, Show a) => StateT KafkaState (ExceptT KafkaClientError IO) a -> m a
withKafkaRetry1s = withKafkaRetry 1000
