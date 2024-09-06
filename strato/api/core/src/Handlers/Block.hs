{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Block
  ( API,
    BlocksFilterParams (..),
    blocksFilterParams,
    getBlocksFilter,
    server,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256 hiding (hash)
import Control.Arrow ((&&&), (***))
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import Data.List
import qualified Data.Map as Map
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as T
import qualified Database.Esqueleto.Legacy as E
import Database.Persist.Postgresql
import Numeric.Natural
import SQLM
import Servant
import Servant.Client
import Settings
import SortDirection
import UnliftIO

type API =
  "block" :> QueryParam "txaddress" Address
    :> QueryParam "coinbase" Text
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
    :> QueryParam "sortby" Sortby
    :> Get '[JSON] [Block']

data BlocksFilterParams = BlocksFilterParams
  { qbTxAddress :: Maybe Address,
    qbCoinbase :: Maybe Text,
    qbAddress :: Maybe Address,
    qbBlockId :: Maybe Text,
    qbHash :: Maybe Keccak256,
    qbMinDiff :: Maybe Natural,
    qbMaxDiff :: Maybe Natural,
    qbDiff :: Maybe Natural,
    qbGasUsed :: Maybe Natural,
    qbMinGasUsed :: Maybe Natural,
    qbMaxGasUsed :: Maybe Natural,
    qbGasLim :: Maybe Natural,
    qbMinGasLim :: Maybe Natural,
    qbMaxGasLim :: Maybe Natural,
    qbNumber :: Maybe Natural,
    qbMinNumber :: Maybe Natural,
    qbMaxNumber :: Maybe Natural,
    qbIndex :: Maybe Int,
    qbChainId :: Maybe ChainId,
    qbSortby :: Maybe Sortby
  }
  deriving (Eq, Ord)

blocksFilterParams :: BlocksFilterParams
blocksFilterParams =
  BlocksFilterParams
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
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing

getBlocksFilter :: BlocksFilterParams -> ClientM [Block']
getBlocksFilter = uncurryBlocksFilterParams getBlocksFilter'
  where
    getBlocksFilter' = client (Proxy @API)
    uncurryBlocksFilterParams f BlocksFilterParams {..} =
      f
        qbTxAddress
        qbCoinbase
        qbAddress
        qbBlockId
        qbHash
        qbMinDiff
        qbMaxDiff
        qbDiff
        qbGasUsed
        qbMinGasUsed
        qbMaxGasUsed
        qbGasLim
        qbMinGasLim
        qbMaxGasLim
        qbNumber
        qbMinNumber
        qbMaxNumber
        qbIndex
        qbChainId
        qbSortby

server :: HasSQL m => ServerT API m
server = getBlockInfo

---------------------

instance HasSQL m => Selectable BlocksFilterParams [Block] m where
  select _ b@BlocksFilterParams {..}
    | b == blocksFilterParams {qbSortby = qbSortby} =
      throwIO . NoFilterError $ "Need one of: " ++ intercalate ", " (map T.unpack blockQueryParams)
    | otherwise = do
      blks <- fmap (map (E.entityKey &&& E.entityVal)) . sqlQuery $
        E.select $
          E.from $ \(bdRef `E.LeftOuterJoin` btx `E.FullOuterJoin` rawTX `E.LeftOuterJoin` accStateRef) -> do
            E.on (accStateRef E.^. AddressStateRefAddress E.==. rawTX E.^. RawTransactionFromAddress)
            E.on (rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction)
            E.on (btx E.^. BlockTransactionBlockDataRefId E.==. bdRef E.^. BlockDataRefId)

            let criteria =
                  catMaybes
                    [ fmap (\v -> bdRef E.^. BlockDataRefNumber E.==. E.val v) (fromIntegral <$> qbNumber),
                      fmap (\v -> bdRef E.^. BlockDataRefNumber E.>=. E.val v) (fromIntegral <$> qbMinNumber),
                      fmap (\v -> bdRef E.^. BlockDataRefNumber E.<=. E.val v) (fromIntegral <$> qbMaxNumber),
                      fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.==. E.val v) (fromIntegral <$> qbGasLim),
                      fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.>=. E.val v) (fromIntegral <$> qbMinGasLim),
                      fmap (\v -> bdRef E.^. BlockDataRefGasLimit E.<=. E.val v) (fromIntegral <$> qbMaxGasLim),
                      fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.==. E.val v) (fromIntegral <$> qbGasUsed),
                      fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.>=. E.val v) (fromIntegral <$> qbMinGasUsed),
                      fmap (\v -> bdRef E.^. BlockDataRefGasUsed E.<=. E.val v) (fromIntegral <$> qbMaxGasUsed),
                      fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.==. E.val v) (fromIntegral <$> qbDiff),
                      fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.>=. E.val v) (fromIntegral <$> qbMinDiff),
                      fmap (\v -> bdRef E.^. BlockDataRefDifficulty E.<=. E.val v) (fromIntegral <$> qbMaxDiff),
                      fmap (\v -> bdRef E.^. BlockDataRefCoinbase E.==. E.val v) qbCoinbase,
                      fmap (\v -> accStateRef E.^. AddressStateRefAddress E.==. E.val v) qbAddress,
                      --                  fmap (\v -> bdRef E.^. BlockDataRefNumber E.==. E.val v) ntx,
                      fmap
                        ( \v ->
                            (rawTX E.^. RawTransactionFromAddress E.==. E.val v)
                              E.||. (rawTX E.^. RawTransactionToAddress E.==. E.val (Just v))
                        )
                        qbTxAddress,
                      fmap (\v -> bdRef E.^. BlockDataRefId E.==. E.val (toBlockDataRefId v)) qbBlockId,
                      fmap (\v -> bdRef E.^. BlockDataRefHash E.==. E.val v) qbHash
                    ]

            E.where_ (foldl1 (E.&&.) criteria)

            E.limit $ appFetchLimit

            E.distinctOnOrderBy [sortToOrderBy qbSortby $ bdRef E.^. BlockDataRefNumber] (return bdRef)

      let blockIds = fst <$> blks
          buildList' f g = Map.fromListWith (flip (++)) . map (f &&& g)
          buildList  f   = buildList' f (:[]) . map E.entityVal
          get' = Map.findWithDefault []
      vs <- fmap (buildList blockValidatorRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
        E.where_ $ v E.^. BlockValidatorRefBlockDataRefId `E.in_` E.valList blockIds
        pure v
      vd <- fmap (buildList validatorDeltaRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
        E.where_ $ v E.^. ValidatorDeltaRefBlockDataRefId `E.in_` E.valList blockIds
        pure v
      ca <- fmap (buildList certificateAddedRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
        E.where_ $ v E.^. CertificateAddedRefBlockDataRefId `E.in_` E.valList blockIds
        pure v
      cr <- fmap (buildList certificateRevokedRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
        E.where_ $ v E.^. CertificateRevokedRefBlockDataRefId `E.in_` E.valList blockIds
        pure v
      ps <- fmap (buildList proposalSignatureRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
        E.where_ $ v E.^. ProposalSignatureRefBlockDataRefId `E.in_` E.valList blockIds
        pure v
      ss <- fmap (buildList commitmentSignatureRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
        E.where_ $ v E.^. CommitmentSignatureRefBlockDataRefId `E.in_` E.valList blockIds
        pure v
      txs <- fmap (buildList' (blockTransactionBlockDataRefId . fst) ((: []) . rawTX2TX . snd) . map (E.entityVal *** E.entityVal)) . sqlQuery $
        E.select $ E.from $ \(btx `E.InnerJoin` rawTX) -> do
          E.on (rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction)
          E.where_ $ btx E.^. BlockTransactionBlockDataRefId `E.in_` E.valList blockIds
          E.orderBy [E.asc (btx E.^. BlockTransactionId)]
          return (btx, rawTX)

      return . Just $ map (\(k,v) -> blockDataRefToBlock v (get' k vs) (get' k  vd) (get' k  ca) (get' k  cr) (get' k  ps) (get' k  ss) (get' k txs)) blks

getBlockInfo ::
  Selectable BlocksFilterParams [Block] m =>
  Maybe Address ->
  Maybe Text ->
  Maybe Address ->
  Maybe Text ->
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
  Maybe Natural ->
  Maybe Natural ->
  Maybe Int ->
  Maybe ChainId ->
  Maybe Sortby ->
  m [Block']
getBlockInfo a b c d e f g h i j k l m n o p q r s t =
  getBlockInfo' (BlocksFilterParams a b c d e f g h i j k l m n o p q r s t)

getBlockInfo' :: Selectable BlocksFilterParams [Block] m => BlocksFilterParams -> m [Block']
getBlockInfo' b = map (flip Block' "") . fromMaybe [] <$> select (Proxy @[Block]) b

blockQueryParams :: [Text]
blockQueryParams =
  [ "txaddress",
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
    "chainid"
  ]

toBlockDataRefId :: Text -> Key BlockDataRef
toBlockDataRefId = toSqlKey . read . T.unpack
