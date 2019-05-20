{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# LANGUAGE TemplateHaskell       #-}
module Executable.AditM where

import           Blockchain.Output
import           Control.Lens                 (lens)
import           Control.Monad.Change.Modify  (Has(..))
import           Control.Monad.State
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

type AditM = StateT AditState (ResourceT (LoggingT IO))

instance AditState `Has` KafkaState where
  this _ = lens aditKafkaState (\c a -> c{aditKafkaState = a})

runAditT :: AditM a -> LoggingT IO a
runAditT m = do
    let initKafkaState = mkConfiguredKafkaState "strato-adit"
    runResourceT $ evalStateT m (AditState initKafkaState S.empty)
