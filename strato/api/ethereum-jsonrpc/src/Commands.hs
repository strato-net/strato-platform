{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications  #-}

module Commands
  ( methods,
  )
where

import Binary
import CallTrace (BlockTrace(..), mkCallFrame)
import EthBlock (EthBlock(..))
import EthLog (EthLog, eventRowToLog, eventRowToLogMaybe, ethLogsBloom, matchesTopics)
import Blockchain.Data.LogsBloom (emptyLogsBloom)
import TransactionReceipt (TransactionReceipt, EthHex(..), mkTransactionReceipt, transactionIndex)
import Strato.Version (stratoVersion)
import Blockchain.CommunicationConduit (ethVersion)
import Blockchain.EthConf (runStreamMConfigured, ethConf)
import qualified Blockchain.EthConf.Model as EthConf
import Blockchain.EthConf.Model (apiConfig, apiListenAddress, apiPort, networkConfig, networkID, contractsConfig, nativeTokenAddress)
import Blockchain.Data.Block (Block, blockBlockData, blockReceiptTransactions)
import qualified Blockchain.Strato.Model.Class as Class
import Blockchain.Data.BlockHeader (BlockHeader (..), clearBlockSignatures, getBlockSignatures)
import Blockchain.Data.DataDefs (AddressStateRef (..), TransactionResult(..))
import Blockchain.Data.RLP (rlpDecode, rlpDeserialize, rlpEncode, rlpSerialize)
import Blockchain.Strato.Model.Secp256k1 (exportSignature)
import Data.Aeson (ToJSON(..), (.=), object)
import Blockchain.Data.Transaction (Transaction(..), transactionHash, txAndTime2RawTX)
import Blockchain.Data.TXOrigin (TXOrigin(API))
import Blockchain.Model.JsonBlock (AddressStateRef' (..), Block', RawTransaction'(..), Transaction'(..), bPrimeToB)
import Blockchain.Sequencer.CallSpec (CallSpec(..), TraceOptions(..), TxCreateObject(..), TxFuncCallObject(..))
import Blockchain.Sequencer.Event (JsonRpcCommand(..), JsonRpcResponse(..), VmTask(..))
import Blockchain.Sequencer.Kafka (writeSeqVmTasks)
import Blockchain.Strato.Model.Address (Address(..), addressToHex)
import Blockchain.Strato.Model.Keccak256 (Keccak256, hash, keccak256FromHex, keccak256ToByteString, keccak256ToHex)
import Text.Format (format)
import Control.Exception (SomeException, evaluate, try)
import Control.Monad (void, when, zipWithM)
import Control.Monad.IO.Class
import Control.Monad.Composable.Streaming (consumeFromLatest)
import Control.Monad.Except
import Blockchain.Sequencer.HexData (HexData(..))
import qualified Blockchain.Sequencer.TxCallObject as TxCall
import Blockchain.Sequencer.TxCallObject (TxCallObject(..))
import qualified Handlers.AccountInfo as Accounts
import qualified Handlers.Transaction as Tx
import qualified Handlers.BlkLast as BlkLast
import qualified Handlers.Block as Blocks
import qualified Handlers.Receipts as Receipts
import qualified Handlers.TransactionResult as TxResults
import System.Random (randomRIO)
import System.Timeout (timeout)
import qualified Data.Binary as Bin
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Time.Calendar (fromGregorian)
import Data.Time.Clock (UTCTime(..))
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import Data.Char (toLower)
import Data.Word (Word64)
import Data.List (find)
import Data.Maybe (catMaybes)
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Aeson (FromJSON(..), Value(..), decodeStrict, withObject, (.:), (.:?), (.!=))
import qualified Data.Aeson as Ae
import GHC.Generics (Generic)
import Network.JsonRpc.Server
import Numeric (showHex)
import Prelude
import Network.HTTP.Client (Manager, newManager, defaultManagerSettings)
import Network.HTTP.Types.Status (statusCode, statusMessage)
import Servant.Client (BaseUrl (..), ClientError(..), ClientM, ResponseF(..), Scheme (Http), mkClientEnv, runClientM)
import System.IO.Unsafe (unsafePerformIO)
import Control.Monad.Composable.CodeDB (runCodeDBM, queryEvents, queryEventsByTxHash)

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

-- | A single, process-wide HTTP connection manager. An http-client 'Manager'
-- is a connection pool and is designed to be created once and shared for the
-- lifetime of the process. Creating a new one per request (as this used to do)
-- leaks keep-alive sockets to the backend until GC finalizers run, exhausting
-- file descriptors under load. NOINLINE keeps this a single CAF.
{-# NOINLINE sharedManager #-}
sharedManager :: Manager
sharedManager = unsafePerformIO $ newManager defaultManagerSettings

runLocal :: ClientM a -> IO (Either ClientError a)
runLocal action = runClientM action (mkClientEnv sharedManager apiBaseUrl)

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
    strato_getFinalizedHeader,
    strato_getReceiptProof,
    strato_simulateV1,
    strato_traceCall,
    strato_traceTransaction,
    strato_traceBlock,
    strato_traceBlockByHash,
    strato_traceBlockByNumber,
    eth_estimateGas,
    eth_getBlockByHash,
    eth_getBlockByNumber,
    eth_getTransactionByHash,
    eth_getTransactionByBlockHashAndIndex,
    eth_getTransactionByBlockNumberAndIndex,
    eth_getTransactionReceipt,
    eth_getBlockReceipts,
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
    debug_traceBlockByHash
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
          ("strato", "1.0"),
          ("txpool", "1.0"),
          ("web3", "1.0")
        ]

web3_clientVersion :: Method Server
web3_clientVersion = flip (toMethod "web3_clientVersion") () $ do
  liftIO $ return $ "STRATO/v" ++ stratoVersion ++ "/linux/Haskell"

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
getBlockNumber = number . blockBlockData . bPrimeToB

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

-- | Response-topic correlation ids must be unique across concurrent
-- requests: two clients simulating identical payloads would otherwise match
-- each other's responses. The prefix is kept for log readability.
mkRpcId :: MonadIO m => String -> m String
mkRpcId prefix = do
  n <- liftIO $ randomRIO (0, maxBound :: Word64)
  return $ prefix ++ "_" ++ showHex n ""

callVM :: JsonRpcCommand -> IO JsonRpcResponse
callVM = callVM' 30000000

-- | strato_trace* and strato_simulateV1 replay or trace whole executions, so
-- they get a much longer deadline than plain calls.
debugCallTimeout :: Int
debugCallTimeout = 120000000

callVM' :: Int -> JsonRpcCommand -> IO JsonRpcResponse
callVM' waitMicros c = do
  putStrLn $ "callVM: " ++ show (jrcId c)
  result <- timeout waitMicros $ runStreamMConfigured "ethereum-jsonrpc" $
    consumeFromLatest "jsonrpcresponse"
      (void $ writeSeqVmTasks [VmJsonRpcCommand c])
      (\responses ->
        let matched = filter ((jrcId c ==) . fst) (responses :: [(String, B.ByteString)])
        in case matched of
          ((_, val) : _) -> return $ Just $ Bin.decode (BL.fromStrict val)
          [] -> return Nothing
      )
  return $ case result of
    Just resp -> resp
    Nothing -> Error (jrcId c) "timeout waiting for vm-runner response"

eth_getBalance :: Method Server
eth_getBalance = toMethod "eth_getBalance" f (Required "address" :+: Required "blockString" :+: ())
  where
    balanceOfSelector = "70a08231"

    nativeAddr = nativeTokenAddress (contractsConfig ethConf)

    f :: Address -> String -> RpcResult Server String
    f addr _blockString = do
          let padding = BC.replicate 24 '0'
              calldataHex = balanceOfSelector <> padding <> addressToHex addr
              calldata = case B16.decode calldataHex of
                Right bs -> bs
                Left _ -> B.empty
              txObj = TxCallObject
                { TxCall.from = Address 0
                , TxCall.to = Just nativeAddr
                , TxCall.gas = "0x0"
                , TxCall.gasPrice = "0x0"
                , TxCall.value = "0x0"
                , TxCall.data_ = HexData calldata
                }
          rpcId <- mkRpcId $ "eth_getBalance_" ++ showHex addr ""
          resp <- liftIO $ callVM $ JRCCall txObj rpcId "latest"
          case resp of
            Success _ result | B.length result == 32 -> do
              let balance = foldl (\acc b -> acc * 256 + fromIntegral b) (0 :: Integer) (B.unpack result)
              return $ "0x" ++ showHex balance ""
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
eth_call = toMethod "eth_call" f (Required "txObject" :+: Optional "blockTag" "latest" :+: ())
  where
    f :: CallSpec -> String -> RpcResult Server String
    f spec blockTag = do
      mHeader <- resolveBlockHeader blockTag
      rpcId <- mkRpcId $ case spec of
            SpecCall txObj ->
              "eth_call_" ++ take 16 (BC.unpack $ B16.encode $ unHexData $ TxCall.data_ txObj)
            SpecCreate createObj ->
              "eth_create_" ++ take 16 (T.unpack $ createContractName createObj)
            SpecFuncCall fObj ->
              "eth_call_" ++ take 16 (T.unpack $ funcCallFunctionName fObj)
      liftIO $ putStrLn $ "eth_call: block=" ++ blockTag ++ " id=" ++ rpcId
      resp <- liftIO $ callVM $ JRCCallV2 spec mHeader rpcId
      case resp of
        Success _ result -> return $ "0x" ++ BC.unpack (B16.encode result)
        SuccessJson _ _ -> throwError $ rpcError (-32603) "unexpected JSON response from VM"
        Error _ msg -> do
          liftIO $ putStrLn $ "eth_call: vm-runner error: " ++ msg
          throwError $ rpcError 3 (T.pack $ "execution reverted: " ++ msg)

-- | Resolve a block tag ("latest"/"pending"/"earliest", a hex number, or a
-- block hash) to the header the VM should execute against. Nothing means the
-- VM's current best block.
resolveBlockHeader :: String -> RpcResult Server (Maybe BlockHeader)
resolveBlockHeader tag
  | tag `elem` ["latest", "pending", ""] = return Nothing
  | length stripped == 64 = fetch $ fetchBlockByHash tag
  | otherwise = fetch $ fetchBlockByNumber tag
  where
    stripped = if take 2 tag == "0x" then drop 2 tag else tag
    fetch io =
      liftIO io >>= \case
        Just blk -> return $ Just $ blockBlockData $ bPrimeToB blk
        Nothing -> throwError $ rpcError (-32602) (T.pack $ "block not found: " ++ tag)

-- strato_simulateV1 (eth_simulateV1-shaped): blockStateCalls executed
-- sequentially in one VM sandbox, so later calls see earlier calls' state;
-- everything is discarded afterwards. stateOverrides, blockOverrides,
-- validation and traceTransfers are rejected during parameter parsing.
newtype SimBlockCalls = SimBlockCalls { sbcCalls :: [CallSpec] }

instance FromJSON SimBlockCalls where
  parseJSON = withObject "blockStateCalls entry" $ \o -> do
    mSO <- o .:? "stateOverrides"
    mBO <- o .:? "blockOverrides"
    case (mSO :: Maybe Value, mBO :: Maybe Value) of
      (Just _, _) -> fail "strato_simulateV1: stateOverrides is not supported"
      (_, Just _) -> fail "strato_simulateV1: blockOverrides is not supported"
      _ -> SimBlockCalls <$> o .:? "calls" .!= []

newtype SimPayload = SimPayload [SimBlockCalls]

instance FromJSON SimPayload where
  parseJSON = withObject "strato_simulateV1 payload" $ \o -> do
    validation <- o .:? "validation" .!= False
    traceTransfers <- o .:? "traceTransfers" .!= False
    when validation $ fail "strato_simulateV1: validation is not supported"
    when traceTransfers $ fail "strato_simulateV1: traceTransfers is not supported"
    SimPayload <$> o .: "blockStateCalls"

strato_simulateV1 :: Method Server
strato_simulateV1 = toMethod "strato_simulateV1" f (Required "payload" :+: Optional "blockTag" "latest" :+: ())
  where
    f :: SimPayload -> String -> RpcResult Server Value
    f (SimPayload blocks) blockTag = do
      when (length blocks > 16) . throwError $
        rpcError (-32602) "strato_simulateV1: too many blockStateCalls entries (max 16)"
      when (sum (map (length . sbcCalls) blocks) > 64) . throwError $
        rpcError (-32602) "strato_simulateV1: too many calls (max 64)"
      mBlk <- liftIO $ fetchBlockByNumber blockTag
      blk' <- case mBlk of
        Just b -> return b
        Nothing -> throwError $ rpcError (-32602) (T.pack $ "block not found: " ++ blockTag)
      let header = blockBlockData $ bPrimeToB blk'
          baseNum = getBlockNumber blk'
          baseTime = floor . utcTimeToPOSIXSeconds $ getBlockTimestamp blk' :: Integer
          hexIt n = "0x" ++ showHex n ""
      rpcId <- mkRpcId "strato_simulateV1"
      resp <- liftIO $ callVM' debugCallTimeout $ JRCSimulate (map sbcCalls blocks) (Just header) rpcId
      v <- decodeTraceResponse resp
      case Ae.fromJSON v :: Ae.Result [[Value]] of
        Ae.Error e -> throwError $ rpcError (-32603) (T.pack $ "bad simulate payload: " ++ e)
        Ae.Success callResults ->
          return $ toJSON
            [ Ae.object
                [ "number" .= hexIt (baseNum + toInteger i),
                  "timestamp" .= hexIt (baseTime + toInteger i),
                  "calls" .= calls
                ]
            | (i, calls) <- zip [1 :: Int ..] callResults
            ]

getBlockTimestamp :: Block' -> UTCTime
getBlockTimestamp = timestamp . blockBlockData . bPrimeToB

strato_traceCall :: Method Server
strato_traceCall = toMethod "strato_traceCall" f (Required "txObject" :+: Optional "blockTag" "latest" :+: Optional "traceConfig" (TraceOptions False) :+: ())
  where
    f :: CallSpec -> String -> TraceOptions -> RpcResult Server Value
    f spec blockTag opts = do
      mHeader <- resolveBlockHeader blockTag
      rpcId <- mkRpcId $ case spec of
            SpecCall txObj ->
              "strato_traceCall_" ++ take 16 (BC.unpack $ B16.encode $ unHexData $ TxCall.data_ txObj)
            SpecCreate createObj ->
              "strato_traceCreate_" ++ take 16 (T.unpack $ createContractName createObj)
            SpecFuncCall fObj ->
              "strato_traceCall_" ++ take 16 (T.unpack $ funcCallFunctionName fObj)
      resp <- liftIO $ callVM' debugCallTimeout $ JRCTraceCall spec mHeader opts rpcId
      decodeTraceResponse resp

-- | Unwrap a SuccessJson payload from the VM into the JSON-RPC result.
decodeTraceResponse :: JsonRpcResponse -> RpcResult Server Value
decodeTraceResponse = \case
  SuccessJson _ bytes -> case decodeStrict bytes of
    Just v -> return v
    Nothing -> throwError $ rpcError (-32603) "invalid trace payload from VM"
  Error _ msg -> throwError $ rpcError (-32000) (T.pack msg)
  Success _ _ -> throwError $ rpcError (-32603) "unexpected binary response from VM"

-- | Ship a block's header and transactions to the VM for sandboxed replay,
-- tracing the target transaction (or every transaction when Nothing).
traceBlockVia :: String -> Block -> Maybe Keccak256 -> TraceOptions -> RpcResult Server Value
traceBlockVia idPrefix blk mTarget opts = do
  let header = blockBlockData blk
      txs = blockReceiptTransactions blk
  rpcId <- mkRpcId idPrefix
  resp <- liftIO $ callVM' debugCallTimeout $ JRCTraceBlockTxs header txs mTarget opts rpcId
  decodeTraceResponse resp

strato_traceTransaction :: Method Server
strato_traceTransaction = toMethod "strato_traceTransaction" f (Required "txHash" :+: Optional "traceConfig" (TraceOptions False) :+: ())
  where
    f :: Keccak256 -> TraceOptions -> RpcResult Server Value
    f txHash opts = do
      response <- liftIO $ runLocal $ TxResults.getTransactionResultClient txHash
      case response of
        Right (tr : _) -> do
          mBlk <- liftIO $ fetchBlockByHash (keccak256ToHex (transactionResultBlockHash tr))
          case mBlk of
            Just blk ->
              traceBlockVia
                ("strato_traceTransaction_" ++ take 16 (keccak256ToHex txHash))
                (bPrimeToB blk)
                (Just txHash)
                opts
            Nothing -> throwError $ rpcError (-32602) "block not found for transaction"
        Right [] -> throwError $ rpcError (-32602) "transaction not found"
        Left err -> throwError $ rpcError (-32603) (formatClientError err)

strato_traceBlockByHash :: Method Server
strato_traceBlockByHash = toMethod "strato_traceBlockByHash" f (Required "blockHash" :+: Optional "traceConfig" (TraceOptions False) :+: ())
  where
    f :: String -> TraceOptions -> RpcResult Server Value
    f blockHash opts = do
      mBlk <- liftIO $ fetchBlockByHash blockHash
      case mBlk of
        Just blk -> traceBlockVia ("strato_traceBlockByHash_" ++ take 24 blockHash) (bPrimeToB blk) Nothing opts
        Nothing -> throwError $ rpcError (-32602) (T.pack $ "block not found: " ++ blockHash)

strato_traceBlockByNumber :: Method Server
strato_traceBlockByNumber = toMethod "strato_traceBlockByNumber" f (Required "blockNumber" :+: Optional "traceConfig" (TraceOptions False) :+: ())
  where
    f :: String -> TraceOptions -> RpcResult Server Value
    f blockNumber opts = do
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      case mBlk of
        Just blk -> traceBlockVia ("strato_traceBlockByNumber_" ++ blockNumber) (bPrimeToB blk) Nothing opts
        Nothing -> throwError $ rpcError (-32602) (T.pack $ "block not found: " ++ blockNumber)

strato_traceBlock :: Method Server
strato_traceBlock = toMethod "strato_traceBlock" f (Required "rlpBlock" :+: Optional "traceConfig" (TraceOptions False) :+: ())
  where
    f :: String -> TraceOptions -> RpcResult Server Value
    f rlpHex opts = do
      let hexStr = if take 2 rlpHex == "0x" then drop 2 rlpHex else rlpHex
      case B16.decode (BC.pack hexStr) of
        Left e -> throwError $ rpcError (-32602) (T.pack $ "invalid hex: " ++ e)
        Right bytes -> do
          -- rlpDeserialize/rlpDecode are partial; force the decode here so a
          -- malformed block surfaces as an RPC error instead of a crash.
          eBlk <- liftIO . try @SomeException . evaluate $
            let blk = rlpDecode (rlpDeserialize bytes) :: Block
             in length (show blk) `seq` blk
          case eBlk of
            Left err -> throwError $ rpcError (-32602) (T.pack $ "invalid RLP block: " ++ show err)
            Right blk -> traceBlockVia "strato_traceBlock_rlp" blk Nothing opts

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
    f :: String -> Bool -> RpcResult Server (Maybe EthBlock)
    f blockHash fullTxs = do
      mBlk <- liftIO $ fetchBlockByHash blockHash
      return $ (\blk -> toEthBlock (blockBloom blk) fullTxs blk) <$> mBlk

eth_getBlockByNumber :: Method Server
eth_getBlockByNumber = toMethod "eth_getBlockByNumber" f (Required "blockNumber" :+: Required "fullTransactions" :+: ())
  where
    f :: String -> Bool -> RpcResult Server (Maybe EthBlock)
    f blockNumber fullTxs = do
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      return $ (\blk -> toEthBlock (blockBloom blk) fullTxs blk) <$> mBlk

-- | Select the Ethereum block representation based on the @fullTransactions@ flag.
toEthBlock :: B.ByteString -> Bool -> Block' -> EthBlock
toEthBlock bloom fullTxs = (if fullTxs then EthBlockWithFullTxs else EthBlockWithTxHashes) bloom . bPrimeToB

-- | Resolve a block's @logsBloom@ for the Ethereum RPC shape. STRATO
-- historically stored a dummy bloom in block headers; serve the stored value
-- only when it is a real 256-byte non-empty bloom (as written by the block
-- producer going forward), otherwise a null bloom. Receipts (not blocks) carry
-- the compute-at-read bloom for historical blocks, so this stays a cheap pure
-- check and does not add a Cirrus round-trip to every block lookup.
blockBloom :: Block' -> B.ByteString
blockBloom blk =
  let stored = Class.blockHeaderLogsBloom (blockBlockData (bPrimeToB blk))
  in if B.length stored == 256 && B.any (/= 0) stored then stored else emptyLogsBloom

-- | Reconstruct a transaction's logs from the Cirrus @event@ table, skipping any
-- event that cannot be resolved (missing code / event def) so one bad event does
-- not fail the whole receipt.
txEthLogs :: Keccak256 -> RpcResult Server [EthLog]
txEthLogs txHash = do
  rows <- runCodeDBM $ queryEventsByTxHash (T.pack (keccak256ToHex txHash)) (maxLogResults + 1)
  catMaybes <$> runCodeDBM (mapM eventRowToLogMaybe rows)

-- | Hex-encoded (@0x@-prefixed) Ethereum logs bloom for a set of logs.
logsBloomHex :: [EthLog] -> String
logsBloomHex ls = "0x" ++ BC.unpack (B16.encode (ethLogsBloom ls))

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
    f :: Keccak256 -> RpcResult Server (Maybe TransactionReceipt)
    f txHash = do
      response <- liftIO $ runLocal $ TxResults.getTransactionResultClient txHash
      case response of
        Right (tr : _) -> Just <$> buildReceipt tr
        Right [] -> return Nothing
        Left err -> throwError $ rpcError (-32603) (formatClientError err)

    buildReceipt :: TransactionResult -> RpcResult Server TransactionReceipt
    buildReceipt tr = do
      mBlk <- liftIO $ fetchBlockByHash (keccak256ToHex (transactionResultBlockHash tr))
      let blkNum = maybe 0 getBlockNumber mBlk
          txs = maybe [] (blockReceiptTransactions . bPrimeToB) mBlk
      case find (\t -> transactionHash t == transactionResultTransactionHash tr) txs of
        Just tx -> do
          ethLogs <- txEthLogs (transactionResultTransactionHash tr)
          return $ mkTransactionReceipt tr tx blkNum (map toJSON ethLogs) (logsBloomHex ethLogs)
        Nothing -> throwError $ rpcError (-32603) "Transaction not found in block"

-- | All transaction receipts for a block. The block parameter is a 32-byte
-- block hash, a hex block number, or a tag (@latest@/@earliest@/@pending@);
-- returns @null@ when the block is unknown.
eth_getBlockReceipts :: Method Server
eth_getBlockReceipts = toMethod "eth_getBlockReceipts" f (Required "block" :+: ())
  where
    f :: String -> RpcResult Server (Maybe [TransactionReceipt])
    f blockParam = do
      mBlk <- liftIO $ fetchBlockForReceipts blockParam
      case mBlk of
        Nothing  -> return Nothing
        Just blk -> do
          let blkNum = getBlockNumber blk
              txs    = blockReceiptTransactions $ bPrimeToB blk
          Just <$> zipWithM (buildBlockReceipt blkNum) [0 ..] txs

    -- Disambiguate a 32-byte block hash (64 hex chars) from a number/tag.
    fetchBlockForReceipts :: String -> IO (Maybe Block')
    fetchBlockForReceipts param
      | length (dropHexPrefix param) == 64 = fetchBlockByHash param
      | otherwise                          = fetchBlockByNumber param

    dropHexPrefix ('0':'x':xs) = xs
    dropHexPrefix ('0':'X':xs) = xs
    dropHexPrefix xs           = xs

    buildBlockReceipt :: Integer -> Integer -> Transaction -> RpcResult Server TransactionReceipt
    buildBlockReceipt blkNum idx tx = do
      response <- liftIO $ runLocal $ TxResults.getTransactionResultClient (transactionHash tx)
      case response of
        Right (tr : _) -> do
          ethLogs <- txEthLogs (transactionHash tx)
          return $ (mkTransactionReceipt tr tx blkNum (map toJSON ethLogs) (logsBloomHex ethLogs)) { transactionIndex = EthHex idx }
        Right []       -> throwError $ rpcError (-32603) "receipt not found for transaction in block"
        Left err       -> throwError $ rpcError (-32603) (formatClientError err)

-- | @callTracer@-style trace of every transaction in a block. STRATO runs
-- SolidVM (no EVM opcodes), so the geth @structLogs@ tracer is impossible; we
-- return the same @callTracer@ frame regardless of the requested tracer. Each
-- entry carries the transaction @input@ (calldata, including any ERC-8021
-- suffix); @calls@ is empty (internal calls are not instrumented). The tracer
-- options argument is accepted and ignored. Returns @null@ for unknown blocks.
debug_traceBlockByHash :: Method Server
debug_traceBlockByHash = toMethod "debug_traceBlockByHash" f (Required "blockHash" :+: Optional "options" Null :+: ())
  where
    f :: String -> Value -> RpcResult Server (Maybe [BlockTrace])
    f blockHash _options = do
      mBlk <- liftIO $ fetchBlockByHash blockHash
      case mBlk of
        Nothing  -> return Nothing
        Just blk -> Just <$> mapM buildTrace (blockReceiptTransactions $ bPrimeToB blk)

    buildTrace :: Transaction -> RpcResult Server BlockTrace
    buildTrace tx = do
      response <- liftIO $ runLocal $ TxResults.getTransactionResultClient (transactionHash tx)
      case response of
        Right (tr : _) -> return $ BlockTrace (transactionHash tx) (mkCallFrame tr tx)
        Right []       -> throwError $ rpcError (-32603) "trace not found for transaction in block"
        Left err       -> throwError $ rpcError (-32603) (formatClientError err)

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

data LogFilter = LogFilter
  { lfFromBlock :: String
  , lfToBlock   :: String
  , lfAddress   :: Maybe String
  , lfTopics    :: [String]
  } deriving (Show, Generic)

maxLogBlockRange :: Integer
maxLogBlockRange = 10000

maxLogBlock :: Integer
maxLogBlock = 999999999

maxLogResults :: Int
maxLogResults = 1000

parseLogBlockNum :: String -> Maybe Integer
parseLogBlockNum "latest" = Just maxLogBlock
parseLogBlockNum "pending" = Just maxLogBlock
parseLogBlockNum block = parseBlockNum block

topic0EventName :: [String] -> Maybe T.Text
topic0EventName [] = Nothing
topic0EventName (topic0 : _)
  | null normalized = Nothing
  | otherwise = T.pack <$> lookup normalized standardEventTopics
  where
    normalized = map toLower $ strip0x topic0
    strip0x ('0':'x':xs) = xs
    strip0x ('0':'X':xs) = xs
    strip0x xs = xs

standardEventTopics :: [(String, String)]
standardEventTopics =
  [ (eventSignatureTopic "Approval(address,address,uint256)", "Approval"),
    (eventSignatureTopic "Transfer(address,address,uint256)", "Transfer")
  ]

eventSignatureTopic :: String -> String
eventSignatureTopic = keccak256ToHex . hash . BC.pack

instance FromJSON LogFilter where
  parseJSON = withObject "LogFilter" $ \o ->
    LogFilter
      <$> o .:? "fromBlock" .!= "latest"
      <*> o .:? "toBlock"   .!= "latest"
      <*> o .:? "address"
      <*> o .:? "topics"    .!= []

eth_getLogs :: Method Server
eth_getLogs = toMethod "eth_getLogs" f (Required "filter" :+: ())
  where
    f :: LogFilter -> RpcResult Server [Value]
    f filt = do
      let fromBlock = maybe 0 id $ parseLogBlockNum (lfFromBlock filt)
          toBlock   = maybe maxLogBlock id $ parseLogBlockNum (lfToBlock filt)
          mAddr     = fmap T.pack (lfAddress filt)
          mEventName = topic0EventName (lfTopics filt)
      when (toBlock >= fromBlock && toBlock - fromBlock > maxLogBlockRange) $
        throwError $ rpcError (-32602) $
          T.pack $
            "eth_getLogs block range exceeds " ++ show maxLogBlockRange ++ " blocks; use smaller ranges"
      rows <- runCodeDBM $ queryEvents mAddr fromBlock toBlock mEventName (maxLogResults + 1)
      when (length rows > maxLogResults) $
        throwError $ rpcError (-32602) $
          T.pack $
            "eth_getLogs result exceeds " ++ show maxLogResults ++ " candidate events; use smaller ranges or narrower filters"
      logs <- runCodeDBM $ mapM eventRowToLog rows
      let filtered = filter (matchesTopics (lfTopics filt)) logs
      return $ map toJSON filtered

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

-- ============================================================================
-- STRATO bridge JSON-RPC endpoints (Phase 0 spec §9)
--
-- These two methods feed the proof-based bridge withdrawal flow on Ethereum:
--
--  * strato_getFinalizedHeader -- provides what the on-chain STRATOLightClient
--    needs to advance its tip: the canonical RLP-encoded header (with the
--    signatures field emptied so the bytes match what validators signed) and
--    the original commit signatures.
--
--  * strato_getReceiptProof -- intended to provide the per-transaction MPT
--    inclusion proof against header.receiptsRoot. The receipts trie is empty
--    until the receipts-root fork lands (PR 4); until then this returns the
--    header info but null receipt and empty proof.
-- ============================================================================

data FinalizedHeaderResponse = FinalizedHeaderResponse
  { fhrHeaderRLP :: String
  , fhrSignatures :: [String]
  }

instance ToJSON FinalizedHeaderResponse where
  toJSON FinalizedHeaderResponse{..} = object
    [ "headerRLP" .= fhrHeaderRLP
    , "signatures" .= fhrSignatures
    ]

data ReceiptProofResponse = ReceiptProofResponse
  { rprHeaderRLP :: String
  , rprSignatures :: [String]
  , rprReceiptRLP :: Maybe String
  , rprMptProof :: [String]
  }

instance ToJSON ReceiptProofResponse where
  toJSON ReceiptProofResponse{..} = object
    [ "headerRLP" .= rprHeaderRLP
    , "signatures" .= rprSignatures
    , "receiptRLP" .= rprReceiptRLP
    , "mptProof" .= rprMptProof
    ]

bytesToHex :: B.ByteString -> String
bytesToHex bs = "0x" ++ BC.unpack (B16.encode bs)

-- Decompose a fetched block into the canonical-header bytes and the
-- commit-signature list. Used by both bridge endpoints below.
headerBytesAndSigs :: BlockHeader -> (String, [String])
headerBytesAndSigs hdr =
  let sigs = getBlockSignatures hdr
      hdrSansSigs = clearBlockSignatures hdr
      headerBytes = rlpSerialize (rlpEncode hdrSansSigs)
   in (bytesToHex headerBytes, map (bytesToHex . exportSignature) sigs)

strato_getFinalizedHeader :: Method Server
strato_getFinalizedHeader =
  toMethod "strato_getFinalizedHeader" f (Required "blockNumber" :+: ())
  where
    f :: String -> RpcResult Server (Maybe FinalizedHeaderResponse)
    f blockNumber = do
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      return $ case mBlk of
        Just blk' ->
          let hdr = blockBlockData (bPrimeToB blk')
              (rlpHex, sigsHex) = headerBytesAndSigs hdr
           in Just $ FinalizedHeaderResponse rlpHex sigsHex
        Nothing -> Nothing

strato_getReceiptProof :: Method Server
strato_getReceiptProof =
  toMethod "strato_getReceiptProof" f (Required "blockNumber" :+: Required "txIndex" :+: ())
  where
    f :: String -> Int -> RpcResult Server (Maybe ReceiptProofResponse)
    f blockNumber txIndex = do
      mBlk <- liftIO $ fetchBlockByNumber blockNumber
      case mBlk of
        Nothing -> return Nothing
        Just blk' -> do
          let hdr = blockBlockData (bPrimeToB blk')
              (rlpHex, sigsHex) = headerBytesAndSigs hdr
          -- Delegate proof generation to the REST endpoint. The receipts trie
          -- is rebuilt server-side from the receipt_ref table; pre-fork
          -- blocks return an empty proof (because receipt_ref has nothing
          -- for them and the rebuilt trie is empty), which the on-chain
          -- verifier will reject -- as expected pre-fork.
          let blkHash = Class.blockHash (bPrimeToB blk')
          response <- liftIO $ runLocal $ Receipts.getReceiptProofByHashClient blkHash txIndex
          case response of
            Right pr ->
              return $ Just $
                ReceiptProofResponse
                  rlpHex
                  sigsHex
                  (Just (Receipts.rprReceiptRLP pr))
                  (Receipts.rprMptProof pr)
            Left _ ->
              -- Likely a 404 (no receipt at that index, or no block with
              -- that hash). Fall back to header-only response so callers can
              -- still drive the light client.
              return $ Just $ ReceiptProofResponse rlpHex sigsHex Nothing []
