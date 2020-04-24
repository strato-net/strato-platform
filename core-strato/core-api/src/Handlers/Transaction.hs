{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}


module Handlers.Transaction (
  API,
  server
  ) where

import           Control.DeepSeq
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8  as BLC
import           Data.List
import           Data.Maybe
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import qualified Database.Esqueleto          as E
import           Database.Persist.Postgresql
import           Numeric
import           Servant
import           System.Clock

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.SHA hiding (hash)
import           Text.Format



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
                :> QueryParam "hash" SHA
                :> QueryParam "gasprice" Integer
                :> QueryParam "mingasprice" Integer
                :> QueryParam "maxgasprice" Integer
                :> QueryParam "gaslimit" Integer
                :> QueryParam "mingaslimit" Integer
                :> QueryParam "maxgaslimit" Integer
                :> QueryParam "value" Integer
                :> QueryParam "minvalue" Integer
                :> QueryParam "maxvalue" Integer
                :> QueryParam "blocknumber" Int
                :> QueryParam "chainid" Text
                :> QueryParams "chainids" Text
                :> QueryParam "sortby" Sortby
                :> Get '[JSON] [RawTransaction']
       :<|> "transaction" :> ReqBody '[JSON] RawTransaction' :> Post '[JSON,PlainText]  SHA
       :<|> "transactionList" :> ReqBody '[JSON] [RawTransaction'] :> Post '[JSON] Value

server :: ConnectionPool -> Server API
server connStr = getTransaction connStr :<|> postTransaction :<|> postTransactionList

---------------------------

instance NFData RawTransaction'

postTransaction :: RawTransaction' -> Handler SHA
postTransaction (RawTransaction' raw "") = runStdoutLoggingT $ do
  let tx' = rawTX2TX raw
      h = transactionHash tx'
  emitKafkaTransactions [tx']
  $logDebug $ T.pack $ "Successfully inserted tx: " ++ format h
  return h
postTransaction _ =
  throwError $ err400{ errBody = "The 'next' parameter is no longer supported" }


postTransactionList :: [RawTransaction'] -> Handler Value
postTransactionList raws = runStdoutLoggingT $ do
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
   return $ toJSON (fmap transactionHash txs) -- hs --times -- This is for debugging

          
    where
      success (a, _) =
        case a of String _ -> True
                  _        -> False


getTransaction :: ConnectionPool
               -> Maybe Address -> Maybe Address -> Maybe Address -> Maybe SHA
               -> Maybe Integer -> Maybe Integer -> Maybe Integer -> Maybe Integer 
               -> Maybe Integer -> Maybe Integer -> Maybe Integer -> Maybe Integer 
               -> Maybe Integer -> Maybe Int -> Maybe Text -> [Text]
               -> Maybe Sortby -> Handler [RawTransaction']
getTransaction pool
  address from to hash
  gasprice mingasprice maxgasprice gaslimit
  mingaslimit maxgaslimit value minvalue
  maxvalue blocknumber chainidparam chainidsparam sortby = runStdoutLoggingT $ do

  chainids <-
    case (chainidparam, chainidsparam) of
      (Nothing, v) -> return v
      (Just c, []) -> return [c]
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

              fmap (\v -> rawTx E.^. RawTransactionGasPrice E.==. E.val v) gasprice,
              fmap (\v -> rawTx E.^. RawTransactionGasPrice E.>=. E.val v) mingasprice,
              fmap (\v -> rawTx E.^. RawTransactionGasPrice E.<=. E.val v) maxgasprice,

              fmap (\v -> rawTx E.^. RawTransactionGasLimit E.==. E.val v) gaslimit,
              fmap (\v -> rawTx E.^. RawTransactionGasLimit E.>=. E.val v) mingaslimit,
              fmap (\v -> rawTx E.^. RawTransactionGasLimit E.<=. E.val v) maxgaslimit,

              fmap (\v -> rawTx E.^. RawTransactionValue E.==. E.val v) value,
              fmap (\v -> rawTx E.^. RawTransactionValue E.>=. E.val v) minvalue,
              fmap (\v -> rawTx E.^. RawTransactionValue E.<=. E.val v) maxvalue,

              fmap (\v -> rawTx E.^. RawTransactionBlockNumber E.==. E.val v) blocknumber
            ]



      
      E.where_ ((foldl1 (E.&&.) criteria)) -- map (getTransFilter rawTx) $ getParameters ))

      let matchChainId cid = ((rawTx E.^. RawTransactionChainId) E.==. (E.val $ fromHexText cid))
          chainCriteria = case chainids of
                            [] -> [rawTx E.^. RawTransactionChainId E.==. E.val 0]
                            [cid] -> if (T.unpack cid == "main")
                                        then [rawTx E.^. RawTransactionChainId E.==. E.val 0]
                                        else if (T.unpack cid == "all")
                                             then []
                                             else [matchChainId cid]
                            cids -> map matchChainId cids
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



fromHexText :: T.Text -> Word256
fromHexText v = res
  where ((res,_):_) = readHex $ T.unpack $ v :: [(Word256,String)]
