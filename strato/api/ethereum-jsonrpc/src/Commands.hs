{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications  #-}

module Commands
  ( methods,
  )
where

import Binary
import EthTypes (TransactionReceipt(..))
import Blockchain.Constants (stratoVersionString)
import Blockchain.CommunicationConduit (ethVersion)
import Blockchain.EthConf (runKafkaMConfigured, ethConf)
import qualified Blockchain.EthConf.Model as EthConf
import Blockchain.EthConf.Model (apiConfig, apiListenAddress, apiPort, networkConfig, networkID)
import Blockchain.Data.Block (blockBlockData, blockReceiptTransactions)
import Blockchain.Data.BlockHeader (BlockHeader (..))
import Blockchain.Data.DataDefs (AddressStateRef (..))
import Blockchain.Data.RLP (rlpDecode, rlpDeserialize)
import Blockchain.Data.Transaction (Transaction(..), transactionHash, txAndTime2RawTX)
import Blockchain.Data.TXOrigin (TXOrigin(API))
import Blockchain.Model.JsonBlock (AddressStateRef' (..), Block', RawTransaction'(..), Transaction'(..), bPrimeToB)
import Blockchain.Sequencer.Event (JsonRpcCommand(..), VmTask(..))
import Blockchain.Sequencer.Kafka (writeSeqVmTasks)
import Blockchain.Strato.Model.Address ()
import Blockchain.Strato.Model.Keccak256 (Keccak256, hash, keccak256FromHex, keccak256ToByteString)
import Text.Format (format)
import Control.Monad.IO.Class
import Control.Monad.Composable.Kafka (fetchItems, execKafka)
import Control.Monad.Except
import Blockchain.Sequencer.HexData (HexData(..))
import qualified Blockchain.Sequencer.TxCallObject as TxCall
import Blockchain.Sequencer.TxCallObject (TxCallObject)
import qualified Handlers.AccountInfo as Accounts
import qualified Handlers.Transaction as Tx
import qualified Handlers.BlkLast as BlkLast
import qualified Handlers.Block as Blocks
import qualified Handlers.TransactionResult as TxResults
import Network.Kafka (getLastOffset, KafkaTime(..))
import Network.Kafka.Protocol (Offset(..))
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Time.Calendar (fromGregorian)
import Data.Time.Clock (UTCTime(..))
import qualified Data.Map as M
import qualified Data.Text as T
import Network.JsonRpc.Server
import Numeric (showHex)
import Prelude hiding (id)
import Network.HTTP.Client (newManager, defaultManagerSettings)
import Network.HTTP.Types.Status (statusCode, statusMessage)
import Servant.Client (BaseUrl (..), ClientError(..), ClientM, ResponseF(..), Scheme (Http), mkClientEnv, runClientM)

type Server = IO

protocolVersion :: Integer
protocolVersion = fromIntegral ethVersion

apiBaseUrl :: BaseUrl
apiBaseUrl =
  BaseUrl
    Http
    (apiListenAddress $ apiConfig ethConf)
    (apiPort $ apiConfig ethConf)
    "/eth/v1.2"

runLocal :: ClientM a -> IO (Either ClientError a)
runLocal action = do
  mgr <- newManager defaultManagerSettings
  runClientM action (mkClientEnv mgr apiBaseUrl)

formatClientError :: ClientError -> T.Text
formatClientError (FailureResponse _ resp) =
  let s = responseStatusCode resp
  in T.pack $ "HTTP " ++ show (statusCode s) ++ " " ++ BC.unpack (statusMessage s)
formatClientError (ConnectionError _) = "connection error"
formatClientError (DecodeFailure msg _) = "decode error: " <> msg
formatClientError _ = "request failed"

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
  liftIO $ return $ show $ networkID $ networkConfig ethConf

eth_chainId :: Method Server
eth_chainId = flip (toMethod "eth_chainId") () $ do
  liftIO $ return $ "0x" ++ showHex (EthConf.chainId $ networkConfig ethConf) ""

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
    f = return $ show protocolVersion

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

getBlockNumber :: Block' -> Integer
getBlockNumber blk = case blockBlockData $ bPrimeToB blk of
  BlockHeader {number = n} -> n
  BlockHeaderV2 {number = n} -> n

eth_blockNumber :: Method Server
eth_blockNumber = toMethod "eth_blockNumber" f ()
  where
    f :: RpcResult Server String
    f = do
      response <- liftIO $ runLocal $ BlkLast.getBlkLastClient 1
      case response of
        Right (blk : _) -> return $ "0x" ++ showHex (getBlockNumber blk) ""
        Right [] -> throwError $ rpcError (-32603) "empty block list from server"
        Left err -> throwError $ rpcError (-32603) $ formatClientError err

----------------

emitJsonRpcCommand :: JsonRpcCommand -> IO ()
emitJsonRpcCommand c = do
  putStrLn $ "emitJsonRpcCommand: " ++ show c
  _ <- runKafkaMConfigured "ethereum-jsonrpc" $ writeSeqVmTasks [VmJsonRpcCommand c]
  return ()

waitForResponse :: String -> Int -> Offset -> IO B.ByteString
waitForResponse rpcId retries offset = do
  if retries <= 0
    then return $ BC.pack "error: timeout waiting for vm-runner response"
    else do
      responses <- runKafkaMConfigured "ethereum-jsonrpc" $
        fetchItems "jsonrpcresponse" offset
      let matched = filter ((rpcId ==) . fst) (responses :: [(String, B.ByteString)])
      case matched of
        ((_, val) : _) -> return val
        [] -> do
          let newOffset = offset + fromIntegral (length responses)
          waitForResponse rpcId (retries - 1) newOffset

callVM :: JsonRpcCommand -> IO B.ByteString
callVM c = do
  lastOffset <- runKafkaMConfigured "ethereum-jsonrpc" $
    execKafka $ getLastOffset LatestTime 0 "jsonrpcresponse"
  emitJsonRpcCommand c
  waitForResponse (jrcId c) 50 lastOffset

eth_getBalance :: Method Server
eth_getBalance = toMethod "eth_getBalance" f (Required "address" :+: Required "blockString" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString _blockString = case strToAddress addressString of
      Left _ -> return "0x0"
      Right addr -> do
        response <- liftIO $ runLocal $
          Accounts.getAccountsFilter Accounts.accountsFilterParams {Accounts._qaAddress = Just addr}
        case response of
          Right (AddressStateRef' account : _) ->
            return $ "0x" ++ showHex (addressStateRefBalance account) ""
          _ -> return "0x0"

eth_getCode :: Method Server
eth_getCode = toMethod "eth_getCode" f (Required "address" :+: Required "block" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString _blockString = case strToAddress addressString of
      Left _ -> return "0x"
      Right addr -> do
        response <- liftIO $ runLocal $
          Accounts.getAccountsFilter Accounts.accountsFilterParams {Accounts._qaAddress = Just addr}
        case response of
          Right (AddressStateRef' account : _) ->
            case addressStateRefContractName account of
              Just cn | not (null cn) -> return "0x01"
              _ -> return "0x"
          _ -> return "0x"

eth_getTransactionCount :: Method Server
eth_getTransactionCount = toMethod "eth_getTransactionCount" f (Required "address" :+: Required "block" :+: ())
  where
    f :: String -> String -> RpcResult Server String
    f addressString _blockString = case strToAddress addressString of
      Left _ -> return "0x0"
      Right addr -> do
        response <- liftIO $ runLocal $
          Accounts.getAccountsFilter Accounts.accountsFilterParams {Accounts._qaAddress = Just addr}
        case response of
          Right (AddressStateRef' account : _) ->
            return $ "0x" ++ showHex (addressStateRefNonce account) ""
          _ -> return "0x0"

eth_getStorageAt :: Method Server
eth_getStorageAt = toMethod "eth_getStorageAt" f (Required "address" :+: Required "key" :+: Required "block" :+: ())
  where
    f :: String -> String -> String -> RpcResult Server String
    f _addressString _key _blockString = do
      throwError $ rpcError (-32601) "eth_getStorageAt not yet implemented"

eth_call :: Method Server
eth_call = toMethod "eth_call" f (Required "txObject" :+: Required "blockTag" :+: ())
  where
    f :: TxCallObject -> String -> RpcResult Server String
    f txObj blockTag = do
      let callData = unHexData $ TxCall.data_ txObj
          rpcId = "eth_call_" ++ take 16 (BC.unpack $ B16.encode callData)
      liftIO $ putStrLn $ "eth_call: block=" ++ blockTag ++ " data=" ++ show callData
      liftIO $ putStrLn $ "eth_call: submitting JRCCall to vm-runner, id=" ++ rpcId
      result <- liftIO $ callVM $ JRCCall txObj rpcId blockTag
      liftIO $ putStrLn $ "eth_call: vm-runner returned: " ++ show result
      return $ "0x" ++ BC.unpack (B16.encode result)

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
fetchBlockByNumber :: String -> IO (Maybe Block')
fetchBlockByNumber blockParam = do
  response <- case parseBlockNum blockParam of
    Nothing -> runLocal $ BlkLast.getBlkLastClient 1
    Just n ->
      runLocal $
        Blocks.getBlocksFilter Blocks.blocksFilterParams {Blocks.qbNumber = Just (fromIntegral n)}
  return $ case response of
    Right (blk : _) -> Just blk
    _ -> Nothing

fetchBlockByHash :: String -> IO (Maybe Block')
fetchBlockByHash hashStr = do
  let h = if take 2 hashStr == "0x" then drop 2 hashStr else hashStr
  response <- runLocal $
    Blocks.getBlocksFilter Blocks.blocksFilterParams {Blocks.qbHash = Just (keccak256FromHex h)}
  return $ case response of
    Right (blk : _) -> Just blk
    _ -> Nothing

eth_getBlockTransactionCountByHash :: Method Server
eth_getBlockTransactionCountByHash = toMethod "eth_getBlockTransactionCountByHash" f (Required "blockHash" :+: ())
  where
    f :: String -> RpcResult Server String
    f blockHash = do
      mBlk <- liftIO $ fetchBlockByHash blockHash
      case mBlk of
        Just blk -> return $ "0x" ++ showHex (length $ blockReceiptTransactions $ bPrimeToB blk) ""
        _ -> return "0x0"

eth_getBlockTransactionCountByNumber :: Method Server
eth_getBlockTransactionCountByNumber = toMethod "eth_getBlockTransactionCountByNumber" f (Required "blockNumber" :+: ())
  where
    f :: String -> RpcResult Server String
    f blockNumber = do
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      case mBlk of
        Just blk -> return $ "0x" ++ showHex (length $ blockReceiptTransactions $ bPrimeToB blk) ""
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
eth_sendRawTransaction = toMethod "eth_sendRawTransaction" f (Required "data" :+: ())
  where
    f :: HexData -> RpcResult Server Keccak256
    f (HexData rawTxBytes) = do
      liftIO $ putStrLn $ "eth_sendRawTransaction received " ++ show (B.length rawTxBytes) ++ " bytes"
      let ethTx = rlpDecode (rlpDeserialize rawTxBytes) :: Transaction
          rawTx = txAndTime2RawTX API ethTx (-1) (UTCTime (fromGregorian 2000 1 1) 0)
          tx = RawTransaction' rawTx
          h = transactionHash ethTx
      liftIO $ putStrLn $ "eth_sendRawTransaction decoded tx hash: " ++ format h
      result <- liftIO $ runLocal $ Tx.postTxClient tx
      case result of
        Right h' -> do
          liftIO $ putStrLn $ "eth_sendRawTransaction strato hash: " ++ format h' ++ " returning eth hash: " ++ format h
          return h
        Left err -> throwError $ rpcError (-32603) (formatClientError err)

eth_estimateGas :: Method Server
eth_estimateGas = toMethod "eth_estimateGas" f (Required "txObject" :+: ())
  where
    f :: TxCallObject -> RpcResult Server String
    f _ = return "0x5208"

eth_getBlockByHash :: Method Server
eth_getBlockByHash = toMethod "eth_getBlockByHash" f (Required "blockHash" :+: Required "fullTransactions" :+: ())
  where
    f :: String -> Bool -> RpcResult Server (Maybe Block')
    f blockHash _fullTxs = liftIO $ fetchBlockByHash blockHash

eth_getBlockByNumber :: Method Server
eth_getBlockByNumber = toMethod "eth_getBlockByNumber" f (Required "blockNumber" :+: Required "fullTransactions" :+: ())
  where
    f :: String -> Bool -> RpcResult Server (Maybe Block')
    f blockNumber _fullTxs = liftIO $ fetchBlockByNumber blockNumber

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
    f :: String -> String -> RpcResult Server (Maybe Transaction')
    f blockHash indexStr = do
      let idx = case parseBlockNum indexStr of
            Just n -> fromIntegral n
            Nothing -> 0 :: Int
      mBlk <- liftIO $ fetchBlockByHash blockHash
      return $ case mBlk of
        Just blk ->
          let txs = blockReceiptTransactions $ bPrimeToB blk
           in if idx < length txs
                then Just $ Transaction' (txs !! idx)
                else Nothing
        _ -> Nothing

eth_getTransactionByBlockNumberAndIndex :: Method Server
eth_getTransactionByBlockNumberAndIndex = toMethod "eth_getTransactionByBlockNumberAndIndex" f (Required "blockNumber" :+: Required "index" :+: ())
  where
    f :: String -> String -> RpcResult Server (Maybe Transaction')
    f blockNumber indexStr = do
      let idx = case parseBlockNum indexStr of
            Just n -> fromIntegral n
            Nothing -> 0 :: Int
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      return $ case mBlk of
        Just blk ->
          let txs = blockReceiptTransactions $ bPrimeToB blk
           in if idx < length txs
                then Just $ Transaction' (txs !! idx)
                else Nothing
        _ -> Nothing

eth_getTransactionReceipt :: Method Server
eth_getTransactionReceipt = toMethod "eth_getTransactionReceipt" f (Required "txHash" :+: ())
  where
    f :: String -> RpcResult Server (Maybe TransactionReceipt)
    f txHash = do
      let h = if take 2 txHash == "0x" then drop 2 txHash else txHash
      response <- liftIO $ runLocal $ TxResults.getTransactionResultClient (keccak256FromHex h)
      case response of
        Right (tr : _) -> return (Just (TransactionReceipt tr))
        Right [] -> return Nothing
        Left err -> throwError $ rpcError (-32603) (formatClientError err)

eth_getUncleByBlockHashAndIndex :: Method Server
eth_getUncleByBlockHashAndIndex = toMethod "eth_getUncleByBlockHashAndIndex" f ()
  where
    f :: RpcResult Server (Maybe Block')
    f = return Nothing

eth_getUncleByBlockNumberAndIndex :: Method Server
eth_getUncleByBlockNumberAndIndex = toMethod "eth_getUncleByBlockNumberAndIndex" f ()
  where
    f :: RpcResult Server (Maybe Block')
    f = return Nothing

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
