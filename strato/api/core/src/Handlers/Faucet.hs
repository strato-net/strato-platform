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
  ( API,
    server,
    postFaucet,
    postFaucetMultipart,
    postDataFaucet,
  )
where

import BlockApps.Logging
import Blockchain.Constants
import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Data.TXOrigin
import Blockchain.Data.Transaction
import Blockchain.EthConf (runKafkaMConfigured)
import Blockchain.Sequencer.Event (IngestEvent (IETx), IngestTx (..))
import Blockchain.Sequencer.Kafka (writeUnseqEvents)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.MicroTime (getCurrentMicrotime)
import Blockchain.Strato.Model.Secp256k1
import Control.Monad
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import qualified Data.ByteString as B
import Data.Conduit
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as T
import qualified Database.Esqueleto.Legacy as E
import FaucetKey
import Numeric
import SQLM
import Servant
import Servant.Multipart
import Servant.Multipart.Client ()
import System.IO.Unsafe
import Text.Format
import Text.Printf
import UnliftIO

type API =
  "faucet" :> ReqBody '[FormUrlEncoded] Address
    :> Post '[JSON] [Keccak256]
    :<|> "faucet" :> MultipartForm Mem (MultipartData Mem)
      :> Post '[JSON] [Keccak256]
    :<|> "dataFaucet" :> QueryParam "size" Int
      :> QueryParam "count" Int
      :> Get '[JSON] [Keccak256]

server :: (MonadLogger m, HasSQL m) => ServerT API m
server =
  postFaucet
    :<|> postFaucetMultipart
    :<|> postDataFaucet

postFaucet ::
  (MonadIO m, MonadLogger m, Selectable Address Integer m) =>
  Address ->
  m [Keccak256]
postFaucet a = runConduit $ postFaucetC a `fuseUpstream` emitKafkaTransactions

postFaucetMultipart ::
  (MonadIO m, MonadLogger m, Selectable Address Integer m) =>
  MultipartData Mem ->
  m [Keccak256]
postFaucetMultipart a = runConduit $ postFaucetMultipartC a `fuseUpstream` emitKafkaTransactions

postDataFaucet ::
  (MonadIO m, MonadLogger m, Selectable Address Integer m) =>
  Maybe Int ->
  Maybe Int ->
  m [Keccak256]
postDataFaucet a b = runConduit $ postDataFaucetC a b `fuseUpstream` emitKafkaTransactions

-----------------------------------------

-- I can defend this usage of a global variable:
-- see https://wiki.haskell.org/Top_level_mutable_state
appFaucetNonce :: IORef Integer -- The last maximum nonce given out
{-# NOINLINE appFaucetNonce #-}
appFaucetNonce = unsafePerformIO (newIORef 0)

---------------

postFaucetC ::
  (MonadIO m, MonadLogger m, Selectable Address Integer m) =>
  Address ->
  ConduitT a IngestEvent m [Keccak256]
postFaucetC target = do
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

postFaucetMultipartC ::
  (MonadIO m, MonadLogger m, Selectable Address Integer m) =>
  MultipartData Mem ->
  ConduitT a IngestEvent m [Keccak256]
postFaucetMultipartC multipartData = do
  case lookupInput "address" multipartData of
    Right a ->
      case toAddr a of
        Right address -> postFaucetC address
        Left e -> throwIO $ InvalidArgs e
    Left e -> throwIO $ MissingParameterError e

toAddr :: Text -> Either String Address
toAddr v =
  case readHex $ T.unpack v of
    [(wd160, "")] -> Right $ Address wd160
    _ -> Left $ "Can't convert text to Address: " ++ show v

postDataFaucetC ::
  (MonadIO m, Selectable Address Integer m) =>
  Maybe Int ->
  Maybe Int ->
  ConduitT a IngestEvent m [Keccak256]
postDataFaucetC mSize mCountOf = do
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
  select _ addr = fmap (fmap (addressStateRefNonce . E.entityVal) . listToMaybe) . sqlQuery $
    E.select $
      E.from $ \accStateRef -> do
        E.where_
          ( (accStateRef E.^. AddressStateRefChainId) E.==. E.val 0
              E.&&. accStateRef E.^. AddressStateRefAddress E.==. E.val addr
          )
        return accStateRef

lookupNonce :: Selectable Address Integer m => Address -> m Integer
lookupNonce addr' = fromMaybe 0 <$> select (Proxy @Integer) addr'

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => ConduitT IngestEvent Void m ()
emitKafkaTransactions = loop id
  where
    -- this is essentially the same as sinkList,
    -- except emitting to Kafka instead of returning the list
    loop front = await >>= maybe (emit $ front []) (\x -> loop $ front . (x :))
    emit txs = do
      $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ show (length txs) ++ " faucet tx(s) to unseqevents"
      void $ liftIO $ runKafkaMConfigured "strato-api" $ writeUnseqEvents txs

makeSendTX :: MonadIO m => Integer -> PrivateKey -> Address -> Integer -> m Transaction
makeSendTX maxN k a n = do
  -- We use a declining gas schedule to prevent ejecting faucets that
  -- might more urgently need a nonce. For example, if faucet(y) is
  -- given [n] and faucet(x) is given [n, n+1], x's faucet
  -- should only take nonce n if y's faucet fails. In turn, faucet(z)
  -- with [n, n+1, n+2] has highest priority for n+2, second priority for n+1,
  -- and will only take n if both faucet(x) and faucet(y) don't.
  let gasPrice = 50000000000 - 100000 * (maxN - n)
  liftIO $ createMessageTX n gasPrice 100000 a (1000 * ether) "" Nothing k

-- TODO(tim): Add a queryparam for contracts with variable length bin-runtimes, rather
-- than these that have empty bin-runtimes.
makeSizedTX :: MonadIO m => Integer -> Int -> PrivateKey -> m Transaction
makeSizedTX nonce size pk =
  let code = Code $ B.replicate size 0x0
      gasPrice = 50000000000
      gasLimit = 100000
      val = 0
      mk = createContractCreationTX nonce gasPrice gasLimit val code Nothing pk
   in liftIO mk
