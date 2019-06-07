{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.JsonRpcCommand (
  runJsonRpcCommand
  ) where

import           Prelude                         hiding (id)
import           Control.Monad                   ((<=<))
import qualified Control.Monad.Change.Alter      as A
import           Control.Monad.IO.Class
import           Data.Binary
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString.Lazy            as BL
import qualified Data.Text                       as T
import           Network.Kafka
import           Network.Kafka.Producer

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.DataDefs
import           Blockchain.DB.CodeDB
import           Blockchain.DB.DetailsDB
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
                     , HasCodeDB (t m)
                     , HasStorageDB (t m)
                     , (Address `A.Alters` AddressState) (t m)
                     , MonadIO (t m)
                     )
                  => JsonRpcCommand -> t m ()
runJsonRpcCommand = liftIO . uncurry produceResponse
                <=< runJsonRpcCommand' (runWithSQL getBestBlock)

runJsonRpcCommand' :: ( MonadLogger m
                      , HasStateDB m
                      , HasCodeDB m
                      , HasStorageDB m
                      , (Address `A.Alters` AddressState) m
                      )
                   => m BlockDataRef
                   -> JsonRpcCommand
                   -> m (String, B.ByteString)
runJsonRpcCommand' mBestBlock c@JRCGetBalance{jrcAddress=address, jrcId=id} = do
  $logInfoS "runJsonRpcCommand.JRCGetBalance" . T.pack $ "running command: " ++ show c
  bestBlock <- mBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  response <- show . addressStateBalance <$>
    A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" $ T.pack response
  return (id, BC.pack response)

runJsonRpcCommand' mBestBlock c@JRCGetCode{jrcAddress=address, jrcId=id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetCode" . T.pack $ "running command: " ++ show c
  bestBlock <- mBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  codeHash <- addressStateCodeHash <$>
    A.lookupWithDefault (A.Proxy @AddressState) address
  code <- getEVMCode $
               case codeHash of
                 EVMCode ch -> ch
                 _ -> error "runJsonRpcCommand currently only supported for the EVM"
  return (id, code)

runJsonRpcCommand' mBestBlock c@JRCGetTransactionCount{jrcAddress=address, jrcId=id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" . T.pack $ "running command: " ++ show c
  bestBlock <- mBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  response <- show . addressStateNonce <$>
    A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" $ T.pack response
  return (id, BC.pack response)

runJsonRpcCommand' mBestBlock c@JRCGetStorageAt{jrcAddress=address, jrcKey=key, jrcId=id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetStorageAt" . T.pack $ "running command: " ++ show c
  bestBlock <- mBestBlock
  setStateDBStateRoot $ blockDataRefStateRoot bestBlock
  value <- getStorageKeyVal' address $ bytesToWord256 $ key
  $logInfoS "runJsonRpcCommand'.JRCGetStorageAt" . T.pack $ show value
  return (id, word256ToBytes value)
runJsonRpcCommand' _ (JRCCall _ _ _) = error "unsupported RPC command call"
