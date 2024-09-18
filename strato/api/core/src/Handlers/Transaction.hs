{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Transaction
  ( TxsFilterParams (..),
    txsFilterParams,
    API,
    getTransaction,
    getTransaction',
    postTransaction,
    postTransactionList,
    server,
  )
where

-- import           Servant.Client

import BlockApps.Logging
import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Data.TXOrigin
import Blockchain.Data.Transaction
import Blockchain.EthConf (runKafkaMConfigured)
import Blockchain.Sequencer.Event (IngestEvent (IETx), IngestTx (..), Timestamp)
import Blockchain.Sequencer.Kafka (writeUnseqEvents)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256 hiding (hash)
import Blockchain.Strato.Model.MicroTime (getCurrentMicrotime)
import Control.DeepSeq
import qualified Control.Exception as E
import Control.Monad (when)
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import Control.Monad.IO.Class
import Data.Aeson
import qualified Data.Binary as Bin
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Conduit
import Data.Conduit.Combinators (yieldMany)
import Data.List
import Data.Maybe
import qualified Data.Text as T
import qualified Database.Esqueleto.Legacy as E
import MaybeNamed
import Numeric.Natural
import SQLM
import Servant
import Settings
import SortDirection
import System.Clock
import Text.Format
import UnliftIO

type API =
  "transaction" :> QueryParam "address" Address
    :> QueryParam "from" Address
    :> QueryParam "to" Address
    :> QueryParam "hash" Keccak256
    :> QueryParam "gasprice" Natural
    :> QueryParam "mingasprice" Natural
    :> QueryParam "maxgasprice" Natural
    :> QueryParam "gaslimit" Natural
    :> QueryParam "mingaslimit" Natural
    :> QueryParam "maxgaslimit" Natural
    :> QueryParam "value" Natural
    :> QueryParam "minvalue" Natural
    :> QueryParam "maxvalue" Natural
    :> QueryParam "blocknumber" Natural
    :> QueryParam "chainid" (MaybeNamed ChainId)
    :> QueryParams "chainids" ChainId
    :> QueryParam "sortby" Sortby
    :> Get '[JSON] [RawTransaction']
    :<|> "transaction"
    :> ReqBody '[JSON] RawTransaction'
    :> Post '[JSON, PlainText] Keccak256

data TxsFilterParams = TxsFilterParams
  { qtAddress :: Maybe Address,
    qtFrom :: Maybe Address,
    qtTo :: Maybe Address,
    qtHash :: Maybe Keccak256,
    qtGasPrice :: Maybe Natural,
    qtMinGasPrice :: Maybe Natural,
    qtMaxGasPrice :: Maybe Natural,
    qtGasLimit :: Maybe Natural,
    qtMinGasLimit :: Maybe Natural,
    qtMaxGasLimit :: Maybe Natural,
    qtValue :: Maybe Natural,
    qtMinValue :: Maybe Natural,
    qtMaxValue :: Maybe Natural,
    qtBlockNumber :: Maybe Natural,
    qtChainId :: Maybe (MaybeNamed ChainId),
    qtChainIds :: [ChainId],
    qtSortby :: Maybe Sortby
  }
  deriving (Eq, Ord, Show)

txsFilterParams :: TxsFilterParams
txsFilterParams =
  TxsFilterParams
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    []
    Nothing

server :: (MonadLogger m, HasSQL m) => Int -> ServerT API m
server txSizeLimit = getTransaction :<|> postTransaction (Just txSizeLimit)

---------------------------

data NamedChainId
  = UnnamedChainIds [ChainId]
  | MainChain
  | AllChains

