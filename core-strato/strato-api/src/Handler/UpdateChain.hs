{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}


module Handler.UpdateChain where

import           Data.Aeson
import qualified Data.Text                      as T

import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Sequencer.Event     (IngestEvent (IEUpdate), IngestUpdate (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Import
import           Numeric                        (showHex)

import           Blockchain.Data.Enode
import           System.Entropy
import           Blockchain.Util
import           Blockchain.ExtWord             (Word256)
import           Handler.Filters

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [(Word256, [Enode])] -> m ()
emitKafkaTransactions us = do
    let ingestUpdate = (\(cid, u) -> IEUpdate (IngestUpdate API (cid, u))) <$> us
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ (show $ length ingestUpdate) ++ " update chain members to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestUpdate
    case rets of
        Left e      -> $logError $ "Could not write txs to Kafka: " Import.++ (T.pack $ show e)
        Right resps -> $logDebug $ "writeUnseqEventsEnd Kafka commit: " Import.++ (T.pack $ show resps)
    return ()


postUpdateChainR :: Handler Text
postChainR = do
  addHeader "Access-Control-Allow-Origin" "*"

  ci <- parseJsonBody :: Handler (Result (Word256, [Enode]))
  case ci of
    Success gen -> do 
      liftIO $ putStrLn $ T.pack $ show gen 
      emitKafkaTransactions [gen]
      return . T.pack . show $ gen
    _ -> invalidArgs ["could not parse the args"]
