{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}


module Handlers.Transaction
  ( TxsFilterParams (..)
  , txsFilterParams
  , API
  , getTxsFilter
  , postTx
  , postTxList
  , server
  ) where

import           Control.DeepSeq
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Data.Aeson
import           Data.Conduit
import           Data.Conduit.Combinators    (yieldMany)
import           Data.List
import           Data.Maybe
import qualified Data.Text                   as T
import qualified Database.Esqueleto          as E
import           MaybeNamed
import           Numeric.Natural
import           Servant
import           Servant.Client
import           System.Clock
import           Text.Format

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Output
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Keccak256 hiding (hash)
import           Blockchain.Data.Json
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.EthConf          (runKafkaConfigured)
import           Blockchain.Sequencer.Event  (IngestEvent (IETx), IngestTx (..))
import           Blockchain.Sequencer.Kafka  (writeUnseqEvents)
import           Blockchain.Util             (getCurrentMicrotime)
import           Options

import           SortDirection
import           SQLM
import           UnliftIO

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
       :<|> "transaction" :> ReqBody '[JSON] RawTransaction' :> Post '[JSON,PlainText]  Keccak256
       :<|> "transactionList" :> ReqBody '[JSON] [RawTransaction'] :> Post '[JSON] [Keccak256]

data TxsFilterParams = TxsFilterParams
  { qtAddress     :: Maybe Address
  , qtFrom        :: Maybe Address
  , qtTo          :: Maybe Address
  , qtHash        :: Maybe Keccak256
  , qtGasPrice    :: Maybe Natural
  , qtMinGasPrice :: Maybe Natural
  , qtMaxGasPrice :: Maybe Natural
  , qtGasLimit    :: Maybe Natural
  , qtMinGasLimit :: Maybe Natural
  , qtMaxGasLimit :: Maybe Natural
  , qtValue       :: Maybe Natural
  , qtMinValue    :: Maybe Natural
  , qtMaxValue    :: Maybe Natural
  , qtBlockNumber :: Maybe Natural
  , qtChainId     :: Maybe (MaybeNamed ChainId)
  , qtChainIds    :: [ChainId]
  , qtSortby      :: Maybe Sortby
  } deriving (Eq, Ord, Show)

txsFilterParams :: TxsFilterParams
txsFilterParams = TxsFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing []
  Nothing

