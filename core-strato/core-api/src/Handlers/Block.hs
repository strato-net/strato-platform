{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Block
  ( API
  , BlocksFilterParams(..)
  , blocksFilterParams
  , getBlocksFilter
  , server
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
import           Numeric.Natural
import           Servant
import           Servant.Client

import           Blockchain.Data.Address
import           Blockchain.Data.Json
import           Blockchain.Data.Transaction
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Keccak256 hiding (hash)

import           SQLM

import           Settings
import           SortDirection

type API = 
  "block" :> QueryParam "txaddress" Address
          :> QueryParam "coinbase" Address
          :> QueryParam "address" Address
          :> QueryParam "blockid" Text
          :> QueryParam "hash" Keccak256
          :> QueryParam "mindiff" Natural
          :> QueryParam "maxdiff" Natural
          :> QueryParam "diff" Natural
          :> QueryParam "gasused" Natural
          :> QueryParam "mingasused" Natural
          :> QueryParam "maxgasused" Natural
          :> QueryParam "gaslim" Natural
          :> QueryParam "mingaslim" Natural
          :> QueryParam "maxgaslim" Natural
          :> QueryParam "number" Natural
          :> QueryParam "minnumber" Natural
          :> QueryParam "maxnumber" Natural
          :> QueryParam "index" Int
          :> QueryParam "chainid" ChainId
          :> QueryParam "sortby" Sortby :> Get '[JSON] [Block']

data BlocksFilterParams = BlocksFilterParams
  { qbTxAddress  :: Maybe Address
  , qbCoinbase   :: Maybe Address
  , qbAddress    :: Maybe Address
  , qbBlockId    :: Maybe Text
  , qbHash       :: Maybe Keccak256
  , qbMinDiff    :: Maybe Natural
  , qbMaxDiff    :: Maybe Natural
  , qbDiff       :: Maybe Natural
  , qbGasUsed    :: Maybe Natural
  , qbMinGasUsed :: Maybe Natural
  , qbMaxGasUsed :: Maybe Natural
  , qbGasLim     :: Maybe Natural
  , qbMinGasLim  :: Maybe Natural
  , qbMaxGasLim  :: Maybe Natural
  , qbNumber     :: Maybe Natural
  , qbMinNumber  :: Maybe Natural
  , qbMaxNumber  :: Maybe Natural
  , qbIndex      :: Maybe Int
  , qbChainId    :: Maybe ChainId
  , qbSortby     :: Maybe Sortby
  }

blocksFilterParams :: BlocksFilterParams
blocksFilterParams = BlocksFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing Nothing Nothing

getBlocksFilter :: BlocksFilterParams -> ClientM [Block']
getBlocksFilter = uncurryBlocksFilterParams getBlocksFilter'
  where
    getBlocksFilter' = client (Proxy @API)
    uncurryBlocksFilterParams f BlocksFilterParams{..} = f
      qbTxAddress qbCoinbase qbAddress qbBlockId qbHash qbMinDiff
      qbMaxDiff qbDiff qbGasUsed qbMinGasUsed qbMaxGasUsed qbGasLim
      qbMinGasLim qbMaxGasLim qbNumber qbMinNumber qbMaxNumber
      qbIndex qbChainId qbSortby

server :: ConnectionPool -> Server API
server pool = getBlockInfo pool

---------------------

getBlockInfo :: ConnectionPool ->
                 Maybe Address -> Maybe Address -> Maybe Address -> Maybe Text ->
                 Maybe Keccak256 -> Maybe Natural -> Maybe Natural -> Maybe Natural ->
                 Maybe Natural -> Maybe Natural -> Maybe Natural -> Maybe Natural ->
                 Maybe Natural -> Maybe Natural -> Maybe Natural -> Maybe Natural ->
                 Maybe Natural -> Maybe Int -> Maybe ChainId -> Maybe Sortby ->
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
                  fmap (\v -> bdRef E.^. BlockDataRefNumber E.==. E.val v) (fromIntegral <$> number),
                  fmap (\v -> bdRef E.^. BlockDataRefNumber E.>=. E.val v) (fromIntegral <$> minnumber),
                  fmap (\v -> bdRef E.^. BlockDataRefNumber E.<=. E.val v) (fromIntegral <$> maxnumber),
                  fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.==. E.val v) (fromIntegral <$> gaslim),
                  fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.>=. E.val v) (fromIntegral <$> mingaslim),
                  fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.<=. E.val v) (fromIntegral <$> maxgaslim),
                  fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.==. E.val v) (fromIntegral <$> gasused),
                  fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.>=. E.val v) (fromIntegral <$> mingasused),
                  fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.<=. E.val v) (fromIntegral <$> maxgasused),
                  fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.==. E.val v) (fromIntegral <$> diff),
                  fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.>=. E.val v) (fromIntegral <$> mindiff),
                  fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.<=. E.val v) (fromIntegral <$> maxdiff),
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
