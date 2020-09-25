{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Handlers.Chain
  ( API
  , getChainClient
  , postChainClient
  , postChainsClient
  , server
  , ChainInfo(..)
  , ChainId(..)
  , NamedTuple(..)
  ) where

import           Control.Monad
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
-- import qualified Data.ByteString.Char8          as BC
import           Conduit
import qualified Data.Map                       as M
-- import           Data.Maybe
-- import qualified Data.Set                       as S
import           Data.Swagger
import qualified Data.Text                      as T
import           Servant
import           Servant.Client

import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ChainInfoDB
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Output
import           Blockchain.Sequencer.Event     (IngestEvent (IEGenesis), IngestGenesis (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Blockchain.Strato.Model.ChainId
-- import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.TypeLits
import           SQLM
import           UnliftIO

type API = 
  "chain" :> QueryParams "chainid" ChainId  :> Get '[JSON] (NamedMap "id" "info" ChainId ChainInfo)
  :<|> "chain" :> ReqBody '[JSON] ChainInfo :> Post '[JSON] ChainId
  :<|> "chains" :> ReqBody '[JSON] [ChainInfo] :> Post '[JSON] [ChainId]

getChainClient :: [ChainId] -> ClientM (NamedMap "id" "info" ChainId ChainInfo)
postChainClient :: ChainInfo -> ClientM ChainId
postChainsClient :: [ChainInfo] -> ClientM [ChainId]
getChainClient :<|> postChainClient :<|> postChainsClient = client (Proxy @API)

server :: ServerT API SQLM
server = getChain :<|> postChainC :<|> postChainsC
  where postChainC  c  = runConduit $ postChain c `fuseUpstream` emitKafkaTransactions
        postChainsC cs = runConduit $ postChains cs `fuseUpstream` emitKafkaTransactions

-----------------------

instance ToSchema (NamedTuple "id" "info" ChainId ChainInfo) where
  declareNamedSchema _ = return $
    NamedSchema (Just "NamedTuple of Word256 and ChainInfo") mempty

instance Selectable ChainId ChainInfo SQLM where
  selectMany _ = fmap (M.fromList . map (unNamedTuple @"id" @"info")) . getChainInfos
  select     _ = fmap (fmap (snd . unNamedTuple @"id" @"info")) . getChainInfo

getChain :: Selectable ChainId ChainInfo m => [ChainId] -> m (NamedMap "id" "info" ChainId ChainInfo)
getChain = fmap (map (NamedTuple @"id" @"info") . M.toList) . selectMany (Proxy @ChainInfo)
    
postChain :: (MonadIO m, MonadLogger m) => ChainInfo -> ConduitT a IngestEvent m ChainId
postChain ci = do
    case processChainInfos [ci] of
      Left (_, err) -> throwIO . InvalidArgs $ "invalid args: " ++ err
      Right [] -> error "postChainR: The impossible happened. processChainInfos succeeded, but returned an empty list"
      Right (cid@(ChainId c):_) -> do
        $logDebugS "postChainR" . T.pack $ show ci
        $logInfoS "postChainR" (T.pack $ show cid)
        yield . IEGenesis $ IngestGenesis API (c,ci)
        return cid

postChains :: (MonadIO m, MonadLogger m) => [ChainInfo] -> ConduitT a IngestEvent m [ChainId]
postChains cis = do
  case processChainInfos cis of
      Left (i, err) -> throwIO . InvalidArgs $ "invalid args at index " ++ show i ++ ": " ++ err
      Right cids -> do
        $logDebugS "postChainsR" . T.pack $ show cis
        $logInfoS "postChainsR" $ T.intercalate ", " (T.pack . show <$> cids)
        yieldMany $ zipWith (\(ChainId a) b -> IEGenesis (IngestGenesis API (a,b))) cids cis
        return cids

---------------------------------------

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => ConduitT IngestEvent Void m ()
emitKafkaTransactions = loop id
  where
    -- this is essentially the same as sinkList,
    -- except emitting to Kafka instead of returning the list
    loop front = await >>= maybe (emit $ front []) (\x -> loop $ front . (x:))
    emit gs = do
      $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ show (length gs) ++ " genesis info to unseqevents"
      rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents gs
      case rets of
          Left e      -> $logError $ T.pack $ "Could not write txs to Kafka: " ++ show e
          Right resps -> $logDebug $ T.pack $ "writeUnseqEventsEnd Kafka commit: " ++  show resps

processChainInfos :: [ChainInfo] -> Either (Int, String) [ChainId]
processChainInfos chainInfos = forM (zip [0..] chainInfos) $ -- TODO(dustin): Use post-incrementing state
  \(i, gen@(ChainInfo (UnsignedChainInfo _ acin _ mb _ _ _ _) _)) -> do
    -- add more checks?
    when (length acin == 0) $ Left (i,"account info is empty")
    when (M.size mb == 0) $ Left (i, "member list is empty")
    let cid = rlpHash gen
    return . ChainId $ keccak256ToWord256 cid

