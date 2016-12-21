{-# LANGUAGE OverloadedStrings #-}

module Blockchain.JsonRpcCommand (
  runJsonRpcCommand
  ) where

import Control.Monad.IO.Class
import Control.Monad.Logger
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import qualified Data.Text as T
import Network.Kafka          
import Network.Kafka.Protocol 
import Network.Kafka.Producer 

import Blockchain.Data.Address
import Blockchain.Data.AddressStateDB
import Blockchain.Data.DataDefs
import Blockchain.DB.AddressStateDB
import Blockchain.DB.CodeDB
import Blockchain.DB.DetailsDB
import Blockchain.DB.HashDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB
import Blockchain.EthConf
import Blockchain.KafkaTopics
import Blockchain.Sequencer.Event

produceResponse::String->B.ByteString->IO ()
produceResponse id theData = do
    ret <-
      liftIO $ runKafkaConfigured "ethereum-vm" $
      produceMessages $
      [TopicAndMessage (lookupTopic "jsonrpcresponse") . makeMessage . BL.toStrict $ encode (id, theData)]
    case ret of
        Left e      -> error $ "Could not write txs to Kafka: " ++ show e
        Right resps -> return ()


runJsonRpcCommand::(MonadLogger m, HasStateDB m, HasHashDB m, HasSQLDB m, HasCodeDB m)=>
                   JsonRpcCommand->m ()
runJsonRpcCommand c@JRCGetBalance{jrcAddress=address, jrcBlockString=blockString, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- getBestBlock
  setStateDBStateRoot $ blockDataStateRoot $ blockBlockData bestBlock
  addressState <- getAddressState address
  let response = show $ addressStateBalance addressState
  liftIO $ produceResponse id $ BC.pack response
  liftIO $ putStrLn response

runJsonRpcCommand c@JRCGetCode{jrcAddress=address, jrcBlockString=blockString, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- getBestBlock
  setStateDBStateRoot $ blockDataStateRoot $ blockBlockData bestBlock
  addressState <- getAddressState address
  maybeCode <- getCode $ addressStateCodeHash addressState
  case maybeCode of
   Just code -> liftIO $ produceResponse id code
   Nothing -> liftIO $ produceResponse id ""

runJsonRpcCommand c@JRCGetTransactionCount{jrcAddress=address, jrcBlockString=blockString, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- getBestBlock
  setStateDBStateRoot $ blockDataStateRoot $ blockBlockData bestBlock
  addressState <- getAddressState address
  let response = show $ addressStateNonce addressState
  liftIO $ produceResponse id $ BC.pack response
  liftIO $ putStrLn response

{-
runJsonRpcCommand c@JRCGetStorageAt{jrcAddress=address, jrcBlockString=blockString, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- getBestBlock
  setStateDBStateRoot $ blockDataStateRoot $ blockBlockData bestBlock
  addressState <- getAddressState address
  let response = show $ addressStateNonce addressState
  liftIO $ produceResponse id $ BC.pack response
  liftIO $ putStrLn response
-}
