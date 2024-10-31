{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.JsonRpcCommand
  ( produceResponse,
    runJsonRpcCommand,
    runJsonRpcCommand',
  )
where

import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.EthConf
import Blockchain.KafkaTopics
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ExtendedWord
import Control.Monad ((<=<))
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as T
import Prelude hiding (id)

-- TODO: Add private chain functionality to JSON RPC commands

produceResponse :: String -> B.ByteString -> IO ()
produceResponse id theData = do
  _ <- runKafkaMConfigured "ethereum-vm" $
       produceItems (lookupTopic "jsonrpcresponse") [(id, theData)]

  return ()

runJsonRpcCommand ::
  ( MonadIO m,
    MonadLogger m,
    HasCodeDB m,
    HasStorageDB m,
    (Account `A.Alters` AddressState) m
  ) =>
  JsonRpcCommand ->
  m ()
runJsonRpcCommand =
  liftIO . uncurry produceResponse
    <=< runJsonRpcCommand'

runJsonRpcCommand' ::
  ( MonadLogger m,
    HasCodeDB m,
    HasStorageDB m,
    (Account `A.Alters` AddressState) m
  ) =>
  JsonRpcCommand ->
  m (String, B.ByteString)
runJsonRpcCommand' c@JRCGetBalance {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand.JRCGetBalance" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateBalance
      <$> A.lookupWithDefault (A.Proxy @AddressState) (Account address Nothing)
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" $ T.pack response
  return (id, BC.pack response)
runJsonRpcCommand' c@JRCGetCode {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetCode" . T.pack $ "running command: " ++ show c
  codeHash <-
    addressStateCodeHash
      <$> A.lookupWithDefault (A.Proxy @AddressState) (Account address Nothing)
  code <- getExternallyOwned $
    case codeHash of
      ExternallyOwned ch -> ch
      _ -> error "runJsonRpcCommand currently only supported for the EVM"
  return (id, code)
runJsonRpcCommand' c@JRCGetTransactionCount {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateNonce
      <$> A.lookupWithDefault (A.Proxy @AddressState) (Account address Nothing)
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" $ T.pack response
  return (id, BC.pack response)
runJsonRpcCommand' c@JRCGetStorageAt {jrcAddress = address, jrcKey = key, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetStorageAt" . T.pack $ "running command: " ++ show c
  value <- getStorageKeyVal' (Account address Nothing) $ bytesToWord256 $ key
  $logInfoS "runJsonRpcCommand'.JRCGetStorageAt" . T.pack $ show value
  return (id, word256ToBytes value)
runJsonRpcCommand' (JRCCall _ _ _) = error "unsupported RPC command call"