instance HasSQL m => Selectable TxsFilterParams [RawTransaction] m where
  select _ t@TxsFilterParams {..}
    | t == txsFilterParams = throwIO . NoFilterError $ "Need one of: " ++ intercalate ", " transactionQueryParams
    | otherwise = do
      chainids <-
        case (qtChainId, qtChainIds) of
          (Nothing, []) -> pure MainChain
          (Nothing, cids) -> pure $ UnnamedChainIds cids
          (Just c, []) -> case c of
            Unnamed cid -> pure $ UnnamedChainIds [cid]
            Named "main" -> pure MainChain
            Named "all" -> pure AllChains
            Named name -> throwIO . NamedChainError $ "Expected chainid to be named 'main' or 'all', but got '" <> name <> "'."
          _ -> throwIO $ AmbiguousChainError "You can not use both the chainid and chainids parameters togther."

      txs <- fmap (map E.entityVal) . sqlQuery $
        E.select $
          E.from $ \(rawTx) -> do
            let criteria =
                  catMaybes
                    [ fmap (\v -> rawTx E.^. RawTransactionFromAddress E.==. E.val v E.||. rawTx E.^. RawTransactionToAddress E.==. E.val (Just v)) qtAddress,
                      fmap (\v -> rawTx E.^. RawTransactionFromAddress E.==. E.val v) qtFrom,
                      fmap (\v -> rawTx E.^. RawTransactionToAddress E.==. E.val (Just v)) qtTo,
                      fmap (\v -> rawTx E.^. RawTransactionTxHash E.==. E.val v) qtHash,
                      fmap (\v -> rawTx E.^. RawTransactionGasPrice E.==. E.val v) (fromIntegral <$> qtGasPrice),
                      fmap (\v -> rawTx E.^. RawTransactionGasPrice E.>=. E.val v) (fromIntegral <$> qtMinGasPrice),
                      fmap (\v -> rawTx E.^. RawTransactionGasPrice E.<=. E.val v) (fromIntegral <$> qtMaxGasPrice),
                      fmap (\v -> rawTx E.^. RawTransactionGasLimit E.==. E.val v) (fromIntegral <$> qtGasLimit),
                      fmap (\v -> rawTx E.^. RawTransactionGasLimit E.>=. E.val v) (fromIntegral <$> qtMinGasLimit),
                      fmap (\v -> rawTx E.^. RawTransactionGasLimit E.<=. E.val v) (fromIntegral <$> qtMaxGasLimit),
                      fmap (\v -> rawTx E.^. RawTransactionValue E.==. E.val v) (fromIntegral <$> qtValue),
                      fmap (\v -> rawTx E.^. RawTransactionValue E.>=. E.val v) (maybe (Just 0) (Just . fromIntegral) qtMinValue),
                      fmap (\v -> rawTx E.^. RawTransactionValue E.<=. E.val v) (fromIntegral <$> qtMaxValue),
                      fmap (\v -> rawTx E.^. RawTransactionBlockNumber E.==. E.val v) (fromIntegral <$> qtBlockNumber)
                    ]

            E.where_ ((foldl1 (E.&&.) criteria)) -- map (getTransFilter rawTx) $ getParameters ))
            let matchChainId (ChainId cid) = ((rawTx E.^. RawTransactionChainId) E.==. (E.val cid))
                chainCriteria = case chainids of
                  MainChain -> [rawTx E.^. RawTransactionChainId E.==. E.val 0]
                  UnnamedChainIds cids -> matchChainId <$> cids
                  AllChains -> []
                allCriteria = case chainCriteria of
                  [] -> [criteria]
                  _ -> map (\cc -> cc : criteria) chainCriteria
            -- FIXME: if more than `limit` transactions per block, we will need to have a tuple as index
            E.where_ (foldl1 (E.||.) (map (foldl1 (E.&&.)) allCriteria))

            -- E.offset $ (limit * offset)
            E.limit $ appFetchLimit
            E.orderBy $
              [ (sortToOrderBy qtSortby) $ (rawTx E.^. RawTransactionBlockNumber),
                (sortToOrderBy qtSortby) $ (rawTx E.^. RawTransactionNonce)
              ]

            return rawTx

      return . Just $ nub txs

