{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric     #-}


module Handler.ChainInfo where

import           Data.Aeson
import qualified Data.Text                      as T

import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Sequencer.Event     (IngestEvent (IEGenesis), IngestGenesis (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Import

import           Blockchain.Data.ChainInfo
import qualified Data.ByteString.Lazy             as BL
import           System.Entropy
import           Data.Binary.Get                  (runGet, getWord64be)
import           Data.LargeWord

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [ChainInfo] -> m ()
emitKafkaTransactions gs = do
    let ingestGeneses = (\g -> IEGenesis (IngestGenesis API g)) <$> gs
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ (show $ length ingestGeneses) ++ " genesis info(s) to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestGeneses
    case rets of
        Left e      -> $logError $ "Could not write txs to Kafka: " Import.++ (T.pack $ show e)
        Right resps -> $logDebug $ "writeUnseqEventsEnd Kafka commit: " Import.++ (T.pack $ show resps)
    return ()

byteStringToWord256 :: ByteString -> Word256
byteStringToWord256 bs =
  let
    [w4,w3,w2,w1] = flip runGet (BL.fromStrict bs) $ do
      w_4 <- getWord64be
      w_3 <- getWord64be
      w_2 <- getWord64be
      w_1 <- getWord64be
      return [w_4,w_3,w_2,w_1]
  in LargeKey w1 (LargeKey w2 (LargeKey w3 w4))

postChainR :: Handler Text
postChainR = do
  addHeader "Access-Control-Allow-Origin" "*"

  gi <- parseJsonBody :: Handler (Result ChainInfo)
  case gi of
    Success gen -> do
      liftIO $ putStrLn $ T.pack $ show gen
      emitKafkaTransactions [gen]
      bytes <- liftIO $ getEntropy 32
      return . T.pack . show $ byteStringToWord256 bytes
    _ -> invalidArgs ["could not parse the args"]

