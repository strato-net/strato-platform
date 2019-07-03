{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE LambdaCase #-}

module Handler.Faucet where

import qualified Control.Monad                  as CM
import qualified Data.ByteString                as BS
import qualified Data.Text                      as T
import qualified Database.Esqueleto             as E
import qualified Network.Haskoin.Crypto         as H
import qualified Prelude                        as P
import           Text.Printf

import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Sequencer.Event     (IngestEvent (IETx), IngestTx (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Util                (getCurrentMicrotime)
import           Handler.Common
import           Handler.Filters
import           Import

import           Text.Format

zoomForApp :: ReaderT App IO a -> HandlerFor App a
zoomForApp f = do
  app <- getYesod
  liftIO $ runReaderT f app

getFaucetKey :: HandlerFor App H.PrvKey
getFaucetKey = getKey >>= \case
  Just k -> return k
  Nothing -> invalidArgs ["No faucet account is defined"]

lookupNonce :: Address -> HandlerFor App Integer
lookupNonce addr' = do
  addrSt <- runDB $ E.select $
                      E.from $ \accStateRef -> do
                      E.where_ ((accStateRef E.^. AddressStateRefChainId) E.==. E.val 0
                         E.&&. accStateRef E.^. AddressStateRefAddress E.==. E.val addr')
                      return accStateRef
  return $ case addrSt of
    []      -> 0
    n:_ -> addressStateRefNonce $ E.entityVal n

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [Transaction] -> m ()
emitKafkaTransactions txs = do
    ts <- liftIO getCurrentMicrotime
    let ingestTxs = (IETx ts . IngestTx API)  <$> txs
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ show (length ingestTxs) ++ " faucet tx(s) to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestTxs
    case rets of
        Left e      -> $logError $ "Could not write txs to Kafka: " Import.++ T.pack (show e)
        Right resps -> $logDebug $ "writeUnseqEventsEnd Kafka commit: " Import.++ T.pack (show resps)
    return ()

emitTransaction :: (MonadIO m, MonadLogger m) => Transaction -> m SHA
emitTransaction tx = do
  emitKafkaTransactions [tx]
  return $ txHash tx

postFaucetR :: HandlerFor App Value
postFaucetR = do
  addHeader "Access-Control-Allow-Origin" "*"

  key <- getFaucetKey
  minNonce <- lookupNonce $ prvKey2Address key

  mAddr <- lookupPostParam "address"
  toJSON <$> case fmap toAddr mAddr of
    Just target -> do
      maxNonce <- zoomForApp $ acquireNewMaxNonce minNonce
      $logInfoS "postFaucetR" . T.pack $ printf "%s: [min..max]=[%d,%d]" (format target) minNonce maxNonce
      mapM (putTX maxNonce key target) [maxNonce, minNonce]
    Nothing -> do
      maybeAddrs <- lookupPostParam "addresses"
      liftIO $ putStrLn $ T.pack $ show maybeAddrs
      case maybeAddrs of
        Just addrTLT -> do
          let addrTL = P.read $ T.unpack addrTLT
          -- TODO(tim): Find a multiple nonce strategy for multiple addresses
          sequence . zipWith (putTX minNonce key) addrTL $ map (minNonce +) [0..]
        Nothing -> invalidArgs ["Missing 'address' or 'addresses'"]
    where
      putTX maxN k a = emitTransaction <=< makeSendTX maxN k a

readInt :: Int -> Maybe Text -> Int
readInt defaultVal = fromMaybe defaultVal . fmap (P.read . T.unpack)

postDataFaucetR :: Handler Value
postDataFaucetR = do
  addHeader "Access-Control-Allow-Origin" "*"
  key <- getFaucetKey
  minNonce <- lookupNonce $ prvKey2Address key
  size <- readInt 4096 <$> lookupPostParam "size"
  countOf <- readInt 1 <$> lookupPostParam "count" :: Handler Int
  fmap toJSON . CM.replicateM countOf $ do
    maxN <- zoomForApp $ acquireNewMaxNonce minNonce
    tx <- makeSizedTX maxN size key
    emitTransaction tx

makeSendTX :: MonadIO m => Integer -> H.PrvKey -> Address -> Integer -> m Transaction
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
makeSizedTX :: MonadIO m => Integer -> Int -> H.PrvKey -> m Transaction
makeSizedTX nonce size pk =
  let code = Code $ BS.replicate size 0x0
      gasPrice = 50000000000
      gasLimit = 100000
      val = 0
      mk = createContractCreationTX nonce gasPrice gasLimit val code Nothing pk
  in liftIO . H.withSource H.devURandom $ mk
