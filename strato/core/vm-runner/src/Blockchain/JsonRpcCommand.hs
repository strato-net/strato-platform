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
--import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Address
import Control.Monad ((<=<), void)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Kafka
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as T
import Prelude hiding (id)

-- TODO: Add private chain functionality to JSON RPC commands

produceResponse :: HasKafka m => String -> B.ByteString -> m ()
produceResponse id theData = void $ produceItems "jsonrpcresponse" [(id, theData)]

runJsonRpcCommand ::
  ( MonadLogger m,
    HasKafka m,
    HasCodeDB m,
    (Address `A.Alters` AddressState) m
  ) =>
  JsonRpcCommand ->
  m ()
runJsonRpcCommand =
  uncurry produceResponse
    <=< runJsonRpcCommand'

runJsonRpcCommand' ::
  ( MonadLogger m,
    HasCodeDB m,
    (Address `A.Alters` AddressState) m
  ) =>
  JsonRpcCommand ->
  m (String, B.ByteString)
runJsonRpcCommand' c@JRCGetBalance {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand.JRCGetBalance" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateBalance
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" $ T.pack response
  return (id, BC.pack response)
runJsonRpcCommand' c@JRCGetCode {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetCode" . T.pack $ "running command: " ++ show c
  codeHash <-
    addressStateCodeHash
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  code <- getExternallyOwned $
    case codeHash of
      ExternallyOwned ch -> ch
      _ -> error "runJsonRpcCommand currently only supported for the EVM"
  return (id, code)
runJsonRpcCommand' c@JRCGetTransactionCount {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateNonce
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" $ T.pack response
  return (id, BC.pack response)
{-
runJsonRpcCommand' c@JRCGetStorageAt {jrcAddress = address, jrcKey = key, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetStorageAt" . T.pack $ "running command: " ++ show c
  value <- getStorageKeyVal' address $ bytesToWord256 $ key
  $logInfoS "runJsonRpcCommand'.JRCGetStorageAt" . T.pack $ show value
  return (id, word256ToBytes value)
-}
runJsonRpcCommand' JRCGetStorageAt {} = error "unsupported RPC command call"
runJsonRpcCommand' (JRCCall _ _ _) = error "unsupported RPC command call"