postTransactionC :: (MonadIO m, MonadLogger m) => Maybe Int -> RawTransaction' -> ConduitT a IngestEvent m Keccak256
postTransactionC limit (RawTransaction' raw "") = do
  let tx' = rawTX2TX raw
      h = transactionHash tx'
  ts <- liftIO getCurrentMicrotime
  let ieTx = IETx ts $ IngestTx API tx'
      payloadSize = B.length $ BL.toStrict $ Bin.encode ieTx
  when (isJust limit && payloadSize >= (fromJust limit)) $
    throwIO $ TxSizeError $ T.pack $ "The transaction size limit is " ++ (show $ fromJust limit) ++ " but your transaction size is " ++ show payloadSize
  yield ieTx
  $logInfoS "postTransaction" . T.pack $ "Successfully inserted tx: " ++ format h
  return h
postTransactionC _ _ =
  throwIO $ DeprecatedError "The 'next' parameter is no longer supported"

postTransaction ::
  (MonadIO m, MonadLogger m) =>
  Maybe Int ->
  RawTransaction' ->
  m Keccak256
postTransaction limit rt = runConduit $ postTransactionC limit rt `fuseUpstream` emitKafkaTransactions

postTransactionListC :: (MonadIO m, MonadLogger m) => Maybe Int -> [RawTransaction'] -> ConduitT a IngestEvent m [Keccak256]
postTransactionListC limit raws = do
  handlerStart <- liftIO $ getTime Realtime

  parserStart <- liftIO $ getTime Realtime

  txHashStart <- raws `deepseq` (liftIO $ getTime Realtime)
  let txs = fmap (\(RawTransaction' raw _) -> rawTX2TX $ raw) raws
      hs = fmap (toJSON . transactionHash) txs
      txr = filter success $ zip hs txs
  let num = length txs
  $logDebug $ T.pack $ show num ++ " incoming transactions..."
  let num' = length $ filter (not . success) $ zip hs txs
  $logDebug $ T.pack $ "Inserted " ++ (show (num - num')) ++ " of the transactions"
  $logDebug $ T.pack $ "Kafkaing txs: \n" ++ (unlines $ format <$> ((transactionHash . snd) <$> txr))
  ts <- liftIO getCurrentMicrotime
  ieTxs <- makeEncodedTxs ts txs limit
  yieldMany ieTxs
  sendResponseStart <- liftIO $ getTime Realtime
  let times =
        ( map toNanoSecs $
            [ parserStart - handlerStart,
              txHashStart - parserStart,
              sendResponseStart - txHashStart
            ]
        ) -- ++ [ecRecoverTime]
  $logDebug $ T.pack $ "Timings in nanoseconds: " ++ show times
  return $ transactionHash <$> txs -- hs --times -- This is for debugging
  where
    success (a, _) =
      case a of
        String _ -> True
        _ -> False

makeEncodedTxs :: (MonadIO m) => Timestamp -> [Transaction] -> Maybe Int -> m [IngestEvent]
makeEncodedTxs ts txs limit =
  pure $
    map
      ( \tx ->
          let ieTx = IETx ts $ IngestTx API tx
              payloadSize = B.length $ BL.toStrict $ Bin.encode ieTx
          in if (isJust limit && payloadSize >= (fromJust limit))
                then E.throw $ TxSizeError $ T.pack $ "The transaction size limit is " ++ (show $ fromJust limit) ++ " but your transaction size is " ++ show payloadSize
                else ieTx
      )
      txs

postTransactionList ::
  (MonadIO m, MonadLogger m) =>
  Maybe Int ->
  [RawTransaction'] ->
  m [Keccak256]
postTransactionList limit rts = runConduit $ postTransactionListC limit rts `fuseUpstream` emitKafkaTransactions

getTransaction ::
  Selectable TxsFilterParams [RawTransaction] m =>
  Maybe Address ->
  Maybe Address ->
  Maybe Address ->
  Maybe Keccak256 ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe (MaybeNamed ChainId) ->
  [ChainId] ->
  Maybe Sortby ->
  m [RawTransaction']
getTransaction a b c d e f g h i j k l m n o p q =
  getTransaction' (TxsFilterParams a b c d e f g h i j k l m n o p q)

getTransaction' ::
  Selectable TxsFilterParams [RawTransaction] m =>
  TxsFilterParams ->
  m [RawTransaction']
getTransaction' a = map rtToRtPrime . zip (repeat "") . fromMaybe [] <$> select (Proxy @[RawTransaction]) a

transactionQueryParams :: [String]
transactionQueryParams =
  [ "address",
    "from",
    "to",
    "hash",
    "gasprice",
    "mingasprice",
    "maxgasprice",
    "gaslimit",
    "mingaslimit",
    "maxgaslimit",
    "value",
    "minvalue",
    "maxvalue",
    "blocknumber",
    -- "index",
    --"rejected",
    "[chainids]",
    "chainid"
  ]

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => ConduitT IngestEvent Void m ()
emitKafkaTransactions = loop id
  where
    -- this is essentially the same as sinkList,
    -- except emitting to Kafka instead of returning the list
    loop front = await >>= maybe (emit $ front []) (\x -> loop $ front . (x :))
    emit txs = do
      $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ show (length txs) ++ " faucet tx(s) to unseqevents"
      resps <- liftIO $ runKafkaMConfigured "strato-api" $ writeUnseqEvents txs
      $logDebug $ T.pack $ "writeUnseqEventsEnd Kafka commit: " ++ show resps
