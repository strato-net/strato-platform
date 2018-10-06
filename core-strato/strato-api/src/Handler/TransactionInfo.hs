{-# LANGUAGE DeriveDataTypeable     #-}
{-# LANGUAGE EmptyDataDecls         #-}
{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE FunctionalDependencies #-}
{-# LANGUAGE GADTs                  #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE TypeFamilies           #-}
{-# LANGUAGE UndecidableInstances   #-}


module Handler.TransactionInfo where

import           Data.Aeson
import           Data.List
import qualified Data.Map                    as Map
import qualified Data.Text                   as T
import qualified Database.Esqueleto          as E
import qualified Prelude                     as P
import           System.Clock

import           Blockchain.Data.Json
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.DBM
import           Blockchain.EthConf          (runKafkaConfigured)
import           Blockchain.Format
import           Blockchain.Sequencer.Event  (IngestEvent (IETx), IngestTx (..))
import           Blockchain.Sequencer.Kafka  (writeUnseqEvents)
import           Blockchain.Util             (getCurrentMicrotime)
import           Handler.Common
import           Handler.Filters
import           Import

instance NFData RawTransaction'

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => [Transaction] -> m ()
emitKafkaTransactions txs = do
    ts <- liftIO $ getCurrentMicrotime
    let ingestTxs = (\t -> (IETx ts (IngestTx API t))) <$> txs
    $logDebugS "writeUnseqEventsBegin" . T.pack $ "Writing " P.++ (show $ P.length ingestTxs) P.++ " tx(s) to unseqevents"
    rets <- liftIO $ runKafkaConfigured "strato-api" $ writeUnseqEvents ingestTxs
    case rets of
        Left e      -> $logError $ "Could not write txs to Kafka: " Import.++ (T.pack $ show e)
        Right resps -> $logDebug $ "writeUnseqEventsEnd Kafka commit: " Import.++ (T.pack $ show resps)
    return ()

postTransactionR :: Handler ()
postTransactionR = do
   addHeader "Access-Control-Allow-Origin" "*"
   addHeader "Access-Control-Allow-Headers" "Content-Type"
   tx <- parseJsonBody :: Handler (Result RawTransaction')
   case tx of
       (Success (RawTransaction' raw "")) -> do
          let tx' = rawTX2TX raw
              h = toJSON $ transactionHash tx'
          void $ insertTX Log API Nothing [tx']
          emitKafkaTransactions [tx']
          case h of
            (String h') -> do
              $logDebug $ "Successfully inserted tx: " Import.++ (T.pack $ format $ transactionHash tx')
              sendResponseStatus status200 (h' :: Text)
            _ -> invalidArgs ["invalid transaction hash"]
       err-> do
          $logDebugS "transaction parse error" . T.pack . show $ err
          invalidArgs ["couldn't decode transaction"]

postTransactionListR :: Handler ()
postTransactionListR = do
   handlerStart <- liftIO $ getTime Realtime

   addHeader "Access-Control-Allow-Origin" "*"
   addHeader "Access-Control-Allow-Headers" "Content-Type"

   parserStart <- liftIO $ getTime Realtime
   tx <- parseJsonBody :: Handler (Result [RawTransaction'])
   case tx of
       (Success raws) -> do
          txHashStart <- raws `deepseq` (liftIO $ getTime Realtime)
          let txs = fmap (\(RawTransaction' raw _) -> rawTX2TX $ raw) raws
              hs = fmap (toJSON . transactionHash) txs
              txr = P.filter success $ P.zip hs txs
          let num = Import.length txs
          $logDebug $ (T.pack $ show $ num) Import.++ " incoming transactions..."
          let num' = P.length $ P.filter (not . success) $ P.zip hs txs
          $logDebug $ "Inserted " Import.++ (T.pack $ show (num - num')) Import.++ " of the transactions"
          insertTXStart <- txr `deepseq` (liftIO $ getTime Realtime)
        --   ecRecoverTime <- do
        --     a <- insertTX Log API Nothing (fmap snd txr)
        --     return a
          $logDebug $ "Kafkaing txs: \n" Import.++ (T.pack $ Import.unlines $ format <$> ((transactionHash . snd) <$> txr))
          emitKafkaTransactions $ snd <$> txr
          sendResponseStart <- liftIO $ getTime Realtime
          let times = (P.map toNanoSecs $
                        [ parserStart - handlerStart
                        , txHashStart - parserStart
                        , insertTXStart - txHashStart
                        , sendResponseStart - insertTXStart
                        ]
                      ) --P.++ [ecRecoverTime]
          $logDebug $ "Timings in nanoseconds: " Import.++ (T.pack $ show times)
          sendResponseStatus status200 $ toJSON (fmap transactionHash txs) -- hs --times -- This is for debugging
       _ -> invalidArgs ["couldn't decode transactions"]
    where
      success (a, _) =
        case a of String _ -> True
                  _        -> False

optionsTransactionR :: Handler RepPlain
optionsTransactionR = do
  addHeader "Access-Control-Allow-Origin" "*"
  addHeader "Access-Control-Allow-Headers" "Content-Type"
  addHeader "Access-Control-Allow-Methods" "POST, OPTIONS"

  return $ RepPlain $ toContent ("" :: Text)

getTransactionR :: Handler Value
getTransactionR = do
                 getParameters <- reqGetParams <$> getRequest

                 limit <- liftIO $ myFetchLimit

                 sortParam <- lookupGetParam "sortby"
                 showRejectedMaybe <- lookupGetParam "rejected"
                 chainIds <- lookupGetParams "chainid"

                 let showReject = case showRejectedMaybe of
                                    Just "true"  -> -1
                                    Just "false" -> 0
                                    Just _       -> 0
                                    Nothing      -> 0
                 $logDebug $ T.pack $ show showReject
--                 let offset = (fromIntegral $ (maybe 0 id $ extractPage "page" getParameters)  :: Int64)
                 let index' = (fromIntegral $ (maybe showReject id $ extractPage' showReject "index" getParameters)  :: Int)
                 let paramMap = Map.fromList getParameters
                     paramMapRemoved = P.foldr (\param mp -> (Map.delete param mp)) paramMap transactionQueryParams

                 addHeader "Access-Control-Allow-Origin" "*"
                 txs <- case ((paramMapRemoved == Map.empty) && (paramMap /= Map.empty)) of
                           False -> invalidArgs [T.concat ["Need one of: ", T.intercalate " , " $ transactionQueryParams]]
                           True ->  runDB $ E.select $
                                        E.from $ \(rawTx) -> do

                                        E.where_ ((P.foldl1 (E.&&.) $ P.map (getTransFilter (rawTx)) $ getParameters ))

                                        let criteria = P.map (getTransFilter rawTx) $ getParameters
                                        let matchChainId cid = ((rawTx E.^. RawTransactionChainId) E.==. (E.just $ E.val $ fromHexText cid))
                                        let chainCriteria = case chainIds of
                                              [] -> [(E.isNothing $ rawTx E.^. RawTransactionChainId)]
                                              [cid] -> if (T.unpack cid == "main")
                                                           then [(E.isNothing $ rawTx E.^. RawTransactionChainId)]
                                                           else if (T.unpack cid == "all")
                                                                    then []
                                                                    else [matchChainId cid]             
                                              cids -> P.map matchChainId cids 
                                        let otherCriteria = ((rawTx E.^. RawTransactionBlockNumber) E.>=. E.val index') : criteria
                                        let allCriteria = case chainCriteria of
                                                [] -> [otherCriteria]
                                                _ -> P.map (\cc -> cc : otherCriteria) chainCriteria
                                        -- FIXME: if more than `limit` transactions per block, we will need to have a tuple as index
                                        E.where_ (P.foldl1 (E.||.) (P.map (P.foldl1 (E.&&.)) allCriteria))

                                        -- E.offset $ (limit * offset)
                                        E.limit $ (limit)
                                        E.orderBy $ [(sortToOrderBy sortParam) $ (rawTx E.^. RawTransactionBlockNumber),
                                                     (sortToOrderBy sortParam) $ (rawTx E.^. RawTransactionNonce)]

                                        return rawTx

                 let modTxs = nub $ txs :: [Entity RawTransaction]
                 let newindex = pack $ show $ 1 + (E.fromSqlKey . E.entityKey $ P.last modTxs)
                 let extra p = P.zipWith extraFilter p (P.repeat (newindex))
                 -- this should actually use URL encoding code from Yesod
                 let next p = "/eth/v1.2/transaction?" P.++  (P.foldl1 (\a b -> (unpack a) P.++ "&" P.++ (unpack b)) $ P.map (\(k,v) -> (unpack k) P.++ "=" P.++ (unpack v)) (extra p))

                 toRet (P.map E.entityVal modTxs) (next $ appendIndex getParameters)

               where
                   toRet bs gp = returnJson . P.map rtToRtPrime . P.zip (P.repeat gp) $ bs
