{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Handlers.Chain
  ( API
  , getChain
  , getChainClient
  , postChain
  , postChainClient
  , postChains
  , postChainsClient
  , server
  , ChainInfo(..)
  , ChainId(..)
  , NamedTuple(..)
  ) where

import           Control.Monad
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Control.Lens
import           Conduit
import qualified Data.Map                       as M
import           Data.Swagger
import qualified Data.Text                      as T
import qualified Database.Esqueleto.Legacy      as E
import           Servant
import           Servant.Client
import           Numeric.Natural

import           BlockApps.Logging
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.ChainInfoDB
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Sequencer.Event     (IngestEvent (IEGenesis), IngestGenesis (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.TypeLits
import           Control.Monad.Composable.SQL
import           SQLM
import           UnliftIO
import           Settings

type API = 
  "chain" :> QueryParams "chainid" ChainId  
          :> QueryParam "limit" Integer
          :> QueryParam "offset" Integer
          :> Get '[JSON] (NamedMap "id" "info" ChainId ChainInfo)
  :<|> "chain" :> ReqBody '[JSON] ChainInfo :> Post '[JSON] ChainId
  :<|> "chains" :> ReqBody '[JSON] [ChainInfo] :> Post '[JSON] [ChainId]

data ChainFilterParams = ChainFilterParams
  { _qaChainId :: [ChainId]
  , _qaLimit :: Maybe Natural
  , _qaOffset :: Maybe Natural
  } deriving (Eq, Ord, Show)

makeLenses ''ChainFilterParams

getChainClient :: [ChainId] -> ClientM (NamedMap "id" "info" ChainId ChainInfo)
postChainClient :: ChainInfo -> ClientM ChainId
postChainsClient :: [ChainInfo] -> ClientM [ChainId]
getChainClient :<|> postChainClient :<|> postChainsClient = client (Proxy @API)

server :: (MonadLogger m, HasSQL m) => ServerT API m
server = getChain :<|> postChain :<|> postChains

-----------------------

instance ToSchema (NamedTuple "id" "info" ChainId ChainInfo) where
  declareNamedSchema _ = return $
    NamedSchema m (Just "NamedTuple of Word256 and ChainInfo") mempty

chainFilterParams :: ChainFilterParams
chainFilterParams = ChainFilterParams [] fromInteger appFetchLimit 0

instance HasSQL m => Selectable ChainFilterParams (NamedMap "id" "info" ChainId ChainInfo) m where
  select _ (ChainFilterParams cIds lim ofs) = Just <$> getChainInfos cIds fromInteger lim  fromInteger ofs

getChain :: Selectable ChainId ChainInfo m => [ChainId] -> m (NamedMap "id" "info" ChainId ChainInfo)
getChain = fmap (map (NamedTuple @"id" @"info") . M.toList) . selectMany (Proxy @ChainInfo)
    
postChainConduit :: (MonadIO m, MonadLogger m) => ChainInfo -> ConduitT a IngestEvent m ChainId
postChainConduit ci = do
    case processChainInfos [ci] of
      Left (_, err) -> throwIO . InvalidArgs $ "invalid args: " ++ err
      Right [] -> error "postChainR: The impossible happened. processChainInfos succeeded, but returned an empty list"
      Right (cid@(ChainId c):_) -> do
        $logDebugS "postChainR" . T.pack $ show ci
        $logInfoS "postChainR" (T.pack $ show cid)
        yield . IEGenesis $ IngestGenesis API (c,ci)
        return cid

postChain :: (MonadIO m, MonadLogger m) =>
             ChainInfo -> m ChainId
postChain  c  = runConduit $ postChainConduit c `fuseUpstream` emitKafkaTransactions


postChainsConduit :: (MonadIO m, MonadLogger m) => [ChainInfo] -> ConduitT a IngestEvent m [ChainId]
postChainsConduit cis = do
  case processChainInfos cis of
      Left (i, err) -> throwIO . InvalidArgs $ "invalid args at index " ++ show i ++ ": " ++ err
      Right cids -> do
        $logDebugS "postChainsR" . T.pack $ show cis
        $logInfoS "postChainsR" $ T.intercalate ", " (T.pack . show <$> cids)
        yieldMany $ zipWith (\(ChainId a) b -> IEGenesis (IngestGenesis API (a,b))) cids cis
        return cids

postChains :: (MonadIO m, MonadLogger m) =>
              [ChainInfo] -> m [ChainId]
postChains cs = runConduit $ postChainsConduit cs `fuseUpstream` emitKafkaTransactions

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

