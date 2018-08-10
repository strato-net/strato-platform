{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}

module Handler.ChainInfo where

import           Data.Aeson
import qualified Data.Map                       as M
import qualified Data.Set                       as S
import qualified Data.Text                      as T

import           Blockchain.SHA
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Sequencer.Event     (IngestEvent (IEGenesis), IngestGenesis (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Import                         hiding (hash)
import           Numeric                        (showHex)

import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ChainInfoDB
import           Blockchain.TypeLits
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


postChainR :: Handler Value
postChainR = do
  addHeader "Access-Control-Allow-Origin" "*"

  ci <- parseJsonBody :: Handler (Result ChainInfo)
  case ci of
    Success gen@(ChainInfo _ acin cdin mb) -> do
    -- add more checks?
      when (length acin == 0) $ invalidArgs ["account info is empty"]
      when (M.size mb == 0) $ invalidArgs ["member list is empty"]
      let accountCodeHashes = S.fromList . flip mapMaybe acin $ \case
            NonContract _ _ -> Nothing
            ContractNoStorage _ _ c -> Just c
            ContractWithStorage _ _ c _ -> Just c
          codeCodeHashes = S.fromList . flip map cdin $ \CodeInfo{..} -> hash codeInfoCode
      case accountCodeHashes S.\\ codeCodeHashes of
        s | s /= S.empty -> invalidArgs ["Each contract code hash in accountInfo must match a corresponding code hash in codeInfo."]
          | otherwise -> do
            liftIO $ putStrLn $ T.pack $ show gen
            bytes <- liftIO $ getEntropy 32
            let cid = fromInteger $ byteString2Integer bytes
            emitKafkaTransactions [(cid, gen)]
            return . String . T.pack $ showHex cid ""
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
      [] -> returnJson ([]::NamedMap "id" Word256 "info" ChainInfo)
      cis -> returnJson cis
