{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

-- | The node's sync scalars, mirrored from Redis into Postgres.
--
-- @node_status@ is a small key/value table in the eth database holding the
-- handful of values the API tier needs to answer @/metadata@ and its synced
-- pre-flight: the node's best block, the best sequenced block (with the
-- validator set), the world best block seen from peers, the derived sync
-- flag, and the Cirrus tip. The core processes keep writing these to Redis
-- as before; 'Blockchain.NodeStatusMirror' (run by strato-indexer) copies
-- them here whenever they change. Readers outside the core get them from
-- Postgres, so Redis stays core-internal and a read replica is enough to
-- serve the API.
--
-- Values are JSON text so a row can be read from SQL tooling and from apex
-- without a decoder; the typed accessors below hide the encoding.
module Blockchain.Data.NodeStatus
  ( NodeStatusKey (..),
    nodeStatusKeyName,
    BestBlockJSON (..),
    BestSequencedBlockJSON (..),
    CirrusTip (..),
    setNodeStatusSql,
    setNodeStatusEncodedSql,
    getNodeStatusSql,
    getNodeBestBlock,
    getNodeBestSequencedBlock,
    getNodeWorldBestBlock,
    getNodeSyncStatus,
    getNodeCirrusTip,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Model.SyncState
import Control.Monad (void)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.Aeson (FromJSON, ToJSON, (.:), (.=))
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy as BL
import Data.Text (Text)
import qualified Data.Text.Encoding as TE
import Data.Time (getCurrentTime)
import qualified Database.Persist.Sql as SQL

data NodeStatusKey
  = BestBlockKey
  | BestSequencedBlockKey
  | WorldBestBlockKey
  | SyncStatusKey
  | CirrusTipKey
  deriving (Eq, Ord, Show, Enum, Bounded)

-- | The row's @name@ column. Part of the schema's contract with non-Haskell
-- readers: apex reads @best_block@ and @best_sequenced_block@.
nodeStatusKeyName :: NodeStatusKey -> Text
nodeStatusKeyName k = case k of
  BestBlockKey -> "best_block"
  BestSequencedBlockKey -> "best_sequenced_block"
  WorldBestBlockKey -> "world_best_block"
  SyncStatusKey -> "sync_status"
  CirrusTipKey -> "cirrus_tip"

-- | Upsert one value.
setNodeStatusSql :: (MonadIO m, ToJSON a) => NodeStatusKey -> a -> SQL.SqlPersistT m ()
setNodeStatusSql k = setNodeStatusEncodedSql k . JSON.encode

-- | Upsert one already-encoded value (the mirror compares encodings to skip
-- unchanged writes, so it hands the bytes over as they are).
setNodeStatusEncodedSql :: MonadIO m => NodeStatusKey -> BL.ByteString -> SQL.SqlPersistT m ()
setNodeStatusEncodedSql k encodedBytes = do
  now <- liftIO getCurrentTime
  let name = nodeStatusKeyName k
      encoded = TE.decodeUtf8 $ BL.toStrict encodedBytes
  void $
    SQL.upsertBy
      (UniqueNodeStatusName name)
      (NodeStatus name encoded now)
      [NodeStatusValue SQL.=. encoded, NodeStatusUpdatedAt SQL.=. now]

-- | 'Nothing' if the row is absent or does not decode as the expected type.
-- An absent row is normal on a node whose mirror has not written yet; a row
-- that fails to decode means the writer and reader disagree on the shape.
getNodeStatusSql :: (MonadIO m, FromJSON a) => NodeStatusKey -> SQL.SqlPersistT m (Maybe a)
getNodeStatusSql k = do
  mRow <- SQL.getBy (UniqueNodeStatusName (nodeStatusKeyName k))
  pure $ mRow >>= JSON.decodeStrict . TE.encodeUtf8 . nodeStatusValue . SQL.entityVal

-- The wire shapes. BestBlock and BestSequencedBlock carry no JSON instances
-- of their own (they are RLP on the Redis side), so they get explicit
-- encodings via newtypes rather than orphans.

newtype BestBlockJSON = BestBlockJSON {unBestBlockJSON :: BestBlock}

instance ToJSON BestBlockJSON where
  toJSON (BestBlockJSON (BestBlock h n)) = JSON.object ["hash" .= h, "number" .= n]

instance FromJSON BestBlockJSON where
  parseJSON = JSON.withObject "BestBlock" $ \o ->
    BestBlockJSON <$> (BestBlock <$> o .: "hash" <*> o .: "number")

newtype BestSequencedBlockJSON = BestSequencedBlockJSON {unBestSequencedBlockJSON :: BestSequencedBlock}

instance ToJSON BestSequencedBlockJSON where
  toJSON (BestSequencedBlockJSON (BestSequencedBlock h n vs stakes rnd)) =
    JSON.object
      [ "hash" .= h,
        "number" .= n,
        "validators" .= vs,
        "stakes" .= stakes,
        "round" .= rnd
      ]

instance FromJSON BestSequencedBlockJSON where
  parseJSON = JSON.withObject "BestSequencedBlock" $ \o ->
    BestSequencedBlockJSON
      <$> ( BestSequencedBlock
              <$> o .: "hash"
              <*> o .: "number"
              <*> o .: "validators"
              <*> o .: "stakes"
              <*> o .: "round"
          )

-- | Highest block slipstream has indexed into Cirrus.
newtype CirrusTip = CirrusTip {unCirrusTip :: Integer}
  deriving (Eq, Show)

getNodeBestBlock :: HasSQLDB m => m (Maybe BestBlock)
getNodeBestBlock = fmap unBestBlockJSON <$> sqlQuery (getNodeStatusSql BestBlockKey)

getNodeBestSequencedBlock :: HasSQLDB m => m (Maybe BestSequencedBlock)
getNodeBestSequencedBlock =
  fmap unBestSequencedBlockJSON <$> sqlQuery (getNodeStatusSql BestSequencedBlockKey)

getNodeWorldBestBlock :: HasSQLDB m => m (Maybe WorldBestBlock)
getNodeWorldBestBlock =
  fmap (WorldBestBlock . unBestBlockJSON) <$> sqlQuery (getNodeStatusSql WorldBestBlockKey)

-- | The derived flag (see 'Blockchain.SyncDB.getSyncStatusNow'): the p2p/VM
-- pipeline has caught up with the network's best block.
getNodeSyncStatus :: HasSQLDB m => m (Maybe Bool)
getNodeSyncStatus = sqlQuery (getNodeStatusSql SyncStatusKey)

getNodeCirrusTip :: HasSQLDB m => m (Maybe CirrusTip)
getNodeCirrusTip = fmap CirrusTip <$> sqlQuery (getNodeStatusSql CirrusTipKey)
