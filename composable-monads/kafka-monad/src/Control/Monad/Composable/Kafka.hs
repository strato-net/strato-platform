{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}

module           Control.Monad.Composable.Kafka where


import           Control.Monad.IO.Unlift
import           Control.Monad.Reader
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.State
import           Data.IORef

import           Network.Kafka
import           Network.Kafka.Protocol

type KafkaM = ReaderT (IORef KafkaState)

class HasKafka m where
  getKafkaStateIORef :: m (IORef KafkaState)

data KafkaEnv =
  KafkaEnv {
    kafkaStateIORef :: IORef KafkaState
  }

createKafkaEnv :: MonadIO m =>
                  KafkaString -> KafkaAddress -> m KafkaEnv
createKafkaEnv x y = do
  ksIORef <- liftIO $ newIORef $ mkKafkaState x y
  return $ KafkaEnv ksIORef


runKafkaMUsingEnv :: KafkaEnv -> KafkaM m a -> m a
runKafkaMUsingEnv env f = 
  runReaderT f $ kafkaStateIORef env


instance Monad m => HasKafka (KafkaM m) where
  getKafkaStateIORef = ask

runKafkaM :: MonadUnliftIO m => KafkaString -> KafkaAddress -> KafkaM m a -> m a
runKafkaM x y f = flip runKafkaMUsingEnv f =<< createKafkaEnv x y

execKafka :: (HasKafka m, MonadIO m) =>
             StateT KafkaState (ExceptT KafkaClientError IO) a -> m a
execKafka f = do
  ksIORef <- getKafkaStateIORef
  ks <- liftIO $ readIORef ksIORef
  result <- liftIO $ runExceptT $ runStateT f ks
  case result of
    Left e -> error $ show e
    Right (v, ks') -> do
      liftIO $ writeIORef ksIORef ks'
      return v
