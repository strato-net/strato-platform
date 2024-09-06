{-# LANGUAGE OverloadedStrings #-}

module Commands
  ( methods,
  )
where

import qualified APIProxy as API
import Binary
import Blockchain.Constants
import Blockchain.Data.Transaction
import Blockchain.EthConf
import Blockchain.KafkaTopics
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Blockchain.Stream.Raw
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Control.Monad.Except
import qualified Data.Aeson as JSON
import qualified Data.Aeson.KeyMap as KM
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.Map as M
import qualified Data.Text as T
import qualified Data.Vector as V
import Network.JsonRpc.Server
import Network.Kafka
import System.Random
import Prelude hiding (id)

type Server = IO

methods :: [Method Server]
methods =
  [ rpc_modules,
    web3_clientVersion,
    web3_sha3,
    net_version,
    net_peerCount,
    net_listening,
    eth_protocolVersion,
    eth_syncing,
    eth_coinbase,
    eth_mining,
    eth_hashrate,
    eth_gasPrice,
    eth_accounts,
    eth_blockNumber,
    eth_getBalance,
    eth_getStorageAt,
    eth_getTransactionCount,
    eth_getBlockTransactionCountByHash,
    eth_getBlockTransactionCountByNumber,
    eth_getUncleCountByBlockHash,
    eth_getUncleCountByBlockNumber,
    eth_getCode,
    eth_sign,
    eth_sendTransaction,
    eth_sendRawTransaction,
    eth_call,
    eth_estimateGas,
    eth_getBlockByHash,
    eth_getBlockByNumber,
    eth_getTransactionByHash,
    eth_getTransactionByBlockHashAndIndex,
    eth_getTransactionByBlockNumberAndIndex,
    eth_getTransactionReceipt,
    eth_getUncleByBlockHashAndIndex,
    eth_getUncleByBlockNumberAndIndex,
    eth_getCompilers,
    eth_compileLLL,
    eth_compileSolidity,
    eth_compileSerpent,
    eth_newFilter,
    eth_newBlockFilter,
    eth_newPendingTransactionFilter,
    eth_uninstallFilter,
    eth_getFilterChanges,
    eth_getFilterLogs,
    eth_getLogs,
    eth_getWork,
    eth_submitWork,
    eth_submitHashrate,
    db_putString,
    db_getString,
    db_putHex,
    db_getHex,
    shh_post,
    shh_version,
    shh_newIdentity,
    shh_hasIdentity,
    shh_newGroup,
    shh_addToGroup,
    shh_newFilter,
    shh_uninstallFilter,
    shh_getFilterChanges,
    shh_getMessages
  ]

rpc_modules :: Method Server
rpc_modules = flip (toMethod "rpc_modules") () $ do
  liftIO $
    return $
      M.fromList
        [ ("admin" :: String, "1.0" :: String),
          ("debug", "1.0"),
          ("eth", "1.0"),
          ("miner", "1.0"),
          ("net", "1.0"),
          ("personal", "1.0"),
          ("rpc", "1.0"),
          ("txpool", "1.0"),
          ("web3", "1.0")
        ]

web3_clientVersion :: Method Server
web3_clientVersion = flip (toMethod "web3_clientVersion") () $ do
  liftIO $ return stratoVersionString

net_version :: Method Server
net_version = flip (toMethod "net_version") () $ do
  liftIO $ return $ show ethVersion

web3_sha3 :: Method Server
web3_sha3 = toMethod "web3_sha3" f (Required "value" :+: ())
  where
    f :: String -> RpcResult Server String
    f val = do
      case strToByteString val of
        Left err -> throwError $ rpcError (-32602) $ T.pack err
        Right bytes ->
          return $ "0x" ++ BC.unpack (B16.encode $ keccak256ToByteString $ hash bytes)

net_peerCount :: Method Server
net_peerCount = toMethod "net_peerCount" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

net_listening :: Method Server
net_listening = toMethod "net_listening" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_protocolVersion :: Method Server
eth_protocolVersion = toMethod "eth_protocolVersion" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_syncing :: Method Server
eth_syncing = toMethod "eth_syncing" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_coinbase :: Method Server
eth_coinbase = toMethod "eth_coinbase" f ()
  where
    f :: RpcResult Server String
    f = do
      return $ coinbaseAddress $ quarryConfig ethConf

eth_mining :: Method Server
eth_mining = toMethod "eth_mining" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_hashrate :: Method Server
eth_hashrate = toMethod "eth_hashrate" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_gasPrice :: Method Server
eth_gasPrice = toMethod "eth_gasPrice" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_accounts :: Method Server
eth_accounts = toMethod "eth_accounts" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

----------------

getBlockNumber :: JSON.Value -> Maybe Integer
getBlockNumber (JSON.Array val) =
  case V.toList val of
    [JSON.Object o] ->
      case KM.lookup "blockData" o of
        Just (JSON.Object v) ->
          case KM.lookup "number" v of
            Just (JSON.Number n) -> Just $ round n
            _ -> Nothing
        _ -> Nothing
    _ -> Nothing
getBlockNumber _ = Nothing

eth_blockNumber :: Method Server
eth_blockNumber = toMethod "eth_blockNumber" f ()
  where
    f :: RpcResult Server String
    f = do
      response <- liftIO $ API.call "block/last/1"
      case JSON.decode $ BLC.pack response :: Maybe JSON.Value of
        Just v ->
          case getBlockNumber v of
            Just n ->
              return $ "0x" ++ show n
            Nothing -> throwError $ rpcError (-1) (T.pack $ "bad response from server")
        v -> throwError $ rpcError (-1) (T.pack $ "bad response from server: " ++ show v)

----------------

emitKafkaJsonRlpCommand :: JsonRpcCommand -> IO ()
emitKafkaJsonRlpCommand c = do
  _ <- runKafkaMConfigured "strato-api" $ writeSeqVmEvents [VmJsonRpcCommand c]
  return ()

waitForResponse :: String -> Offset -> IO B.ByteString
waitForResponse id offset = do
  putStrLn $ "before wait: " ++ show offset
  maybeResponses <- fetchBytesIO (lookupTopic "jsonrpcresponse") offset

  putStrLn "something has come"

  let responses = map (decode . BLC.fromStrict) $
        case maybeResponses of
          Nothing -> error "can't connect to Kafka"
          Just v -> v

  putStrLn $ "fetched " ++ show responses

  case filter ((id ==) . fst) responses of
    [] -> waitForResponse id (offset + fromIntegral (length responses))
    [(_, val)] -> return val
    _ -> error "you should not have more than one response with the same id"

callVM :: JsonRpcCommand -> IO B.ByteString
callVM c = do
  lastOffsetOrError <-
    liftIO $
      runKafkaConfigured "ethereum-jsonrpc" $
        getLastOffset LatestTime 0 (lookupTopic "jsonrpcresponse")
  let lastOffset =
        case lastOffsetOrError of
          Left e -> error $ show e
          Right val -> val

  emitKafkaJsonRlpCommand c

  waitForResponse (jrcId c) lastOffset

eth_getBalance :: Method Server
eth_getBalance = toMethod "eth_getBalance" f (Required "address" :+: Required "blockString" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString blockString = do
      id <- liftIO $ fmap (take 10 . randomRs ('a', 'z')) newStdGen
      case strToAddress addressString of
        Left err -> throwError $ rpcError (-32602) $ T.pack err
        Right address -> do
          result <-
            liftIO $
              callVM
                JRCGetBalance
                  { jrcAddress = address,
                    jrcBlockString = blockString,
                    jrcId = id
                  }
          return $ BC.unpack result

eth_getCode :: Method Server
eth_getCode = toMethod "eth_getCode" f (Required "address" :+: Required "block" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString blockString = do
      id <- liftIO $ fmap (take 10 . randomRs ('a', 'z')) newStdGen
      case strToAddress addressString of
        Left err -> throwError $ rpcError (-32602) $ T.pack err
        Right address -> do
          result <-
            liftIO $
              callVM
                JRCGetCode
                  { jrcAddress = address,
                    jrcBlockString = blockString,
                    jrcId = id
                  }
          return $ BC.unpack result

eth_getTransactionCount :: Method Server
eth_getTransactionCount = toMethod "eth_getTransactionCount" f (Required "address" :+: Required "block" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString blockString = do
      id <- liftIO $ fmap (take 10 . randomRs ('a', 'z')) newStdGen
      case strToAddress addressString of
        Left err -> throwError $ rpcError (-32602) $ T.pack err
        Right address -> do
          result <-
            liftIO $
              callVM
                JRCGetTransactionCount
                  { jrcAddress = address,
                    jrcBlockString = blockString,
                    jrcId = id
                  }
          return $ BC.unpack result

eth_getStorageAt :: Method Server
eth_getStorageAt = toMethod "eth_getStorageAt" f (Required "address" :+: Required "key" :+: Required "block" :+: ())
  where
    f :: String -> String -> String -> RpcResult Server String
    f addressString _ blockString = do
      id <- liftIO $ fmap (take 10 . randomRs ('a', 'z')) newStdGen
      case strToAddress addressString of
        Left err -> throwError $ rpcError (-32602) $ T.pack err
        Right address -> do
          result <-
            liftIO $
              callVM
                JRCGetStorageAt
                  { jrcAddress = address,
                    jrcBlockString = blockString,
                    jrcId = id,
                    jrcKey = ""
                  }
          return $ BC.unpack result

eth_call :: Method Server
eth_call = toMethod "eth_call" f (Required "codeString" :+: Required "blockString" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f codeString blockString = do
      let id = "qqqq"
      let nope = error "jsonrpc.eth_call.createMessageTX"
      _ <- liftIO $ createMessageTX nope nope nope nope nope nope nope nope
      case strToByteString codeString of
        Left err -> throwError $ rpcError (-32602) $ T.pack err
        Right codeBytes -> do
          liftIO $
            emitKafkaJsonRlpCommand
              JRCCall
                { jrcCode = codeBytes,
                  jrcBlockString = blockString,
                  jrcId = id
                }
          return "qqqq"

-------------------

eth_getBlockTransactionCountByHash :: Method Server
eth_getBlockTransactionCountByHash = toMethod "eth_getBlockTransactionCountByHash" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getBlockTransactionCountByNumber :: Method Server
eth_getBlockTransactionCountByNumber = toMethod "eth_getBlockTransactionCountByNumber" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getUncleCountByBlockHash :: Method Server
eth_getUncleCountByBlockHash = toMethod "eth_getUncleCountByBlockHash" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getUncleCountByBlockNumber :: Method Server
eth_getUncleCountByBlockNumber = toMethod "eth_getUncleCountByBlockNumber" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_sign :: Method Server
eth_sign = toMethod "eth_sign" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_sendTransaction :: Method Server
eth_sendTransaction = toMethod "eth_sendTransaction" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_sendRawTransaction :: Method Server
eth_sendRawTransaction = toMethod "eth_sendRawTransaction" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_estimateGas :: Method Server
eth_estimateGas = toMethod "eth_estimateGas" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getBlockByHash :: Method Server
eth_getBlockByHash = toMethod "eth_getBlockByHash" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getBlockByNumber :: Method Server
eth_getBlockByNumber = toMethod "eth_getBlockByNumber" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getTransactionByHash :: Method Server
eth_getTransactionByHash = toMethod "eth_getTransactionByHash" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getTransactionByBlockHashAndIndex :: Method Server
eth_getTransactionByBlockHashAndIndex = toMethod "eth_getTransactionByBlockHashAndIndex" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getTransactionByBlockNumberAndIndex :: Method Server
eth_getTransactionByBlockNumberAndIndex = toMethod "eth_getTransactionByBlockNumberAndIndex" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getTransactionReceipt :: Method Server
eth_getTransactionReceipt = toMethod "eth_getTransactionReceipt" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getUncleByBlockHashAndIndex :: Method Server
eth_getUncleByBlockHashAndIndex = toMethod "eth_getUncleByBlockHashAndIndex" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getUncleByBlockNumberAndIndex :: Method Server
eth_getUncleByBlockNumberAndIndex = toMethod "eth_getUncleByBlockNumberAndIndex" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getCompilers :: Method Server
eth_getCompilers = toMethod "eth_getCompilers" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_compileLLL :: Method Server
eth_compileLLL = toMethod "eth_compileLLL" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_compileSolidity :: Method Server
eth_compileSolidity = toMethod "eth_compileSolidity" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_compileSerpent :: Method Server
eth_compileSerpent = toMethod "eth_compileSerpent" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_newFilter :: Method Server
eth_newFilter = toMethod "eth_newFilter" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_newBlockFilter :: Method Server
eth_newBlockFilter = toMethod "eth_newBlockFilter" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_newPendingTransactionFilter :: Method Server
eth_newPendingTransactionFilter = toMethod "eth_newPendingTransactionFilter" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_uninstallFilter :: Method Server
eth_uninstallFilter = toMethod "eth_uninstallFilter" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getFilterChanges :: Method Server
eth_getFilterChanges = toMethod "eth_getFilterChanges" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getFilterLogs :: Method Server
eth_getFilterLogs = toMethod "eth_getFilterLogs" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getLogs :: Method Server
eth_getLogs = toMethod "eth_getLogs" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_getWork :: Method Server
eth_getWork = toMethod "eth_getWork" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_submitWork :: Method Server
eth_submitWork = toMethod "eth_submitWork" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

eth_submitHashrate :: Method Server
eth_submitHashrate = toMethod "eth_submitHashrate" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

db_putString :: Method Server
db_putString = toMethod "db_putString" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

db_getString :: Method Server
db_getString = toMethod "db_getString" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

db_putHex :: Method Server
db_putHex = toMethod "db_putHex" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

db_getHex :: Method Server
db_getHex = toMethod "db_getHex" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_post :: Method Server
shh_post = toMethod "shh_post" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_version :: Method Server
shh_version = toMethod "shh_version" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_newIdentity :: Method Server
shh_newIdentity = toMethod "shh_newIdentity" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_hasIdentity :: Method Server
shh_hasIdentity = toMethod "shh_hasIdentity" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_newGroup :: Method Server
shh_newGroup = toMethod "shh_newGroup" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_addToGroup :: Method Server
shh_addToGroup = toMethod "shh_addToGroup" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_newFilter :: Method Server
shh_newFilter = toMethod "shh_newFilter" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_uninstallFilter :: Method Server
shh_uninstallFilter = toMethod "shh_uninstallFilter" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_getFilterChanges :: Method Server
shh_getFilterChanges = toMethod "shh_getFilterChanges" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

shh_getMessages :: Method Server
shh_getMessages = toMethod "shh_getMessages" f ()
  where
    f :: RpcResult Server String
    f = do
      undefined

{-

JSON RPC API Reference

curl -X POST --data '{"jsonrpc":"2.0","method":"web3_clientVersion","params":[],"id":67}'
{
  "id":67,
  "jsonrpc":"2.0",
  "result": "Mist/v0.9.3/darwin/go1.4.1"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"web3_sha3","params":["0x68656c6c6f20776f726c64"],"id":64}'
{
  "id":64,
  "jsonrpc": "2.0",
  "result": "0x47173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":67}'
{
  "id":67,
  "jsonrpc": "2.0",
  "result": "59"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"net_listening","params":[],"id":67}'
{
  "id":67,
  "jsonrpc":"2.0",
  "result":true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":74}'
{
  "id":74,
  "jsonrpc": "2.0",
  "result": "0x2" // 2
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_protocolVersion","params":[],"id":67}'
{
  "id":67,
  "jsonrpc": "2.0",
  "result": "54"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": {
    startingBlock: '0x384',
    currentBlock: '0x386',
    highestBlock: '0x454'
  }
}
// Or when not syncing
{
  "id":1,
  "jsonrpc": "2.0",
  "result": false
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_coinbase","params":[],"id":64}'
{
  "id":64,
  "jsonrpc": "2.0",
  "result": "0x407d73d8a49eeb85d32cf465507dd71d507100c1"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_mining","params":[],"id":71}'
{
  "id":71,
  "jsonrpc": "2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_hashrate","params":[],"id":71}'
{
  "id":71,
  "jsonrpc": "2.0",
  "result": "0x38a"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":73}'
{
  "id":73,
  "jsonrpc": "2.0",
  "result": "0x09184e72a000" // 10000000000000
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": ["0x407d73d8a49eeb85d32cf465507dd71d507100c1"]
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":83}'
{
  "id":83,
  "jsonrpc": "2.0",
  "result": "0x4b7" // 1207
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x407d73d8a49eeb85d32cf465507dd71d507100c1", "latest"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x0234c8a3397aab58" // 158972490234375000
}

curl -X POST --data '{"jsonrpc":"2.0", "method": "eth_getStorageAt", "params": ["0x295a70b2de5e3953354a6a8344e616ed314d7251", "0x0", "latest"], "id": 1}' localhost:8545
{"jsonrpc":"2.0","id":1,"result":"0x00000000000000000000000000000000000000000000000000000000000004d2"}

curl -X POST --data '{"jsonrpc":"2.0", "method": "eth_getStorageAt", "params": ["0x295a70b2de5e3953354a6a8344e616ed314d7251", "0x6661e9d6d8b923d5bbaab1b96e1dd51ff6ea2a93520fdc9eb75d059238b8c5e9", "latest"], "id": 1}' localhost:8545
{"jsonrpc":"2.0","id":1,"result":"0x000000000000000000000000000000000000000000000000000000000000162e"}
eth_getTransactionCount

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getTransactionCount","params":["0x407d73d8a49eeb85d32cf465507dd71d507100c1","latest"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x1" // 1
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getBlockTransactionCountByHash","params":["0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0xb" // 11
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getBlockTransactionCountByNumber","params":["0xe8"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0xa" // 10
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getUncleCountByBlockHash","params":["0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x1" // 1
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getUncleCountByBlockNumber","params":["0xe8"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x1" // 1
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b", "0x2"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x600160008035811a818181146012578301005b601b6001356025565b8060005260206000f25b600060078202905091905056"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_sign","params":["0x8a3106a3e50576d4b6794a0e74d3bb5f8c9acaab", "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0xbd685c98ec39490f50d15c67ba2a8e9b5b1d6d7601fca80b295e7d717446bd8b7127ea4871e996cdc8cae7690408b4e800f60ddac49d2ad34180e68f1da0aaf001"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_sendTransaction","params":[{see above}],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":[{see above}],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_call","params":[{see above}],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_estimateGas","params":[{see above}],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x5208" // 21000
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getBlockByHash","params":["0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331", true],"id":1}'
{
"id":1,
"jsonrpc":"2.0",
"result": {
    "number": "0x1b4", // 436
    "hash": "0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331",
    "parentHash": "0x9646252be9520f6e71339a8df9c55e4d7619deeb018d2a3f2d21fc165dde5eb5",
    "nonce": "0xe04d296d2460cfb8472af2c5fd05b5a214109c25688d3704aed5484f9a7792f2",
    "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
    "logsBloom": "0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331",
    "transactionsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    "stateRoot": "0xd5855eb08b3387c0af375e9cdb6acfc05eb8f519e419b874b6ff2ffda7ed1dff",
    "miner": "0x4e65fda2159562a496f9f3522f89122a3088497a",
    "difficulty": "0x027f07", // 163591
    "totalDifficulty":  "0x027f07", // 163591
    "extraData": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "size":  "0x027f07", // 163591
    "gasLimit": "0x9f759", // 653145
    "gasUsed": "0x9f759", // 653145
    "timestamp": "0x54e34e8e" // 1424182926
    "transactions": [{...},{ ... }]
    "uncles": ["0x1606e5...", "0xd5145a9..."]
  }
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x1b4", true],"id":1}'
Result see eth_getBlockByHash

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getTransactionByHash","params":["0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238"],"id":1}'
{
"id":1,
"jsonrpc":"2.0",
"result": {
    "hash":"0xc6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b",
    "nonce":"0x",
    "blockHash": "0xbeab0aa2411b7ab17f30a99d3cb9c6ef2fc5426d6ad6fd9e2a26a6aed1d1055b",
    "blockNumber": "0x15df", // 5599
    "transactionIndex":  "0x1", // 1
    "from":"0x407d73d8a49eeb85d32cf465507dd71d507100c1",
    "to":"0x85h43d8a49eeb85d32cf465507dd71d507100c1",
    "value":"0x7f110" // 520464
    "gas": "0x7f110" // 520464
    "gasPrice":"0x09184e72a000",
    "input":"0x603880600c6000396000f300603880600c6000396000f3603880600c6000396000f360",
  }
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getTransactionByBlockHashAndIndex","params":[0xc6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b, "0x0"],"id":1}'
See eth_gettransactionbyhash

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getTransactionByBlockNumberAndIndex","params":["0x29c", "0x0"],"id":1}'
Result see eth_getTransactionByHash

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238"],"id":1}'
{
"id":1,
"jsonrpc":"2.0",
"result": {
     transactionHash: '0xb903239f8543d04b5dc1ba6579132b143087c68db1b2168786408fcbce568238',
     transactionIndex:  '0x1', // 1
     blockNumber: '0xb', // 11
     blockHash: '0xc6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b',
     cumulativeGasUsed: '0x33bc', // 13244
     gasUsed: '0x4dc', // 1244
     contractAddress: '0xb60e8dd61c5d32be8058bb8eb970870f07233155' // or null, if none was created
     logs: [{
         // logs as returned by getFilterLogs, etc.
     }, ...]
  }
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getUncleByBlockHashAndIndex","params":["0xc6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b", "0x0"],"id":1}'
Result see eth_getBlockByHash

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getUncleByBlockNumberAndIndex","params":["0x29c", "0x0"],"id":1}'
Result see eth_getBlockByHash

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getCompilers","params":[],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": ["solidity", "lll", "serpent"]
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_compileSolidity","params":["contract test { function multiply(uint a) returns(uint d) {   return a * 7;   } }"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": {
      "code": "0x605880600c6000396000f3006000357c010000000000000000000000000000000000000000000000000000000090048063c6888fa114602e57005b603d6004803590602001506047565b8060005260206000f35b60006007820290506053565b91905056",
      "info": {
        "source": "contract test {\n   function multiply(uint a) constant returns(uint d) {\n       return a * 7;\n   }\n}\n",
        "language": "Solidity",
        "languageVersion": "0",
        "compilerVersion": "0.9.19",
        "abiDefinition": [
          {
            "constant": true,
            "inputs": [
              {
                "name": "a",
                "type": "uint256"
              }
            ],
            "name": "multiply",
            "outputs": [
              {
                "name": "d",
                "type": "uint256"
              }
            ],
            "type": "function"
          }
        ],
        "userDoc": {
          "methods": {}
        },
        "developerDoc": {
          "methods": {}
        }
      }

}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_compileLLL","params":["(returnlll (suicide (caller)))"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x603880600c6000396000f3006001600060e060020a600035048063c6888fa114601857005b6021600435602b565b8060005260206000f35b600081600702905091905056" // the compiled source code
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_compileSerpent","params":["/* some serpent */"],"id":1}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x603880600c6000396000f3006001600060e060020a600035048063c6888fa114601857005b6021600435602b565b8060005260206000f35b600081600702905091905056" // the compiled source code
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_newFilter","params":[{"topics":["0x12341234"]}],"id":73}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0x1" // 1
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_newBlockFilter","params":[],"id":73}'
{
  "id":1,
  "jsonrpc":  "2.0",
  "result": "0x1" // 1
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_newPendingTransactionFilter","params":[],"id":73}'
{
  "id":1,
  "jsonrpc":  "2.0",
  "result": "0x1" // 1
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_uninstallFilter","params":["0xb"],"id":73}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getFilterChanges","params":["0x16"],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": [{
    "logIndex": "0x1", // 1
    "blockNumber":"0x1b4" // 436
    "blockHash": "0x8216c5785ac562ff41e2dcfdf5785ac562ff41e2dcfdf829c5a142f1fccd7d",
    "transactionHash":  "0xdf829c5a142f1fccd7d8216c5785ac562ff41e2dcfdf5785ac562ff41e2dcf",
    "transactionIndex": "0x0", // 0
    "address": "0x16c5785ac562ff41e2dcfdf829c5a142f1fccd7d",
    "data":"0x0000000000000000000000000000000000000000000000000000000000000000",
    "topics": ["0x59ebeb90bc63057b6515673c3ecf9438e5058bca0f92585014eced636878c9a5"]
    },{
      ...
    }]
}

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getFilterLogs","params":["0x16"],"id":74}'
See eth_getFilterChanges

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getLogs","params":[{"topics":["0x000000000000000000000000a94f5374fce5edbc8e2a8697c15331677e6ebf0b"]}],"id":74}'
Result see eth_getFilterChanges

curl -X POST --data '{"jsonrpc":"2.0","method":"eth_getWork","params":[],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": [
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "0x5EED00000000000000000000000000005EED0000000000000000000000000000",
      "0xd1ff1c01710000000000000000000000d1ff1c01710000000000000000000000"
    ]
}

curl -X POST --data '{"jsonrpc":"2.0", "method":"eth_submitWork", "params":["0x0000000000000001", "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", "0xD1GE5700000000000000000000000000D1GE5700000000000000000000000000"],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0", "method":"eth_submitHashrate", "params":["0x0000000000000000000000000000000000000000000000000000000000500000", "0x59daa26581d0acd1fce254fb7e85952f4c09d0915afd33d3886cd914bc7d283c"],"id":73}'
{
  "id":73,
  "jsonrpc":"2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"db_putString","params":["testDB","myKey","myString"],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"db_getString","params":["testDB","myKey"],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": "myString"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"db_putHex","params":["testDB","myKey","0x68656c6c6f20776f726c64"],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"db_getHex","params":["testDB","myKey"],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": "0x68656c6c6f20776f726c64"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_version","params":[],"id":67}'
{
  "id":67,
  "jsonrpc": "2.0",
  "result": "2"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_post","params":[{"from":"0xc931d93e97ab07fe42d923478ba2465f2..","topics": ["0x68656c6c6f20776f726c64"],"payload":"0x68656c6c6f20776f726c64","ttl":0x64,"priority":0x64}],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_newIdentity","params":[],"id":73}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0xc931d93e97ab07fe42d923478ba2465f283f440fd6cabea4dd7a2c807108f651b7135d1d6ca9007d5b68aa497e4619ac10aa3b27726e1863c1fd9b570d99bbaf"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_hasIdentity","params":["0x04f96a5e25610293e42a73908e93ccc8c4d4dc0edcfa9fa872f50cb214e08ebf61a03e245533f97284d442460f2998cd41858798ddfd4d661997d3940272b717b1"],"id":73}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_newIdentity","params":[],"id":73}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": "0xc65f283f440fd6cabea4dd7a2c807108f651b7135d1d6ca90931d93e97ab07fe42d923478ba2407d5b68aa497e4619ac10aa3b27726e1863c1fd9b570d99bbaf"
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_hasIdentity","params":["0x04f96a5e25610293e42a73908e93ccc8c4d4dc0edcfa9fa872f50cb214e08ebf61a03e245533f97284d442460f2998cd41858798ddfd4d661997d3940272b717b1"],"id":73}'
{
  "id":1,
  "jsonrpc": "2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_newFilter","params":[{"topics": ['0x12341234bf4b564f'],"to": "0x2341234bf4b2341234bf4b564f..."}],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": "0x7" // 7
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_uninstallFilter","params":["0x7"],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": true
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_getFilterChanges","params":["0x7"],"id":73}'
{
  "id":1,
  "jsonrpc":"2.0",
  "result": [{
    "hash": "0x33eb2da77bf3527e28f8bf493650b1879b08c4f2a362beae4ba2f71bafcd91f9",
    "from": "0x3ec052fc33..",
    "to": "0x87gdf76g8d7fgdfg...",
    "expiry": "0x54caa50a", // 1422566666
    "sent": "0x54ca9ea2", // 1422565026
    "ttl": "0x64" // 100
    "topics": ["0x6578616d"],
    "payload": "0x7b2274797065223a226d657373616765222c2263686...",
    "workProved": "0x0"
    }]
}

curl -X POST --data '{"jsonrpc":"2.0","method":"shh_getMessages","params":["0x7"],"id":73}'
Result see shh_getFilterChanges

-}

{-
  web3_clientVersion,
  web3_sha3,
  net_version,
  eth_protocolVersion,
  eth_coinbase,

  eth_getBalance,
  eth_getCode,
  eth_getTransactionCount,
  eth_getStorageAt,
  eth_call,

  eth_sendTransaction,
  eth_sendRawTransaction,

  net_peerCount,
  net_listening,
  eth_syncing,
  eth_mining,
  eth_hashrate,
  eth_gasPrice,
  eth_accounts,
  eth_blockNumber,
  eth_getBlockTransactionCountByHash,
  eth_getBlockTransactionCountByNumber,
  eth_getUncleCountByBlockHash,
  eth_getUncleCountByBlockNumber,
  eth_sign,
  eth_estimateGas,
  eth_getBlockByHash,
  eth_getBlockByNumber,
  eth_getTransactionByHash,
  eth_getTransactionByBlockHashAndIndex,
  eth_getTransactionByBlockNumberAndIndex,
  eth_getTransactionReceipt,
  eth_getUncleByBlockHashAndIndex,
  eth_getUncleByBlockNumberAndIndex,
  eth_getCompilers,
  eth_compileLLL,
  eth_compileSolidity,
  eth_compileSerpent,
  eth_newFilter,
  eth_newBlockFilter,
  eth_newPendingTransactionFilter,
  eth_uninstallFilter,
  eth_getFilterChanges,
  eth_getFilterLogs,
  eth_getLogs,
  eth_getWork,
  eth_submitWork,
  eth_submitHashrate,

  db_putString,
  db_getString,
  db_putHex,
  db_getHex,
  shh_post,
  shh_version,
  shh_newIdentity,
  shh_hasIdentity,
  shh_newGroup,
  shh_addToGroup,
  shh_newFilter,
  shh_uninstallFilter,
  shh_getFilterChanges,
  shh_getMessages
-}
