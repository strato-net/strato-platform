{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# LANGUAGE TemplateHaskell       #-}
module Executable.AditM where

import           Blockchain.Output
import           Control.Monad                (when)
import           Control.Monad.FT
import           Control.Monad.IO.Class       (liftIO)
import qualified Control.Monad.State          as StateT
import           Control.Monad.Trans.Resource
import           Control.Lens
import qualified Data.Set as S
import           Data.Time.Clock

import           Blockchain.EthConf           (mkConfiguredKafkaState)
import           Network.Kafka

data AditState = AditState {
    aditKafkaState  :: KafkaState,
    _aditExceptionCount :: S.Set UTCTime
}

makeLenses ''AditState

errorWindow :: NominalDiffTime
errorWindow = 60 * 60 -- 1 hour

exceptionMaxCount :: Int
exceptionMaxCount = 3

recordException :: AditM ()
recordException = do
  n <- liftIO getCurrentTime
  aditExceptionCount %= S.insert n
  aditExceptionCount %= S.filter ((> errorWindow) . diffUTCTime n)
  presentExceptions <- uses aditExceptionCount S.size
  when (presentExceptions > exceptionMaxCount) $
    error "AditM reached exceptionMaxCount"

type AditM = StateT.StateT AditState (ResourceT (LoggingT IO))

instance Gettable KafkaState AditM where
  get   = StateT.gets aditKafkaState
instance Puttable KafkaState AditM where
  put k = StateT.modify $ \c -> c{aditKafkaState = k}
instance Modifiable KafkaState AditM where

runAditT :: AditM a -> LoggingT IO a
runAditT m = do
    let initKafkaState = mkConfiguredKafkaState "strato-adit"
    runResourceT $ StateT.evalStateT m (AditState initKafkaState S.empty)
