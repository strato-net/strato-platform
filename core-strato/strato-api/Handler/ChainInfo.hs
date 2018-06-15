{-# LANGUAGE OverloadedStrings #-}

module Handler.ChainInfo where

import           Data.Aeson
import qualified Data.Text                      as T

import           Blockchain.Data.GenesisInfo
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Sequencer.Event     (IngestEvent (IEGenesis), IngestGenesis (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Import


data ChainInfo =
  ChainInfo {
    chainLabel      :: String,
    addRule         :: String,
    removeRule      :: String,
    members         :: [String],
    accountBalance  :: [(Address, Word256)]
}


instance FromJSON ChainInfo where
  parseJSON (Object o) =
    ChainInfo <$>
    o .: "chainLabel" <*>
    o .: "addRule" <*>
    o .: "removeRule" <*>
    o .: "members" <*>
    o .: "accountBalance"
  parseJSON x = error $ "couldn't parse JSON for chain info: " ++ show x


emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [ChainInfo] -> m ()
emitKafkaTransactions gs = do
    let ingestGeneses = (\g -> IEGenesis (IngestGenesis API g)) <$> gs
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ (show $ length ingestGeneses) ++ " genesis info(s) to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestGeneses
    case rets of
        Left e      -> $logError $ "Could not write txs to Kafka: " Import.++ (T.pack $ show e)
        Right resps -> $logDebug $ "writeUnseqEventsEnd Kafka commit: " Import.++ (T.pack $ show resps)
    return ()

postChainR :: Handler Text
postChainR = do
  addHeader "Access-Control-Allow-Origin" "*"

  gi <- parseJsonBody :: Handler (Result ChainInfo)
  case gi of
    Success gen -> do
      liftIO $ putStrLn $ T.pack $ show gen
      emitKafkaTransactions [gen]
      return . T.pack . show $ gen
    _ -> invalidArgs ["could not parse the args"]


