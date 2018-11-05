{-# LANGUAGE OverloadedStrings #-}

module Handler.Faucet where

import qualified Data.Binary                    as BN
import qualified Data.Text                      as T
import qualified Database.Esqueleto             as E
import qualified Network.Haskoin.Crypto         as H
import qualified Prelude                        as P
import Text.Printf

import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf             (runKafkaConfigured)
import           Blockchain.Sequencer.Event     (IngestEvent (IETx), IngestTx (..))
import           Blockchain.Sequencer.Kafka     (writeUnseqEvents)
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Format
import           Blockchain.Util                (getCurrentMicrotime)
import           Data.List                      (nub)
import           Handler.Common
import           Handler.Filters
import           Import

import qualified Data.ByteString.Lazy as BL

retrievePrvKey :: FilePath -> IO (Maybe H.PrvKey)
retrievePrvKey path = do
  keyBytes <- readFile path
  let intVal = BN.decode $ BL.fromStrict $ keyBytes :: Integer
  return $ H.makePrvKey intVal


lookupNonce :: (YesodPersist site, YesodPersistBackend site ~ SqlBackend) => Address -> HandlerT site IO Integer
lookupNonce addr' = do
  addrSt <- runDB $ E.select $
                      E.from $ \(accStateRef) -> do
                      E.where_ ((E.isNothing $ accStateRef E.^. AddressStateRefChainId) E.&&. accStateRef E.^. AddressStateRefAddress E.==. (E.val addr'))
                      return accStateRef
  case addrSt of
    []      -> return 0
    addrSt' -> return $ addressStateRefNonce $ E.entityVal $ P.head $ addrSt'

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [Transaction] -> m ()
emitKafkaTransactions txs = do
    ts <- liftIO $ getCurrentMicrotime
    let ingestTxs = (\t -> IETx ts (IngestTx API t)) <$> txs
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ (show $ length ingestTxs) ++ " faucet tx(s) to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestTxs
    case rets of
        Left e      -> $logError $ "Could not write txs to Kafka: " Import.++ (T.pack $ show e)
        Right resps -> $logDebug $ "writeUnseqEventsEnd Kafka commit: " Import.++ (T.pack $ show resps)
    return ()

postFaucetR :: Handler Value
postFaucetR = do
  addHeader "Access-Control-Allow-Origin" "*"

  key <- liftIO $ retrievePrvKey $ "config" </> "priv"
  key' <- maybe (invalidArgs ["No faucet account is defined"]) return key
  liftIO $ putStrLn $ T.pack $ show key'

  minNonce <- lookupNonce $ prvKey2Address key'

  mAddr <- lookupPostParam "address"
  toJSON <$> case fmap toAddr mAddr of
    Just target -> do
      maxNonce <- acquireNewMaxNonce minNonce
      $logInfoS "postFaucetR" . T.pack $ printf "%s: [min..max]=[%d,%d]" (format target) minNonce maxNonce
      mapM (putTX maxNonce key' target) $ nub [maxNonce, minNonce]
    Nothing -> do
      maybeAddrs <- lookupPostParam "addresses"
      liftIO $ putStrLn $ T.pack $ show maybeAddrs
      case maybeAddrs of
        Just addrTLT -> do
          let addrTL = P.read $ T.unpack $ addrTLT
          -- TODO(tim): Find a multiple nonce strategy for multiple addresses
          sequence . zipWith (putTX minNonce key') addrTL $ map (minNonce +) [0..]
        Nothing -> invalidArgs ["Missing 'address' or 'addresses'"]
  where
    makeTX maxN k a n = do
      -- We use a declining gas schedule to prevent ejecting faucets that
      -- might more urgently need a nonce. For example, if faucet(y) is
      -- given [n] and faucet(x) is given [n, n+1], x's faucet
      -- should only take nonce n if y's faucet fails. In turn, faucet(z)
      -- with [n, n+1, n+2] has highest priority for n+2, second priority for n+1,
      -- and will only take n if both faucet(x) and faucet(y) don't.
      let gasPrice = 50000000000 - 100000 * (maxN - n)
      liftIO $ putStrLn $ T.pack $ "nonce: " ++ (show n)
      tx <- liftIO . H.withSource H.devURandom $
        createMessageTX n gasPrice 100000 a (1000*ether) "" Nothing k
      liftIO $ putStrLn $ T.pack $ "tx for faucet: " ++ (show tx)
      return tx
    putTX maxN k a n = do
      tx <- makeTX maxN k a n
      emitKafkaTransactions [tx]
      return $ txHash tx
