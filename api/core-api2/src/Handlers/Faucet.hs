{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Handlers.Faucet
  ( API
  , postFaucetClient
  , postFaucetMultipartClient
  , postDataFaucetClient
  , server
  ) where

import           Control.Monad
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Class
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Lazy                  as LBS
import           Data.Conduit
import           Data.Maybe
import           Data.Text                             (Text)
import qualified Data.Text                             as T
import qualified Database.Esqueleto                    as E
import qualified Network.Haskoin.Crypto                as H
import           Numeric
import           Servant
import           Servant.Client
import           Servant.Multipart
import           System.IO.Unsafe
import           Text.Printf

import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.DB.SQLDB
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Output
import           Blockchain.Sequencer.Event     (IngestEvent (IETx), IngestTx (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Util                (getCurrentMicrotime)
import           Control.Monad.Composable.SQL

import           Text.Format

import           FaucetKey
import           SQLM
import           UnliftIO

type API = 
  "faucet" :> ReqBody '[FormUrlEncoded] Address
           :> Post '[JSON] [Keccak256]
  :<|>
  "faucet" :> MultipartForm Mem (MultipartData Mem)
           :> Post '[JSON] [Keccak256]
  :<|>
  "dataFaucet" :> QueryParam "size" Int
               :> QueryParam "count" Int
               :> Get '[JSON] [Keccak256]
               
postFaucetClient :: Address -> ClientM [Keccak256]
postFaucetMultipartClient :: (LBS.ByteString, MultipartData Mem) -> ClientM [Keccak256]
postDataFaucetClient :: Maybe Int -> Maybe Int -> ClientM [Keccak256]
postFaucetClient
  :<|> postFaucetMultipartClient
  :<|> postDataFaucetClient = client (Proxy @API)

server :: (MonadLogger m, HasSQL m) => ServerT API m
server  =
  postFaucetC
  :<|> postFaucetMultipartC
  :<|> postDataFaucetC
  where postFaucetC a = runConduit $ postFaucet a `fuseUpstream` emitKafkaTransactions
        postFaucetMultipartC a = runConduit $ postFaucetMultipart a `fuseUpstream` emitKafkaTransactions
        postDataFaucetC a b = runConduit $ postDataFaucet a b `fuseUpstream` emitKafkaTransactions

-----------------------------------------

-- I can defend this usage of a global variable:
-- see https://wiki.haskell.org/Top_level_mutable_state
appFaucetNonce :: IORef Integer -- The last maximum nonce given out
{-# NOINLINE appFaucetNonce #-}
appFaucetNonce = unsafePerformIO (newIORef 0)

---------------

postFaucet :: (MonadIO m, MonadLogger m, Selectable Address Integer m)
           => Address -> ConduitT a IngestEvent m [Keccak256]
postFaucet target = do
  key <- liftIO $ fmap (fromMaybe $ error "missing faucet key") getFaucetKey
  minNonce <- lift . lookupNonce $ fromPrivateKey key

  maxNonce <- acquireNewMaxNonce minNonce
  $logInfoS "postFaucet" . T.pack $ printf "%s: [min..max]=[%d,%d]" (format target) minNonce maxNonce
  mapM (putTX maxNonce key target) [maxNonce, minNonce]
  where
    putTX maxN k a n = do
      ts <- liftIO getCurrentMicrotime
      tx <- makeSendTX maxN k a n
      yield . IETx ts $ IngestTx API tx
      pure $ txHash tx

postFaucetMultipart :: (MonadIO m, MonadLogger m, Selectable Address Integer m)
                    => MultipartData Mem -> ConduitT a IngestEvent m [Keccak256]
postFaucetMultipart multipartData = do
  case lookupInput "address" multipartData of
    Right a ->
      case toAddr a of
        Right address -> postFaucet address
        Left e -> throwIO $ InvalidArgs e
    Left e -> throwIO $ MissingParameterError e

toAddr :: Text -> Either String Address
toAddr v =
  case readHex $ T.unpack v of
    [(wd160, "")] -> Right $ Address wd160
    _ -> Left $ "Can't convert text to Address: " ++ show v


postDataFaucet :: (MonadIO m, Selectable Address Integer m) 
               => Maybe Int -> Maybe Int -> ConduitT a IngestEvent m [Keccak256]
postDataFaucet mSize mCountOf = do
  key <- liftIO $ fmap (fromMaybe $ error "missing faucet key") getFaucetKey
  minNonce <- lift . lookupNonce $ fromPrivateKey key
  let size = fromMaybe 4096 mSize
      countOf = fromMaybe 1 mCountOf
  replicateM countOf $ do
    maxN <- acquireNewMaxNonce minNonce
    ts <- liftIO getCurrentMicrotime
    tx <- makeSizedTX maxN size key
    yield . IETx ts $ IngestTx API tx
    pure $ txHash tx


{-
initialMaxNonce :: MonadIO m => m (IORef Integer)
initialMaxNonce = liftIO $ newIORef (-1)
-}

acquireNewMaxNonce :: MonadIO m => Integer -> m Integer
acquireNewMaxNonce minNonce = do
  let findNext :: Integer -> (Integer, Integer)
      -- Another node may have jumped ahead of our faucet stream or we may
      -- just be starting up, so always give at least the minNonce.
      findNext maxNonce =
        let next = 1 + max minNonce maxNonce
        in (next, next)
  liftIO $ atomicModifyIORef' appFaucetNonce findNext

instance HasSQL m => Selectable Address Integer m where
  select _ addr = fmap (fmap (addressStateRefNonce . E.entityVal) . listToMaybe) . sqlQuery $ E.select $
    E.from $ \accStateRef -> do
    E.where_ ((accStateRef E.^. AddressStateRefChainId) E.==. E.val 0
        E.&&. accStateRef E.^. AddressStateRefAddress E.==. E.val addr)
    return accStateRef

lookupNonce :: Selectable Address Integer m => Address -> m Integer
lookupNonce addr' = fromMaybe 0 <$> select (Proxy @Integer)  addr'

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => ConduitT IngestEvent Void m ()
emitKafkaTransactions = loop id
  where
    -- this is essentially the same as sinkList,
    -- except emitting to Kafka instead of returning the list
    loop front = await >>= maybe (emit $ front []) (\x -> loop $ front . (x:))
    emit txs = do
      $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ show (length txs) ++ " faucet tx(s) to unseqevents"
      rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents txs
      case rets of
          Left e      -> $logError $ T.pack $ "Could not write txs to Kafka: " ++ show e
          Right resps -> $logDebug $ T.pack $ "writeUnseqEventsEnd Kafka commit: " ++ show resps

makeSendTX :: MonadIO m => Integer -> PrivateKey -> Address -> Integer -> m Transaction
makeSendTX maxN k a n = do
  -- We use a declining gas schedule to prevent ejecting faucets that
  -- might more urgently need a nonce. For example, if faucet(y) is
  -- given [n] and faucet(x) is given [n, n+1], x's faucet
  -- should only take nonce n if y's faucet fails. In turn, faucet(z)
  -- with [n, n+1, n+2] has highest priority for n+2, second priority for n+1,
  -- and will only take n if both faucet(x) and faucet(y) don't.
  let gasPrice = 50000000000 - 100000 * (maxN - n)
  liftIO . H.withSource H.devURandom $
    createMessageTX n gasPrice 100000 a (1000*ether) "" Nothing k

-- TODO(tim): Add a queryparam for contracts with variable length bin-runtimes, rather
-- than these that have empty bin-runtimes.
makeSizedTX :: MonadIO m => Integer -> Int -> PrivateKey -> m Transaction
makeSizedTX nonce size pk =
  let code = Code $ B.replicate size 0x0
      gasPrice = 50000000000
      gasLimit = 100000
      val = 0
      mk = createContractCreationTX nonce gasPrice gasLimit val code Nothing pk
  in liftIO . H.withSource H.devURandom $ mk
