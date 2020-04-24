{-# LANGUAGE DataKinds, FlexibleInstances, OverloadedStrings, RecordWildCards, TemplateHaskell, TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Handlers.Chain (
  API,
  server
  ) where

import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.IO.Class
--import           Data.Aeson
import qualified Data.ByteString.Char8          as BC
import qualified Data.ByteString.Lazy.Char8     as BLC
import qualified Data.Map                       as M
import           Data.Maybe
import qualified Data.Set                       as S
import           Data.Text                      (Text)
import qualified Data.Text                      as T
import           Database.Persist.Postgresql
import           Numeric
import           Servant

import           Blockchain.Data.ChainId
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ChainInfoDB
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.ExtWord
import           Blockchain.Sequencer.Event     (IngestEvent (IEGenesis), IngestGenesis (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.SHA
import           Blockchain.TypeLits
import           SQLM

type API = 
  "chain" :> QueryParam "chainid" ChainId  :> Get '[JSON] (NamedMap "id" Word256 "info" ChainInfo)
  :<|> "chain" :> ReqBody '[JSON] ChainInfo :> Post '[JSON] Text
  :<|> "chains" :> ReqBody '[JSON] [ChainInfo] :> Post '[JSON] [Text]

server :: ConnectionString -> Server API
server connStr = getChain connStr :<|> postChain :<|> postChains

-----------------------

getChain :: ConnectionString -> Maybe ChainId -> Handler (NamedMap "id" Word256 "info" ChainInfo)
getChain connectionString mChainId = liftIO $ runSQLM connectionString $ 
  case mChainId of
    Nothing -> getChainInfos []
    Just (ChainId (Just chainid)) -> getChainInfos [chainid]
    Just (ChainId Nothing) -> getChainInfos [0]
    
postChain :: ChainInfo -> Handler Text
postChain ci = runStdoutLoggingT $ do
    case processChainInfos [ci] of
      Left (_, err) -> throwError $ err400{ errBody=BLC.pack $ "invalid args: " ++ err }
      Right [] -> error "postChainR: The impossible happened. processChainInfos succeeded, but returned an empty list"
      Right (cid:_) -> do
        let hexCid = T.pack $ showHex cid ""
        $logDebugS "postChainR" . T.pack $ show ci
        $logInfoS "postChainR" hexCid
        emitKafkaTransactions $ [(cid,ci)]
        return hexCid

postChains :: [ChainInfo] -> Handler [Text]
postChains cis = runStdoutLoggingT $ do
  case processChainInfos cis of
      Left (i, err) -> throwError err400{ errBody=BLC.pack $ "invalid args at index " ++ show i ++ ": " ++ err }
      Right cids -> do
        let hexCids = map (T.pack . flip showHex "") cids
        $logDebugS "postChainsR" . T.pack $ show cis
        $logInfoS "postChainsR" $ T.intercalate ", " hexCids
        emitKafkaTransactions $ zip cids cis
        return hexCids





---------------------------------------


emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [(Word256, ChainInfo)] -> m ()
emitKafkaTransactions gs = do
    let ingestGeneses = (\(cid,g) -> IEGenesis (IngestGenesis API (cid,g))) <$> gs
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ (show $ length ingestGeneses) ++ " genesis info(s) to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestGeneses
    case rets of
        Left e      -> $logError $ T.pack $ "Could not write txs to Kafka: " ++ show e
        Right resps -> $logDebug $ T.pack $ "writeUnseqEventsEnd Kafka commit: " ++  show resps
    return ()


processChainInfos :: [ChainInfo] -> Either (Int, String) [Word256]
processChainInfos chainInfos = forM (zip [0..] chainInfos) $ -- TODO(dustin): Use post-incrementing state
  \(i, gen@(ChainInfo (UnsignedChainInfo _ acin cdin mb _ _ _ mmd) _)) -> do
    -- add more checks?
    when (length acin == 0) $ Left (i,"account info is empty")
    when (M.size mb == 0) $ Left (i, "member list is empty")
    let theVM = fromMaybe "EVM" $ M.lookup "VM" mmd
        accountCodeHashes = S.fromList . flip mapMaybe acin $ \case
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
      s | s /= S.empty -> Left (i, "Each contract code hash in accountInfo must match a corresponding code hash in codeInfo.")
        | otherwise -> do
          let SHA cid = rlpHash gen
          return cid

