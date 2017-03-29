{-# LANGUAGE TypeSynonymInstances, FlexibleContexts, FlexibleInstances, OverloadedStrings #-}
module Executable.AditM where

import Control.Monad.Logger
import Control.Monad.State
import Control.Monad.Trans.Resource

import Blockchain.EthConf (mkConfiguredKafkaState)
import Network.Kafka

data AditState = AditState {
    aditKafkaState  :: KafkaState
}

type AditM = StateT AditState (ResourceT (LoggingT IO))

instance HasKafkaState AditM where
    getKafkaState = aditKafkaState <$> get
    putKafkaState ns = do
        ctx <- get
        put $ ctx { aditKafkaState = ns }

runAditT :: AditM a -> LoggingT IO a
runAditT m = do
    let initKafkaState = mkConfiguredKafkaState "strato-adit"
    runResourceT $ evalStateT m (AditState initKafkaState)
