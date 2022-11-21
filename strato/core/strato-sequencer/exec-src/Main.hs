{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE DuplicateRecordFields #-}
module Main where

import           Control.Monad
import           Control.Concurrent                   (threadDelay)
import           Control.Concurrent.Async             as Async
import           Control.Concurrent.STM
import           Control.Concurrent.STM.TMChan
import qualified Data.Aeson                 as Ae
import qualified Data.ByteString.Char8      as C8
-- import qualified Data.Text                  as T
import           Data.Either.Extra
import           HFlags
import           Safe

import           BlockApps.Init
import           BlockApps.Logging
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Strato.Model.Address
import qualified Blockchain.EthConf         as EC
import qualified Blockchain.Network         as Net
import           Blockchain.Sequencer
import           Blockchain.Sequencer.Gregor
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.CablePackage
import qualified Network.Kafka.Protocol     as KP
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus
import           Network.HTTP.Client        (newManager, defaultManagerSettings)
import           Servant.Client
import qualified Strato.VaultProxy.API.Types  as VP
import qualified Strato.VaultProxy.Client     as VP

import           Flags



waitOnVault :: (Show a) => IO (Either a b) -> IO b
waitOnVault action = do
  putStrLn "asking vault-proxy for the node address"
  res <- action
  case res of
    Left err -> do 
      putStrLn $ "failed to get node address from vault-proxy... got this error: " ++ show err
      threadDelay 2000000 -- 2 seconds
      waitOnVault action
    Right val -> return val


main :: IO ()
main = do
  blockappsInit "seq_main"
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"
  exportFlagsAsMetrics
  putStrLn $ "strato-sequencer ignoring unknown flags: " ++ show s
  putStrLn $ "strato-sequencer network: " ++ show flags_network
  putStrLn $ "strato-sequencer validators: " ++ show flags_validators
  putStrLn $ "strato-sequencer authorized beneficiary senders: " ++ show flags_blockstanbul_admins
  putStrLn $ "strato-sequencer isAdmin: " ++ show flags_isAdmin
  putStrLn $ "strato-sequencer isRootNode: " ++ show flags_isRootNode
  putStrLn $ "strato-sequencer vault-proxy URL: " ++ show flags_vaultProxyUrl
  putStrLn $ "strato-sequencer validatorBehavior: " ++ show flags_validatorBehavior
  
  pkg <- atomically newCablePackage
  let kafkaClientId' = KP.KString $ C8.pack flags_kafkaclientid
      mKafkaAddress = case span (/=':') flags_kafkaaddress of
                          (_, "") -> Nothing
                          (khost, kport) -> Just ( KP.Host (KP.KString (C8.pack khost))
                                                 , KP.Port (readDef 9092 (drop 1 kport)))
      gregorCfg = GregorConfig
        { kafkaAddress = mKafkaAddress
        , kafkaClientId = kafkaClientId'
        , kafkaConsumerGroup = EC.lookupConsumerGroup kafkaClientId'
        , cablePackage = pkg
        }
  
  -- setup the connection with vault-proxy
  mgr <- newManager defaultManagerSettings
  vaultProxyUrl <- parseBaseUrl flags_vaultProxyUrl
  let clientEnv = mkClientEnv mgr vaultProxyUrl
  
  selfAddress <- do
    nk <- runClientM (VP.getCurrentUser) clientEnv
    nodeKey <- case nk of
      Left err -> error $ "Failed to get the curren't node's name from the vault-proxy: " <> show err
      Right nk' -> return nk'
    addrAndKey <- waitOnVault $ runClientM (VP.getKey nodeKey Nothing) clientEnv
    return $ VP.unAddress addrAndKey
  
  putStrLn . ("NODEKEY address: " ++) . formatAddressWithoutColor $ selfAddress
  addSelfAsMetric selfAddress

  maybeNetworkParams <- Net.getParams flags_network
  let eValidators = Ae.eitherDecodeStrict (C8.pack flags_validators) :: Either String [Address]
      !validators' =
        case (maybeNetworkParams, eValidators) of
          (Just networkParams, Right []) -> map Net.ethAddress networkParams
          (_, Right v) -> v
          (_, Left e) -> error $ "invalid validators: " ++ e
      eAuthSenders = Ae.eitherDecodeStrict (C8.pack flags_blockstanbul_admins) :: Either String [Address]
      !authSenders' = fromRight (error "invalid admins") eAuthSenders
 

  mCtx <- if not flags_blockstanbul
             then return Nothing
             else do
               validators <- 
                 if flags_isRootNode then do
                   unless (length validators' == 0) . putStrLn
                      $ "WARNING: You have given me a validators list and you are telling me that this node \
                        \ is the root node. I'll ignore the validator list \
                        \ you gave me, but this is likely a configuration error on your part."
                   return [selfAddress]
                 else do
                   when (length validators' == 0) . putStrLn
                      $ "WARNING: You have given me an empty validators list, but this node is not the root \
                        \ node. This is a configuration error on your part. \
                        \ PBFT will almost certainly not function properly."
                   return validators'
                
               authSenders <-
                 if flags_isAdmin || flags_isRootNode then 
                   return $ selfAddress : authSenders'
                 else do 
                   when (length authSenders' == 0) . putStrLn
                       $ "WARNING: You haven't given me any blockstanbulAdmins. If you are starting \
                       \ a single node, this is OK. But, if you are starting a network or adding a \
                       \ validator node to a network, be warned - this node will not accept any votes \
                       \ to add or remove validators, as it has no authorized senders."
                   return authSenders'

               unless (selfAddress `elem` validators) . putStrLn
                    $ "WARNING: NODEKEY does not correspond to an address within the validators.\
                      \ This probably means that you are connecting to an existing network,\
                      \ and you are not one of the original validators of that network.\
                      \ If this is the case, please disregard this message. Otherwise,\
                      \ you may experience difficulty operating this node."
               unless (flags_blockstanbul_block_period_ms >= 0) . ioError . userError
                    $ "--blockstanbul_block_period_ms must be nonnegative"
               unless (flags_blockstanbul_round_period_s > 0) . ioError . userError
                    $ "--blockstanbul_round_period_s must be positive"
     
               putStrLn $ "ACTUAL validators list: " ++ show validators
               putStrLn $ "ACTUAL admins list: " ++ show authSenders
               
               ckpt <- runGregorM gregorCfg $ initializeCheckpoint validators authSenders
               putStrLn $ "Checkpoint: " ++ show ckpt
 
               return $ Just $ newContext ckpt selfAddress
  
 
  chr <- atomically newTQueue
  chv <- atomically newTQueue
  cht <- atomically newTMChan

  let seqCfg = SequencerConfig
        { depBlockDBCacheSize   = flags_depblockcachesize
        , depBlockDBPath        = flags_depblockdbpath
        , seenTransactionDBSize = flags_txdedupwindow
        , syncWrites            = flags_syncwrites
        , blockstanbulBlockPeriod = BlockPeriod $ fromIntegral flags_blockstanbul_block_period_ms / 1000.0
        , blockstanbulRoundPeriod = RoundPeriod $ fromIntegral flags_blockstanbul_round_period_s
        , blockstanbulBeneficiary = chv
        , blockstanbulVoteResps = chr
        , blockstanbulTimeouts = cht
        , cablePackage = pkg
        , maxEventsPerIter = flags_seq_max_events_per_iter
        , maxUsPerIter = flags_seq_max_us_per_iter
        , vaultClient = Just clientEnv
        }
  race_ (runTheGregor gregorCfg)
      . race_ (runLoggingT (runSequencerM seqCfg mCtx sequencer ))
      . run flags_blockstanbul_port
      . prometheus def{ prometheusInstrumentApp = False }
      . instrumentApp "blockstanbul-admin"
      $ createWebServer chv chr
