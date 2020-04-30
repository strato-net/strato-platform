{-# LANGUAGE DataKinds, OverloadedStrings, TypeOperators #-}

module Handlers.Block (
  API,
  server
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString.Lazy.Char8  as BLC
import           Data.List
import qualified Data.Map                    as Map
import           Data.Maybe
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import qualified Database.Esqueleto as E
import           Database.Persist.Postgresql
import           Servant

import           Blockchain.Data.Address
import           Blockchain.Data.Json
import           Blockchain.Data.Transaction
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA hiding (hash)

import           SQLM

import           Settings
import           SortDirection

type API = 
  "block" :> QueryParam "txaddress" Address
          :> QueryParam "coinbase" Address
          :> QueryParam "address" Address
          :> QueryParam "blockid" Text
          :> QueryParam "hash" SHA
          :> QueryParam "mindiff" Integer
          :> QueryParam "maxdiff" Integer
          :> QueryParam "diff" Integer
          :> QueryParam "gasused" Integer
          :> QueryParam "mingasused" Integer
          :> QueryParam "maxgasused" Integer
          :> QueryParam "gaslim" Integer
          :> QueryParam "mingaslim" Integer
          :> QueryParam "maxgaslim" Integer
          :> QueryParam "number" Integer
          :> QueryParam "minnumber" Integer
          :> QueryParam "maxnumber" Integer
          :> QueryParam "index" Int
          :> QueryParam "chainid" SHA
          :> QueryParam "sortby" Sortby :> Get '[JSON] [Block']


server :: ConnectionPool -> Server API
server pool = getBlockInfo pool

---------------------

getBlockInfo :: ConnectionPool ->
                 Maybe Address -> Maybe Address -> Maybe Address -> Maybe Text ->
                 Maybe SHA -> Maybe Integer -> Maybe Integer -> Maybe Integer ->
                 Maybe Integer -> Maybe Integer -> Maybe Integer -> Maybe Integer ->
                 Maybe Integer -> Maybe Integer -> Maybe Integer -> Maybe Integer ->
                 Maybe Integer -> Maybe Int -> Maybe SHA -> Maybe Sortby ->
                 Handler [Block']
getBlockInfo pool
  txaddress coinbase address blockid hash mindiff maxdiff diff
  gasused mingasused maxgasused gaslim mingaslim maxgaslim number minnumber
  maxnumber index chainid sortby = do

  when (and
        [null txaddress, null coinbase, null address, null blockid, null hash, null mindiff,
         null maxdiff, null diff, null gasused, null mingasused, null maxgasused, null gaslim,
         null mingaslim, null maxgaslim, null number, null minnumber, null maxnumber, null index,
         null chainid]) $
    throwError (err400{ errBody = BLC.pack ("Need one of: " ++ intercalate ", " (map T.unpack blockQueryParams)) })


  
  blks <- liftIO $ runSQLM pool $
    sqlQuery $
    E.select $
    E.from $ \(bdRef `E.LeftOuterJoin` btx `E.FullOuterJoin` rawTX `E.LeftOuterJoin` accStateRef) -> do

          E.on ( accStateRef E.^. AddressStateRefAddress E.==. rawTX E.^. RawTransactionFromAddress )
          E.on ( rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction )
          E.on ( btx E.^. BlockTransactionBlockDataRefId E.==. bdRef E.^. BlockDataRefId )

          let criteria = catMaybes
                [
                  fmap (\v -> bdRef E.^. BlockDataRefNumber E.==. E.val v) number,
                  fmap (\v -> bdRef E.^. BlockDataRefNumber E.>=. E.val v) minnumber,
                  fmap (\v -> bdRef E.^. BlockDataRefNumber E.<=. E.val v) maxnumber,
                  fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.==. E.val v) gaslim,
                  fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.>=. E.val v) mingaslim,
                  fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.<=. E.val v) maxgaslim,
                  fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.==. E.val v) gasused,
                  fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.>=. E.val v) mingasused,
                  fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.<=. E.val v) maxgasused,
                  fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.==. E.val v) diff,
                  fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.>=. E.val v) mindiff,
                  fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.<=. E.val v) maxdiff,
                  fmap (\v -> bdRef E.^. BlockDataRefCoinbase E.==. E.val v) coinbase,
                  fmap (\v -> accStateRef E.^. AddressStateRefAddress E.==. E.val v) address,
--                  fmap (\v -> bdRef E.^. BlockDataRefNumber E.==. E.val v) ntx,
                  fmap (\v -> (rawTX E.^. RawTransactionFromAddress E.==. E.val v)
                              E.||.
                              (rawTX E.^. RawTransactionToAddress E.==. E.val (Just v))) txaddress,
                  fmap (\v -> bdRef E.^. BlockDataRefId E.==. E.val (toBlockDataRefId v)) blockid,
                  fmap (\v -> bdRef E.^. BlockDataRefHash E.==. E.val v) hash
                ] 

          
          E.where_ (foldl1 (E.&&.) criteria)

          E.limit $ appFetchLimit

          E.distinctOnOrderBy [sortToOrderBy sortby $ bdRef E.^. BlockDataRefNumber] (return bdRef)


  let blockIds = map entityKey blks

  txs <- liftIO $ runSQLM pool $ 
         sqlQuery $ E.select $
                     E.from $ \(btx `E.InnerJoin` rawTX) -> do
                       E.on ( rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction )
                       E.where_ $ btx E.^. BlockTransactionBlockDataRefId `E.in_` E.valList blockIds
                       E.orderBy [E.asc (btx E.^. BlockTransactionId)]
                       return (btx, rawTX)

  let getTXLists = flip (Map.findWithDefault []) $
                               Map.fromListWith (flip (++)) $ map (fmap (:[])) $ map (\(x, y) -> (blockTransactionBlockDataRefId $ E.entityVal x, rawTX2TX $ E.entityVal y)) txs::(Key BlockDataRef->[Transaction])


  let modBlocks = map (\x -> (E.entityVal x, E.entityKey x)) (blks::[E.Entity BlockDataRef])

  return $ map (uncurry (bToBPrime "")) $ map (fmap getTXLists) modBlocks


blockQueryParams:: [Text]
blockQueryParams = [ "txaddress",
                     "coinbase",
                     "address",
                     "blockid",
                     "hash",
                     "mindiff",
                     "maxdiff",
                     "diff",
                     "gasused",
                     "mingasused",
                     "maxgasused",
                     "gaslim",
                     "mingaslim",
                     "maxgaslim",
                     "number",
                     "minnumber",
                     "maxnumber",
                     "index",
                     "chainid"]



toBlockDataRefId :: Text -> Key BlockDataRef
toBlockDataRefId = toSqlKey . read . T.unpack

{-
runDB :: ConnectionPool -> SqlPersistT (LoggingT IO) a -> IO a
runDB pool x =  runStdoutLoggingT $ withPostgresqlPool pool 10 $ \p -> do
  runSqlPool x p
-}
