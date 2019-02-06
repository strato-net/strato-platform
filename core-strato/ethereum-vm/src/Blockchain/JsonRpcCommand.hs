{-# LANGUAGE OverloadedStrings #-}

module Blockchain.JsonRpcCommand (
  runJsonRpcCommand
  ) where

import           Prelude                         hiding (id)
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Control.Monad.Logger
import           Data.Binary
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString.Lazy            as BL
import           Network.Kafka
import           Network.Kafka.Producer

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.DataDefs
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB hiding (getAddressState)
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.EthConf
import           Blockchain.ExtWord
import           Blockchain.KafkaTopics
import           Blockchain.Sequencer.Event

-- TODO: Add private chain functionality to JSON RPC commands

produceResponse::String->B.ByteString->IO ()
produceResponse id theData = do
    ret <-
      liftIO $ runKafkaConfigured "ethereum-vm" $
      produceMessages $
      [TopicAndMessage (lookupTopic "jsonrpcresponse") . makeMessage . BL.toStrict $ encode (id, theData)]
    case ret of
        Left e      -> error $ "Could not write txs to Kafka: " ++ show e
        Right _ -> return ()


runJsonRpcCommand :: ( MonadResource m
                     , MonadLogger (t m)
                     , WrapsSQLDB t m
                     , HasStateDB (t m)
                     , HasHashDB (t m)
                     , HasCodeDB (t m)
                     , HasStorageDB (t m)
                     , HasMemAddressStateDB (t m)) =>
                   JsonRpcCommand -> t m ()
runJsonRpcCommand c@JRCGetBalance{jrcAddress=address, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- runWithSQL getBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  addressState <- getAddressState address
  let response = show $ addressStateBalance addressState
  liftIO $ produceResponse id $ BC.pack response
  liftIO $ putStrLn response

runJsonRpcCommand c@JRCGetCode{jrcAddress=address, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- runWithSQL getBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  addressState <- getAddressState address
  maybeCode <- getCode $ addressStateCodeHash addressState
  case maybeCode of
   Just code -> liftIO $ produceResponse id code
   Nothing   -> liftIO $ produceResponse id ""

runJsonRpcCommand c@JRCGetTransactionCount{jrcAddress=address, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- runWithSQL getBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  addressState <- getAddressState address
  let response = show $ addressStateNonce addressState
  liftIO $ produceResponse id $ BC.pack response
  liftIO $ putStrLn response

runJsonRpcCommand c@JRCGetStorageAt{jrcAddress=address, jrcKey=key, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- runWithSQL getBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  value <- getStorageKeyVal' address $ bytesToWord256 $ key
  liftIO $ produceResponse id $ word256ToBytes value
  liftIO $ putStrLn $ show value
runJsonRpcCommand (JRCCall _ _ _) = error "unsupported RPC command call"
