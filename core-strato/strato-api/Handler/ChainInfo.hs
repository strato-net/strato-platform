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
import           Numeric                        (showHex)

import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ChainInfoDB
import           System.Entropy
import           Blockchain.Util
import           Blockchain.ExtWord              (Word256)
import           Handler.Filters

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [(Word256, ChainInfo)] -> m ()
emitKafkaTransactions gs = do
    let ingestGeneses = (\(cid,g) -> IEGenesis (IngestGenesis API (cid,g))) <$> gs
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
      bytes <- liftIO $ getEntropy 32
      let cid = fromInteger $ byteString2Integer bytes
      emitKafkaTransactions [(cid, gen)]
      return . T.pack $ showHex cid ""
    _ -> invalidArgs ["could not parse the args"]

getChainR :: Handler Value
getChainR = do
  chainId <- fmap (fmap fromHexText) $ lookupGetParam "chainid" 
  addHeader "Access-Control-Allow-Origin" "*"
  case chainId of
    Just cid -> do 
      chainInfo <- getChainInfo cid
      case chainInfo of
        Just ci -> returnJson ci
        Nothing -> invalidArgs ["could not find any chain with the given chain id"]
    Nothing -> do
        cInfos <- getAllChainInfos
        case cInfos of
            [] -> invalidArgs ["no chain found"]
            cis -> return $ toJSON cis 
