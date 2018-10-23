{-# LANGUAGE OverloadedStrings #-}

module Handler.Faucet where

import qualified Data.Binary                    as BN
import qualified Data.Text                      as T
import qualified Database.Esqueleto             as E
import qualified Network.Haskoin.Crypto         as H
import qualified Prelude                        as P

import           Blockchain.Constants
import           Blockchain.Data.Address
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

import qualified Data.ByteString.Lazy as BL

retrievePrvKey :: FilePath -> IO (Maybe H.PrvKey)
retrievePrvKey path = do
  keyBytes <- readFile path
  let intVal = BN.decode $ BL.fromStrict $ keyBytes :: Integer
  return $ H.makePrvKey intVal

whereMatchingAddr :: E.Esqueleto query E.SqlExpr SqlBackend
                  => E.SqlExpr (Entity AddressStateRef) -> Address -> query ()
whereMatchingAddr accStateRef addr =
  E.where_ ((E.isNothing $ accStateRef E.^. AddressStateRefChainId)
      E.&&. accStateRef E.^. AddressStateRefAddress E.==. (E.val addr))

lookupNonce :: (YesodPersist site, YesodPersistBackend site ~ SqlBackend)
            => Address -> HandlerT site IO (Integer, Integer)
lookupNonce addr' = do
  addrSt <- runDB $ E.select $
                      E.from $ \(accStateRef) -> do
                      whereMatchingAddr accStateRef addr'
                      return accStateRef
  return $ case addrSt of
    []      -> (0, 1)
    ev:_ -> let ref = E.entityVal ev
                lowNonce = addressStateRefNonce ref
                highNonce = fromMaybe lowNonce $ addressStateRefAttemptedNonce ref
            in (lowNonce, highNonce + 1)

setAttemptedNonce :: (YesodPersist site, YesodPersistBackend site ~ SqlBackend)
                  => Address -> Integer -> HandlerT site IO ()
setAttemptedNonce addr an = runDB $
  E.update $ \accStateRef -> do
    E.set accStateRef [ AddressStateRefAttemptedNonce E.=. E.just (E.val an) ]
    whereMatchingAddr accStateRef addr

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

postFaucetR :: Handler Text
postFaucetR = do
  addHeader "Access-Control-Allow-Origin" "*"

  key <- liftIO $ retrievePrvKey $ "config" </> "priv"
  key' <- maybe (invalidArgs ["No faucet account is defined"]) return key
  liftIO $ putStrLn $ T.pack $ show key'
  let addr = prvKey2Address key'
  (minNonce, maxNonce) <- lookupNonce addr

  maybeVal <- lookupPostParam "address"
  liftIO $ putStrLn $ T.pack $ show maybeVal
  case maybeVal of
    Just val -> do
      setAttemptedNonce addr maxNonce
      (T.pack . show) <$> mapM (putTX key' val) [minNonce..maxNonce]
    Nothing -> do
      -- TODO(tim): Determine a multinonce scheme for multiple addresses
      maybeAddrs <- lookupPostParam "addresses"
      liftIO $ putStrLn $ T.pack $ show maybeAddrs
      case maybeAddrs of
        Just addrTLT -> do
          let addrTL = P.read $ T.unpack $ addrTLT
          faucets <- sequence $ zipWith (putTX key') addrTL $ map (minNonce +) [0..]
          return $ T.pack $ show $ map T.unpack faucets
        Nothing -> invalidArgs ["Missing 'address' or 'addresses'"]
  where
    makeTX k a n = do
      liftIO $ putStrLn $ T.pack $ "nonce: " ++ (show n)
      tx <- liftIO $ H.withSource H.devURandom (createMessageTX n (50000000000) (100000) a (1000*ether) "" Nothing k)
      liftIO $ putStrLn $ T.pack $ "tx for faucet: " ++ (show tx)
      return tx
    putTX k v n = do
      tx <- makeTX k (toAddr v) n
      _ <- insertTXIfNew API Nothing [tx]
      emitKafkaTransactions [tx]

      return . T.pack . shaToHex . txHash $ tx


