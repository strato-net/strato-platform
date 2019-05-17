{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.JsonRpcCommand (
  runJsonRpcCommand
  ) where

import           Prelude                         hiding (id)
import qualified Control.Monad.Change.Alter      as A
import           Control.Monad.IO.Class
import           Data.Binary
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString.Lazy            as BL
import           Network.Kafka
import           Network.Kafka.Producer

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.DataDefs
import           Blockchain.DB.CodeDB
import           Blockchain.DB.DetailsDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.EthConf
import           Blockchain.ExtWord
import           Blockchain.KafkaTopics
import           Blockchain.Output
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Address (Address(..))

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


runJsonRpcCommand :: ( MonadLogger (t m)
                     , WrapsSQLDB t m
                     , HasStateDB (t m)
                     , HasHashDB (t m)
                     , HasCodeDB (t m)
                     , HasStorageDB (t m)
                     , HasMemAddressStateDB (t m)
                     , (Address `A.Alters` AddressState) (t m)
                     )
                  => JsonRpcCommand -> t m ()
runJsonRpcCommand c@JRCGetBalance{jrcAddress=address, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- runWithSQL getBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  response <- show . addressStateBalance <$>
    A.lookupWithDefault (A.Proxy @AddressState) address
  liftIO $ produceResponse id $ BC.pack response
  liftIO $ putStrLn response

runJsonRpcCommand c@JRCGetCode{jrcAddress=address, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- runWithSQL getBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  codeHash <- addressStateCodeHash <$>
    A.lookupWithDefault (A.Proxy @AddressState) address
  code <- getEVMCode $
               case codeHash of
                 EVMCode ch -> ch
                 _ -> error "runJsonRpcCommand currently only supported for the EVM"
  liftIO $ produceResponse id code

runJsonRpcCommand c@JRCGetTransactionCount{jrcAddress=address, jrcId=id} = do
  liftIO $ putStrLn $ "running command: " ++ show c
  bestBlock <- runWithSQL getBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  response <- show . addressStateNonce <$>
    A.lookupWithDefault (A.Proxy @AddressState) address
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