getTxsFilter :: TxsFilterParams -> ClientM [RawTransaction']
postTx :: RawTransaction' -> ClientM Keccak256
postTxList :: [RawTransaction'] -> ClientM [Keccak256]
getTxsFilter :<|> postTx :<|> postTxList =
  uncurryTxsFilterParams getTxsFilter'
    :<|> postTx'
    :<|> postTxList'
  where
    getTxsFilter'
      :<|> postTx'
      :<|> postTxList' = client (Proxy @API)
    uncurryTxsFilterParams f TxsFilterParams{..} = f
      qtAddress qtFrom qtTo qtHash qtGasPrice qtMinGasPrice
      qtMaxGasPrice qtGasLimit qtMinGasLimit qtMaxGasLimit
      qtValue qtMinValue qtMaxValue qtBlockNumber qtChainId
      qtChainIds qtSortby

server :: ServerT API SQLM
server = getTransaction :<|> postTransactionC :<|> postTransactionListC
  where postTransactionC rt      = runConduit $ postTransaction rt `fuseUpstream` emitKafkaTransactions
        postTransactionListC rts = runConduit $ postTransactionList rts `fuseUpstream` emitKafkaTransactions

---------------------------

instance NFData RawTransaction'

data NamedChainId = UnnamedChainIds [ChainId]
                  | MainChain
                  | AllChains

instance Selectable TxsFilterParams [RawTransaction] SQLM where
  select _ t@TxsFilterParams{..} | t == txsFilterParams { qtChainId = qtChainId
                                                        , qtChainIds = qtChainIds
                                                        , qtSortby = qtSortby
                                                        } =
    throwIO . NoFilterError $ "Need one of: " ++ intercalate ", " transactionQueryParams
                                 | otherwise = do
    chainids <-
      case (qtChainId, qtChainIds) of
        (Nothing, v) -> case v of
          [] -> pure MainChain
          cids -> pure $ UnnamedChainIds cids
        (Just c, []) -> case c of
          Unnamed cid -> pure $ UnnamedChainIds [cid]
          Named "main" -> pure MainChain
          Named "all" -> pure AllChains
          Named name -> throwIO . NamedChainError $ "Expected chainid to be named 'main' or 'all', but got '" <> name <> "'."
        _ -> throwIO $ AmbiguousChainError "You can not use both the chainid and chainids parameters togther."

    txs <- fmap (map E.entityVal) . sqlQuery $ E.select $ E.from $ \(rawTx) -> do
        let criteria = catMaybes
              [
                fmap (\v -> rawTx E.^. RawTransactionFromAddress E.==. E.val v E.||. rawTx E.^. RawTransactionToAddress E.==. E.val (Just v)) qtAddress,
                fmap (\v -> rawTx E.^. RawTransactionFromAddress E.==. E.val v) qtFrom,
                fmap (\v -> rawTx E.^. RawTransactionToAddress E.==. E.val (Just v)) qtTo,
                fmap (\v -> rawTx E.^. RawTransactionTxHash  E.==. E.val v) qtHash,

                fmap (\v -> rawTx E.^. RawTransactionGasPrice E.==. E.val v) (fromIntegral <$> qtGasPrice),
                fmap (\v -> rawTx E.^. RawTransactionGasPrice E.>=. E.val v) (fromIntegral <$> qtMinGasPrice),
                fmap (\v -> rawTx E.^. RawTransactionGasPrice E.<=. E.val v) (fromIntegral <$> qtMaxGasPrice),

                fmap (\v -> rawTx E.^. RawTransactionGasLimit E.==. E.val v) (fromIntegral <$> qtGasLimit),
                fmap (\v -> rawTx E.^. RawTransactionGasLimit E.>=. E.val v) (fromIntegral <$> qtMinGasLimit),
                fmap (\v -> rawTx E.^. RawTransactionGasLimit E.<=. E.val v) (fromIntegral <$> qtMaxGasLimit),

                fmap (\v -> rawTx E.^. RawTransactionValue E.==. E.val v) (fromIntegral <$> qtValue),
                fmap (\v -> rawTx E.^. RawTransactionValue E.>=. E.val v) (fromIntegral <$> qtMinValue),
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
        E.limit $ fromIntegral flags_appFetchLimit
        E.orderBy $ [(sortToOrderBy qtSortby) $ (rawTx E.^. RawTransactionBlockNumber),
                      (sortToOrderBy qtSortby) $ (rawTx E.^. RawTransactionNonce)]

        return rawTx

    return . Just $ nub txs

postTransaction :: (MonadIO m, MonadLogger m) => RawTransaction' -> ConduitT a IngestEvent m Keccak256
postTransaction (RawTransaction' raw "") = do
  let tx' = rawTX2TX raw
      h = transactionHash tx'
  ts <- liftIO getCurrentMicrotime
  yield . IETx ts $ IngestTx API tx'
  $logInfoS "postTransaction" . T.pack $ "Successfully inserted tx: " ++ format h
  return h
postTransaction _ =
  throwIO $ DeprecatedError "The 'next' parameter is no longer supported"


postTransactionList :: (MonadIO m, MonadLogger m) => [RawTransaction'] -> ConduitT a IngestEvent m [Keccak256]
postTransactionList raws = do
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
  yieldMany $ IETx ts . IngestTx API . snd <$> txr
  sendResponseStart <- liftIO $ getTime Realtime
  let times = (map toNanoSecs $
                      [ parserStart - handlerStart
                      , txHashStart - parserStart
                      , sendResponseStart  - txHashStart
                      ]
                    ) -- ++ [ecRecoverTime]
  $logDebug $ T.pack $ "Timings in nanoseconds: " ++ show times
  return $ transactionHash <$> txs -- hs --times -- This is for debugging
  where
    success (a, _) =
      case a of String _ -> True
                _        -> False

getTransaction :: Selectable TxsFilterParams [RawTransaction] m
               => Maybe Address -> Maybe Address -> Maybe Address -> Maybe Keccak256
               -> Maybe Natural -> Maybe Natural -> Maybe Natural -> Maybe Natural
               -> Maybe Natural -> Maybe Natural -> Maybe Natural -> Maybe Natural
               -> Maybe Natural -> Maybe Natural -> Maybe (MaybeNamed ChainId) -> [ChainId]
               -> Maybe Sortby -> m [RawTransaction']
getTransaction a b c d e f g h i j k l m n o p q =
  getTransaction' (TxsFilterParams a b c d e f g h i j k l m n o p q)

getTransaction' :: Selectable TxsFilterParams [RawTransaction] m
                => TxsFilterParams -> m [RawTransaction']
getTransaction' a = map rtToRtPrime . zip (repeat "") . fromMaybe [] <$> select (Proxy @[RawTransaction]) a

transactionQueryParams:: [String]
transactionQueryParams = [ "address",
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
                           "index",
                           "rejected",
                           "chainid"]

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => ConduitT IngestEvent Void m ()
emitKafkaTransactions = loop id
  where
    -- this is essentially the same as sinkList,
    -- except emitting to Kafka instead of returning the list
    loop front = await >>= maybe (emit $ front []) (\x -> loop $ front . (x:))
    emit txs = do
      $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ show (length txs) ++ " faucet tx(s) to unseqevents"
      rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents txs
      case rets of
        Left e      -> $logError $ T.pack $ "Could not write txs to Kafka: " ++ show e
        Right resps -> $logDebug $ T.pack $ "writeUnseqEventsEnd Kafka commit: " ++ show resps
