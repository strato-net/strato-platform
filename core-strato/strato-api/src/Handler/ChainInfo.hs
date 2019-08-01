{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RankNTypes          #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Handler.ChainInfo where

import           Data.Aeson
import qualified Data.ByteString.Char8          as BC
import qualified Data.Map                       as M
import qualified Data.Set                       as S
import qualified Data.Text                      as T


import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ChainInfoDB
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.ExtWord             (Word256)
import           Blockchain.Sequencer.Event     (IngestEvent (IEGenesis), IngestGenesis (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Blockchain.SHA
import           Blockchain.Strato.Model.CodePtr

import           Handler.Filters
import           Import                         hiding (hash)
import           Numeric                        (showHex)

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [(Word256, ChainInfo)] -> m ()
emitKafkaTransactions gs = do
    let ingestGeneses = (\(cid,g) -> IEGenesis (IngestGenesis API (cid,g))) <$> gs
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ (show $ length ingestGeneses) ++ " genesis info(s) to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestGeneses
    case rets of
        Left e      -> $logError $ "Could not write txs to Kafka: " Import.++ (T.pack $ show e)
        Right resps -> $logDebug $ "writeUnseqEventsEnd Kafka commit: " Import.++ (T.pack $ show resps)
    return ()


postChainR :: HandlerFor App Value
postChainR = do
  addHeader "Access-Control-Allow-Origin" "*"

  ci <- parseJsonBody :: HandlerFor App (Result ChainInfo)
  case ci of
    Success gen@(ChainInfo (UnsignedChainInfo _ acin cdin mb _ _ _ mmd) _) -> do
    -- add more checks?
      when (length acin == 0) $ invalidArgs ["account info is empty"]
      when (M.size mb == 0) $ invalidArgs ["member list is empty"]

      let theVM = fromMaybe "EVM" $ M.lookup "VM" mmd
      
      let accountCodeHashes = S.fromList . flip mapMaybe acin $ \case
            NonContract _ _ -> Nothing
            ContractNoStorage _ _ (EVMCode c) -> Just c
            ContractNoStorage _ _ (SolidVMCode _ c) -> Just c
            ContractWithStorage _ _ (EVMCode c) _ -> Just c
            ContractWithStorage _ _ (SolidVMCode _ c) _ -> Just c
          getCode CodeInfo{..} =
            case theVM of --For SolidVM, the source is the code
              "SolidVM" -> BC.pack $ T.unpack codeInfoSource
              _ -> codeInfoCode
          codeCodeHashes = S.fromList . flip map cdin $ hash . getCode
                                           
      case accountCodeHashes S.\\ codeCodeHashes of
        s | s /= S.empty -> invalidArgs ["Each contract code hash in accountInfo must match a corresponding code hash in codeInfo."]
          | otherwise -> do
            $logDebugS "postChainR" . T.pack $ show gen
            let SHA cid = rlpHash gen
            emitKafkaTransactions [(cid, gen)]
            return . String . T.pack $ showHex cid ""
    _ -> invalidArgs ["could not parse the args"]

getChainR :: HandlerFor App Value
getChainR = do
  chainIds <- lookupGetParams "chainid"
  addHeader "Access-Control-Allow-Origin" "*"
  returnJson =<< case chainIds of
      [] -> getChainInfos []
      [cid] -> if (T.unpack cid == "all")
                   then getChainInfos []
                   else getChainInfos [fromHexText cid]
      cids -> getChainInfos $ fmap fromHexText cids
