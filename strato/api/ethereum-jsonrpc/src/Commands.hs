{-# LANGUAGE OverloadedStrings #-}

module Commands
  ( methods,
  )
where

import qualified APIProxy as API
import Binary
import Blockchain.Constants
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
    f = do
      return "0x0000000000000000000000000000000000000000"

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

eth_getBlockTransactionCountByHash :: Method Server
eth_getBlockTransactionCountByHash = toMethod "eth_getBlockTransactionCountByHash" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getBlockTransactionCountByHash not yet implemented"

eth_getBlockTransactionCountByNumber :: Method Server
eth_getBlockTransactionCountByNumber = toMethod "eth_getBlockTransactionCountByNumber" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getBlockTransactionCountByNumber not yet implemented"

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
eth_getBlockByHash = toMethod "eth_getBlockByHash" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getBlockByHash not yet implemented"

eth_getBlockByNumber :: Method Server
eth_getBlockByNumber = toMethod "eth_getBlockByNumber" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getBlockByNumber not yet implemented"

eth_getTransactionByHash :: Method Server
eth_getTransactionByHash = toMethod "eth_getTransactionByHash" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getTransactionByHash not yet implemented"

eth_getTransactionByBlockHashAndIndex :: Method Server
eth_getTransactionByBlockHashAndIndex = toMethod "eth_getTransactionByBlockHashAndIndex" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getTransactionByBlockHashAndIndex not yet implemented"

eth_getTransactionByBlockNumberAndIndex :: Method Server
eth_getTransactionByBlockNumberAndIndex = toMethod "eth_getTransactionByBlockNumberAndIndex" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getTransactionByBlockNumberAndIndex not yet implemented"

eth_getTransactionReceipt :: Method Server
eth_getTransactionReceipt = toMethod "eth_getTransactionReceipt" f ()
  where
    f :: RpcResult Server String
    f = throwError $ rpcError (-32601) "eth_getTransactionReceipt not yet implemented"

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
