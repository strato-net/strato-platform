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
import           Blockchain.ExtWord             (Word256)
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

  ci <- parseJsonBody :: Handler (Result ChainInfo)
  case ci of
    Success gen@(ChainInfo _ ar rr mb ab) -> do 
      when (ar == "") $ invalidArgs ["add rule is empty"]
      when (rr == "") $ invalidArgs ["remove rule is empty"]
      when (length mb == 0) $ invalidArgs ["member list is empty"]
      let balanceSum = Import.foldr (\cur acc -> acc + (snd cur)) 0 ab
      when (balanceSum == 0) $ invalidArgs ["All balances are zero"]
      liftIO $ putStrLn $ T.pack $ show gen 
      bytes <- liftIO $ getEntropy 32
      let cid = fromInteger $ byteString2Integer bytes
      emitKafkaTransactions [(cid, gen)]
      return . T.pack $ showHex cid ""
    _ -> invalidArgs ["could not parse the args"]

getChainR :: Handler Value
getChainR = do
  chainIds <- lookupGetParams "chainid" 
  addHeader "Access-Control-Allow-Origin" "*"
  cInfos <- case chainIds of 
      [] -> getChainInfos []
      [cid] -> if (T.unpack cid == "all")
                   then getChainInfos []
                   else getChainInfos [fromHexText cid]
      cids -> getChainInfos $ fmap fromHexText cids
  case cInfos of
      [] -> invalidArgs ["no chain found"]
      cis -> returnJson cis
