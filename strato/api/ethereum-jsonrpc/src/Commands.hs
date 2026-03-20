{-# LANGUAGE OverloadedStrings #-}

module Commands
  ( methods,
  )
where

import qualified APIProxy as API
import Binary
import Blockchain.Constants (stratoVersionString)
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Control.Monad.IO.Class
import Control.Monad.Except
import qualified Data.Aeson as JSON
import qualified Data.Aeson.KeyMap as KM
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.Map as M
import Data.String (fromString)
import qualified Data.Text as T
import qualified Data.Vector as V
import Network.JsonRpc.Server
import Numeric (showHex)
import Prelude hiding (id)

type Server = IO

-- Chain ID for Ethereum JSON-RPC (matches strato-p2p ethVersion)
-- TODO: Make this configurable via environment variable
ethVersion :: Integer
ethVersion = 63

methods :: [Method Server]
methods =
  [ rpc_modules,
    web3_clientVersion,
    web3_sha3,
    net_version,
    net_peerCount,
    net_listening,
    eth_chainId,
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
    eth_submitHashrate
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

eth_chainId :: Method Server
eth_chainId = flip (toMethod "eth_chainId") () $ do
  liftIO $ return $ "0x" ++ showHex ethVersion ""

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
    f = return "0x0"

net_listening :: Method Server
net_listening = toMethod "net_listening" f ()
  where
    f :: RpcResult Server String
    f = return "true"

eth_protocolVersion :: Method Server
eth_protocolVersion = toMethod "eth_protocolVersion" f ()
  where
    f :: RpcResult Server String
    f = return $ show ethVersion

eth_syncing :: Method Server
eth_syncing = toMethod "eth_syncing" f ()
  where
    f :: RpcResult Server String
    f = return "false"

eth_coinbase :: Method Server
eth_coinbase = toMethod "eth_coinbase" f ()
  where
    f :: RpcResult Server String
    f = return "0x0000000000000000000000000000000000000000"

eth_mining :: Method Server
eth_mining = toMethod "eth_mining" f ()
  where
    f :: RpcResult Server String
    f = return "false"

eth_hashrate :: Method Server
eth_hashrate = toMethod "eth_hashrate" f ()
  where
    f :: RpcResult Server String
    f = return "0x0"

eth_gasPrice :: Method Server
eth_gasPrice = toMethod "eth_gasPrice" f ()
  where
    f :: RpcResult Server String
    f = return "0x0"

eth_accounts :: Method Server
eth_accounts = toMethod "eth_accounts" f ()
  where
    f :: RpcResult Server String
    f = return "[]"

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
              return $ "0x" ++ showHex n ""
            Nothing -> throwError $ rpcError (-1) (T.pack "bad response from server")
        v -> throwError $ rpcError (-1) (T.pack $ "bad response from server: " ++ show v)

----------------

getAccountField :: String -> String -> IO (Maybe JSON.Value)
getAccountField addressString field = do
  response <- API.call $ "account?address=" ++ addressString
  case JSON.decode $ BLC.pack response :: Maybe JSON.Value of
    Just (JSON.Array arr) ->
      case V.toList arr of
        (JSON.Object o : _) -> return $ KM.lookup (fromString field) o
        _ -> return Nothing
    _ -> return Nothing

-- TODO: These Kafka-based functions use non-existent helpers (fetchBytesIO, runKafkaConfigured)
-- Commenting out until the required infrastructure is implemented
--
-- emitKafkaJsonRlpCommand :: JsonRpcCommand -> IO ()
-- emitKafkaJsonRlpCommand c = do
--   _ <- runKafkaMConfigured "strato-api" $ writeSeqVmEvents [VmJsonRpcCommand c]
--   return ()
--
-- waitForResponse :: String -> Offset -> IO B.ByteString
-- waitForResponse id offset = do
--   putStrLn $ "before wait: " ++ show offset
--   maybeResponses <- fetchBytesIO "jsonrpcresponse" offset
--   putStrLn "something has come"
--   let responses = map (decode . BLC.fromStrict) $
--         case maybeResponses of
--           Nothing -> error "can't connect to Kafka"
--           Just v -> v
--   putStrLn $ "fetched " ++ show responses
--   case filter ((id ==) . fst) responses of
--     [] -> waitForResponse id (offset + fromIntegral (length responses))
--     [(_, val)] -> return val
--     _ -> error "you should not have more than one response with the same id"
--
-- callVM :: JsonRpcCommand -> IO B.ByteString
-- callVM c = do
--   lastOffsetOrError <-
--     liftIO $
--       runKafkaConfigured "ethereum-jsonrpc" $
--         getLastOffset LatestTime 0 "jsonrpcresponse"
--   let lastOffset =
--         case lastOffsetOrError of
--           Left e -> error $ show e
--           Right val -> val
--   emitKafkaJsonRlpCommand c
--   waitForResponse (jrcId c) lastOffset

eth_getBalance :: Method Server
eth_getBalance = toMethod "eth_getBalance" f (Required "address" :+: Required "blockString" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString _blockString = do
      result <- liftIO $ getAccountField addressString "balance"
      case result of
        Just (JSON.String bal) ->
          case reads (T.unpack bal) :: [(Integer, String)] of
            [(n, _)] -> return $ "0x" ++ showHex n ""
            _ -> return "0x0"
        Just (JSON.Number n) -> return $ "0x" ++ showHex (round n :: Integer) ""
        _ -> return "0x0"

eth_getCode :: Method Server
eth_getCode = toMethod "eth_getCode" f (Required "address" :+: Required "block" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString _blockString = do
      result <- liftIO $ getAccountField addressString "contractName"
      case result of
        Just (JSON.String cn) | not (T.null cn) -> return "0x01"
        _ -> return "0x"

eth_getTransactionCount :: Method Server
eth_getTransactionCount = toMethod "eth_getTransactionCount" f (Required "address" :+: Required "block" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString _blockString = do
      result <- liftIO $ getAccountField addressString "nonce"
      case result of
        Just (JSON.Number n) -> return $ "0x" ++ showHex (round n :: Integer) ""
        _ -> return "0x0"

eth_getStorageAt :: Method Server
eth_getStorageAt = toMethod "eth_getStorageAt" f (Required "address" :+: Required "key" :+: Required "block" :+: ())
  where
    f :: String -> String -> String -> RpcResult Server String
    f _addressString _key _blockString = do
      throwError $ rpcError (-32601) "eth_getStorageAt not yet implemented"

eth_call :: Method Server
eth_call = toMethod "eth_call" f (Required "object" :+: Required "blockString" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f _object _blockString = do
      throwError $ rpcError (-32601) "eth_call not yet implemented"

-------------------

-- Helpers for hex conversion of block numbers in params
parseBlockNum :: String -> Maybe Integer
parseBlockNum "latest" = Nothing
parseBlockNum "earliest" = Just 0
parseBlockNum "pending" = Nothing
parseBlockNum ('0':'x':hex) = case reads ("0x" ++ hex) :: [(Integer, String)] of
  [(n, _)] -> Just n
  _ -> Nothing
parseBlockNum s = case reads s :: [(Integer, String)] of
  [(n, _)] -> Just n
  _ -> Nothing

-- Fetch a block from the REST API and return the raw JSON
fetchBlockByNumber :: String -> IO (Maybe JSON.Value)
fetchBlockByNumber blockParam = do
  let endpoint = case parseBlockNum blockParam of
        Nothing -> "block/last/1"
        Just n  -> "block?number=" ++ show n
  response <- API.call endpoint
  case JSON.decode $ BLC.pack response :: Maybe JSON.Value of
    Just (JSON.Array arr) | not (V.null arr) -> return $ Just (V.head arr)
    _ -> return Nothing

fetchBlockByHash :: String -> IO (Maybe JSON.Value)
fetchBlockByHash hashStr = do
  let h = if take 2 hashStr == "0x" then drop 2 hashStr else hashStr
  response <- API.call $ "block?hash=" ++ h
  case JSON.decode $ BLC.pack response :: Maybe JSON.Value of
    Just (JSON.Array arr) | not (V.null arr) -> return $ Just (V.head arr)
    _ -> return Nothing

-- Convert STRATO block JSON to Ethereum block JSON
stratoBlockToEthBlock :: Bool -> JSON.Value -> String
stratoBlockToEthBlock _fullTxs (JSON.Object blk) =
  let bd = case KM.lookup "blockData" blk of
        Just (JSON.Object o) -> o
        _ -> KM.empty
      lkp k = KM.lookup (fromString k) bd
      lkpBlk k = KM.lookup (fromString k) blk
      hexNum k = case lkp k of
        Just (JSON.Number n) -> "0x" ++ showHex (round n :: Integer) ""
        _ -> "0x0"
      hexStr k = case lkp k of
        Just (JSON.String s) -> "\"" ++ T.unpack s ++ "\""
        _ -> "null"
      blockHash = case lkpBlk "blockHash" of
        Just (JSON.String s) -> "\"0x" ++ T.unpack s ++ "\""
        _ -> "null"
      txHashes = case lkpBlk "receiptTransactions" of
        Just (JSON.Array txs) -> "[" ++ concatComma (map getTxHash (V.toList txs)) ++ "]"
        _ -> "[]"
      getTxHash (JSON.Object tx) = case KM.lookup "hash" tx of
        Just (JSON.String h) -> "\"0x" ++ T.unpack h ++ "\""
        _ -> "null"
      getTxHash _ = "null"
      concatComma [] = ""
      concatComma [x] = x
      concatComma (x:xs) = x ++ "," ++ concatComma xs
  in "{\"number\":\"" ++ hexNum "number" ++ "\""
     ++ ",\"hash\":" ++ blockHash
     ++ ",\"parentHash\":" ++ hexStr "parentHash"
     ++ ",\"nonce\":\"0x0000000000000000\""
     ++ ",\"sha3Uncles\":\"0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\""
     ++ ",\"logsBloom\":\"0x" ++ replicate 512 '0' ++ "\""
     ++ ",\"transactionsRoot\":" ++ hexStr "transactionsRoot"
     ++ ",\"stateRoot\":" ++ hexStr "stateRoot"
     ++ ",\"receiptsRoot\":" ++ hexStr "receiptsRoot"
     ++ ",\"miner\":\"0x0000000000000000000000000000000000000000\""
     ++ ",\"difficulty\":\"0x0\""
     ++ ",\"totalDifficulty\":\"0x0\""
     ++ ",\"extraData\":" ++ hexStr "extraData"
     ++ ",\"size\":\"0x0\""
     ++ ",\"gasLimit\":\"0x1c9c380\""
     ++ ",\"gasUsed\":\"0x0\""
     ++ ",\"timestamp\":" ++ (case lkp "timestamp" of
          Just (JSON.String ts) -> "\"0x" ++ showHex (tsToUnix (T.unpack ts)) "" ++ "\""
          _ -> "\"0x0\"")
     ++ ",\"transactions\":" ++ txHashes
     ++ ",\"uncles\":[]"
     ++ "}"
  where
    tsToUnix :: String -> Integer
    tsToUnix _ = 0
stratoBlockToEthBlock _ _ = "null"

-- Convert STRATO tx JSON to Ethereum tx JSON
stratoTxToEthTx :: JSON.Value -> String
stratoTxToEthTx (JSON.Object tx) =
  let lkp k = KM.lookup (fromString k) tx
      hashVal = case lkp "hash" of
        Just (JSON.String h) -> "0x" ++ T.unpack h
        _ -> "0x"
      fromVal = case lkp "from" of
        Just (JSON.String f) -> "0x" ++ T.unpack f
        _ -> "0x0000000000000000000000000000000000000000"
      toVal = case lkp "to" of
        Just (JSON.String t) -> "\"0x" ++ T.unpack t ++ "\""
        _ -> "null"
      nonceVal = case lkp "nonce" of
        Just (JSON.Number n) -> "0x" ++ showHex (round n :: Integer) ""
        _ -> "0x0"
      blkNum = case lkp "blockNumber" of
        Just (JSON.Number n) -> "0x" ++ showHex (round n :: Integer) ""
        _ -> "0x0"
  in "{\"hash\":\"" ++ hashVal ++ "\""
     ++ ",\"nonce\":\"" ++ nonceVal ++ "\""
     ++ ",\"blockHash\":\"" ++ hashVal ++ "\""
     ++ ",\"blockNumber\":\"" ++ blkNum ++ "\""
     ++ ",\"transactionIndex\":\"0x0\""
     ++ ",\"from\":\"" ++ fromVal ++ "\""
     ++ ",\"to\":" ++ toVal
     ++ ",\"value\":\"0x0\""
     ++ ",\"gas\":\"0x5208\""
     ++ ",\"gasPrice\":\"0x0\""
     ++ ",\"input\":\"0x\""
     ++ "}"
stratoTxToEthTx _ = "null"

eth_getBlockTransactionCountByHash :: Method Server
eth_getBlockTransactionCountByHash = toMethod "eth_getBlockTransactionCountByHash" f (Required "blockHash" :+: ())
  where
    f :: String -> RpcResult Server String
    f blockHash = do
      mBlk <- liftIO $ fetchBlockByHash blockHash
      case mBlk of
        Just (JSON.Object blk) -> case KM.lookup "receiptTransactions" blk of
          Just (JSON.Array txs) -> return $ "0x" ++ showHex (V.length txs) ""
          _ -> return "0x0"
        _ -> return "0x0"

eth_getBlockTransactionCountByNumber :: Method Server
eth_getBlockTransactionCountByNumber = toMethod "eth_getBlockTransactionCountByNumber" f (Required "blockNumber" :+: ())
  where
    f :: String -> RpcResult Server String
    f blockNumber = do
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      case mBlk of
        Just (JSON.Object blk) -> case KM.lookup "receiptTransactions" blk of
          Just (JSON.Array txs) -> return $ "0x" ++ showHex (V.length txs) ""
          _ -> return "0x0"
        _ -> return "0x0"

eth_getUncleCountByBlockHash :: Method Server
eth_getUncleCountByBlockHash = toMethod "eth_getUncleCountByBlockHash" f ()
  where
    f :: RpcResult Server String
    f = return "0x0"

eth_getUncleCountByBlockNumber :: Method Server
eth_getUncleCountByBlockNumber = toMethod "eth_getUncleCountByBlockNumber" f ()
  where
    f :: RpcResult Server String
    f = return "0x0"

eth_sign :: Method Server
eth_sign = toMethod "eth_sign" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_sign not supported"

eth_sendTransaction :: Method Server
eth_sendTransaction = toMethod "eth_sendTransaction" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_sendTransaction not supported, use eth_sendRawTransaction"

eth_sendRawTransaction :: Method Server
eth_sendRawTransaction = toMethod "eth_sendRawTransaction" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_sendRawTransaction not yet implemented"

eth_estimateGas :: Method Server
eth_estimateGas = toMethod "eth_estimateGas" f ()
  where
    f :: RpcResult Server String
    f = return "0x5208"

eth_getBlockByHash :: Method Server
eth_getBlockByHash = toMethod "eth_getBlockByHash" f (Required "blockHash" :+: Required "fullTransactions" :+: ())
  where
    f :: String -> Bool -> RpcResult Server String
    f blockHash fullTxs = do
      mBlk <- liftIO $ fetchBlockByHash blockHash
      case mBlk of
        Just blk -> return $ stratoBlockToEthBlock fullTxs blk
        Nothing -> return "null"

eth_getBlockByNumber :: Method Server
eth_getBlockByNumber = toMethod "eth_getBlockByNumber" f (Required "blockNumber" :+: Required "fullTransactions" :+: ())
  where
    f :: String -> Bool -> RpcResult Server String
    f blockNumber fullTxs = do
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      case mBlk of
        Just blk -> return $ stratoBlockToEthBlock fullTxs blk
        Nothing -> return "null"

-- TODO: blockHash field in tx response needs the actual block hash, not the tx hash.
-- STRATO tx JSON doesn't include the block hash, so we'd need an extra lookup.
eth_getTransactionByHash :: Method Server
eth_getTransactionByHash = toMethod "eth_getTransactionByHash" f (Required "txHash" :+: ())
  where
    f :: String -> RpcResult Server String
    f _txHash = throwError $ rpcError (-32601) "eth_getTransactionByHash not yet implemented - blockHash field needs fix"

eth_getTransactionByBlockHashAndIndex :: Method Server
eth_getTransactionByBlockHashAndIndex = toMethod "eth_getTransactionByBlockHashAndIndex" f (Required "blockHash" :+: Required "index" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f blockHash indexStr = do
      let idx = case parseBlockNum indexStr of
            Just n -> fromIntegral n
            Nothing -> 0 :: Int
      mBlk <- liftIO $ fetchBlockByHash blockHash
      case mBlk of
        Just (JSON.Object blk) -> case KM.lookup "receiptTransactions" blk of
          Just (JSON.Array txs) | idx < V.length txs ->
            return $ stratoTxToEthTx (txs V.! idx)
          _ -> return "null"
        _ -> return "null"

eth_getTransactionByBlockNumberAndIndex :: Method Server
eth_getTransactionByBlockNumberAndIndex = toMethod "eth_getTransactionByBlockNumberAndIndex" f (Required "blockNumber" :+: Required "index" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f blockNumber indexStr = do
      let idx = case parseBlockNum indexStr of
            Just n -> fromIntegral n
            Nothing -> 0 :: Int
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      case mBlk of
        Just (JSON.Object blk) -> case KM.lookup "receiptTransactions" blk of
          Just (JSON.Array txs) | idx < V.length txs ->
            return $ stratoTxToEthTx (txs V.! idx)
          _ -> return "null"
        _ -> return "null"

eth_getTransactionReceipt :: Method Server
eth_getTransactionReceipt = toMethod "eth_getTransactionReceipt" f (Required "txHash" :+: ())
  where
    f :: String -> RpcResult Server String
    f txHash = do
      let h = if take 2 txHash == "0x" then drop 2 txHash else txHash
      response <- liftIO $ API.call $ "transactionResult/" ++ h
      case JSON.decode $ BLC.pack response :: Maybe JSON.Value of
        Just (JSON.Array arr) | not (V.null arr) ->
          case V.head arr of
            JSON.Object tr -> do
              let lkp k = KM.lookup (fromString k) tr
                  txHashHex = "0x" ++ h
                  blkHash = case lkp "blockHash" of
                    Just (JSON.String s) -> "0x" ++ T.unpack s
                    _ -> txHashHex
                  gasUsed = case lkp "gasUsed" of
                    Just (JSON.Number n) -> "0x" ++ showHex (round n :: Integer) ""
                    Just (JSON.String s) -> case reads (T.unpack s) :: [(Integer, String)] of
                      [(n, _)] -> "0x" ++ showHex n ""
                      _ -> "0x0"
                    _ -> "0x0"
                  statusCode = case lkp "status" of
                    Just (JSON.String "success") -> "0x1"
                    _ -> "0x0"
                  contractAddr = case lkp "contractsCreated" of
                    Just (JSON.Array cs) | not (V.null cs) -> case V.head cs of
                      JSON.String a -> "\"0x" ++ T.unpack a ++ "\""
                      _ -> "null"
                    _ -> "null"
              return $ "{\"transactionHash\":\"" ++ txHashHex ++ "\""
                ++ ",\"transactionIndex\":\"0x0\""
                ++ ",\"blockHash\":\"" ++ blkHash ++ "\""
                ++ ",\"blockNumber\":\"0x0\""
                ++ ",\"from\":\"0x0000000000000000000000000000000000000000\""
                ++ ",\"to\":null"
                ++ ",\"cumulativeGasUsed\":" ++ "\"" ++ gasUsed ++ "\""
                ++ ",\"gasUsed\":\"" ++ gasUsed ++ "\""
                ++ ",\"contractAddress\":" ++ contractAddr
                ++ ",\"logs\":[]"
                ++ ",\"logsBloom\":\"0x" ++ replicate 512 '0' ++ "\""
                ++ ",\"status\":\"" ++ statusCode ++ "\""
                ++ ",\"effectiveGasPrice\":\"0x0\""
                ++ ",\"type\":\"0x0\""
                ++ "}"
            _ -> return "null"
        _ -> return "null"

eth_getUncleByBlockHashAndIndex :: Method Server
eth_getUncleByBlockHashAndIndex = toMethod "eth_getUncleByBlockHashAndIndex" f ()
  where
    f :: RpcResult Server String
    f = return "null"

eth_getUncleByBlockNumberAndIndex :: Method Server
eth_getUncleByBlockNumberAndIndex = toMethod "eth_getUncleByBlockNumberAndIndex" f ()
  where
    f :: RpcResult Server String
    f = return "null"

eth_getCompilers :: Method Server
eth_getCompilers = toMethod "eth_getCompilers" f ()
  where
    f :: RpcResult Server String
    f = return "[]"

eth_compileLLL :: Method Server
eth_compileLLL = toMethod "eth_compileLLL" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_compileLLL not supported"

eth_compileSolidity :: Method Server
eth_compileSolidity = toMethod "eth_compileSolidity" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_compileSolidity not supported"

eth_compileSerpent :: Method Server
eth_compileSerpent = toMethod "eth_compileSerpent" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_compileSerpent not supported"

eth_newFilter :: Method Server
eth_newFilter = toMethod "eth_newFilter" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_newFilter not yet implemented"

eth_newBlockFilter :: Method Server
eth_newBlockFilter = toMethod "eth_newBlockFilter" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_newBlockFilter not yet implemented"

eth_newPendingTransactionFilter :: Method Server
eth_newPendingTransactionFilter = toMethod "eth_newPendingTransactionFilter" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_newPendingTransactionFilter not yet implemented"

eth_uninstallFilter :: Method Server
eth_uninstallFilter = toMethod "eth_uninstallFilter" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_uninstallFilter not yet implemented"

eth_getFilterChanges :: Method Server
eth_getFilterChanges = toMethod "eth_getFilterChanges" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getFilterChanges not yet implemented"

eth_getFilterLogs :: Method Server
eth_getFilterLogs = toMethod "eth_getFilterLogs" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getFilterLogs not yet implemented"

eth_getLogs :: Method Server
eth_getLogs = toMethod "eth_getLogs" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getLogs not yet implemented"

eth_getWork :: Method Server
eth_getWork = toMethod "eth_getWork" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getWork not supported"

eth_submitWork :: Method Server
eth_submitWork = toMethod "eth_submitWork" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_submitWork not supported"

eth_submitHashrate :: Method Server
eth_submitHashrate = toMethod "eth_submitHashrate" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_submitHashrate not supported"
