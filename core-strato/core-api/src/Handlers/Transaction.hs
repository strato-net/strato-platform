{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
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
import           Control.Monad
import           Control.Monad.IO.Class
import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8  as BLC
import           Data.List
import           Data.Maybe
import qualified Data.Text                   as T
import qualified Database.Esqueleto          as E
import           Database.Persist.Postgresql
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

import           Settings
import           SortDirection
import           SQLM

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
  }

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

server :: ConnectionPool -> Server API
server connStr = getTransaction connStr :<|> postTransaction :<|> postTransactionList

---------------------------

instance NFData RawTransaction'

postTransaction :: RawTransaction' -> Handler Keccak256
postTransaction (RawTransaction' raw "") = runLoggingT $ do
  let tx' = rawTX2TX raw
      h = transactionHash tx'
  emitKafkaTransactions [tx']
  $logInfoS "postTransaction" . T.pack $ "Successfully inserted tx: " ++ format h
  return h
postTransaction _ =
  throwError $ err400{ errBody = "The 'next' parameter is no longer supported" }


postTransactionList :: [RawTransaction'] -> Handler [Keccak256]
postTransactionList raws = runLoggingT $ do
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
   emitKafkaTransactions $ snd <$> txr
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

data NamedChainId = UnnamedChainIds [ChainId]
                  | MainChain
                  | AllChains

getTransaction :: ConnectionPool
               -> Maybe Address -> Maybe Address -> Maybe Address -> Maybe Keccak256
               -> Maybe Natural -> Maybe Natural -> Maybe Natural -> Maybe Natural
               -> Maybe Natural -> Maybe Natural -> Maybe Natural -> Maybe Natural
               -> Maybe Natural -> Maybe Natural -> Maybe (MaybeNamed ChainId) -> [ChainId]
               -> Maybe Sortby -> Handler [RawTransaction']
getTransaction pool
  address from to hash
  gasprice mingasprice maxgasprice gaslimit
  mingaslimit maxgaslimit value minvalue
  maxvalue blocknumber chainidparam chainidsparam sortby = runLoggingT $ do

  chainids <-
    case (chainidparam, chainidsparam) of
      (Nothing, v) -> case v of
        [] -> pure MainChain
        cids -> pure $ UnnamedChainIds cids
      (Just c, []) -> case c of
        Unnamed cid -> pure $ UnnamedChainIds [cid]
        Named "main" -> pure MainChain
        Named "all" -> pure AllChains
        Named name -> throwError err400{errBody = BLC.pack . T.unpack $ "Expected chainid to be named 'main' or 'all', but got '" <> name <> "'." }
      _ -> throwError err400{ errBody = "You can not use both the chainid and chainids parameters togther." }
          
  
  --let offset = (fromIntegral $ (maybe 0 id $ extractPage "page" getParameters)  :: Int64)

  when (and
        [
          null address, null  from, null  to, null  hash, 
          null gasprice, null  mingasprice, null  maxgasprice, null  gaslimit, 
          null mingaslimit, null  maxgaslimit, null  value, null  minvalue, 
          null maxvalue, null  blocknumber
        ]) $
    throwError err400{ errBody = BLC.pack $ "Need one of: " ++ intercalate ", " transactionQueryParams }


  txs <- liftIO $ runSQLM pool $
    sqlQuery $ E.select $ E.from $ \(rawTx) -> do
      let criteria = catMaybes
            [
              fmap (\v -> rawTx E.^. RawTransactionFromAddress E.==. E.val v E.||. rawTx E.^. RawTransactionToAddress E.==. E.val (Just v)) address,
              fmap (\v -> rawTx E.^. RawTransactionFromAddress E.==. E.val v) from,
              fmap (\v -> rawTx E.^. RawTransactionToAddress E.==. E.val (Just v)) to,
              fmap (\v -> rawTx E.^. RawTransactionTxHash  E.==. E.val v) hash,

              fmap (\v -> rawTx E.^. RawTransactionGasPrice E.==. E.val v) (fromIntegral <$> gasprice),
              fmap (\v -> rawTx E.^. RawTransactionGasPrice E.>=. E.val v) (fromIntegral <$> mingasprice),
              fmap (\v -> rawTx E.^. RawTransactionGasPrice E.<=. E.val v) (fromIntegral <$> maxgasprice),

              fmap (\v -> rawTx E.^. RawTransactionGasLimit E.==. E.val v) (fromIntegral <$> gaslimit),
              fmap (\v -> rawTx E.^. RawTransactionGasLimit E.>=. E.val v) (fromIntegral <$> mingaslimit),
              fmap (\v -> rawTx E.^. RawTransactionGasLimit E.<=. E.val v) (fromIntegral <$> maxgaslimit),

              fmap (\v -> rawTx E.^. RawTransactionValue E.==. E.val v) (fromIntegral <$> value),
              fmap (\v -> rawTx E.^. RawTransactionValue E.>=. E.val v) (fromIntegral <$> minvalue),
              fmap (\v -> rawTx E.^. RawTransactionValue E.<=. E.val v) (fromIntegral <$> maxvalue),

              fmap (\v -> rawTx E.^. RawTransactionBlockNumber E.==. E.val v) (fromIntegral <$> blocknumber)
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
      E.orderBy $ [(sortToOrderBy sortby) $ (rawTx E.^. RawTransactionBlockNumber),
                    (sortToOrderBy sortby) $ (rawTx E.^. RawTransactionNonce)]

      return rawTx

  let modTxs = nub $ txs :: [Entity RawTransaction]
  return . map rtToRtPrime . zip (repeat "") $ map E.entityVal modTxs






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


emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [Transaction] -> m ()
emitKafkaTransactions txs = do
    ts <- liftIO $ getCurrentMicrotime
    let ingestTxs = (\t -> (IETx ts (IngestTx API t))) <$> txs
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " ++ (show $ length ingestTxs) ++ " tx(s) to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestTxs
    case rets of
        Left e      -> $logError $ T.pack $ "Could not write txs to Kafka: " ++ show e
        Right resps -> $logDebug $ T.pack $ "writeUnseqEventsEnd Kafka commit: " ++ show resps
    return ()
