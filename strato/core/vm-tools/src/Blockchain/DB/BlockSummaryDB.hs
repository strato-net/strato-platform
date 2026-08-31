{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.BlockSummaryDB
  ( BlockSummaryDB (..),
    HasBlockSummaryDB,
    genericLookupBlockSummaryDB,
    genericInsertBlockSummaryDB,
    genericDeleteBlockSummaryDB,
    putBSum,
    getBSum,
    hasBSum,
  )
where

import Blockchain.Data.BlockSummary
import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia.Profile
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Maybe
import qualified Database.LevelDB as LDB
import Text.Format

newtype BlockSummaryDB = BlockSummaryDB {unBlockSummaryDB :: LDB.DB}

instance NFData BlockSummaryDB where
  rnf (BlockSummaryDB db) = db `seq` ()

type HasBlockSummaryDB m = (Keccak256 `A.Alters` BlockSummary) m

genericLookupBlockSummaryDB :: MonadIO m => m BlockSummaryDB -> Keccak256 -> m (Maybe BlockSummary)
genericLookupBlockSummaryDB f blockHash = do
  db <- unBlockSummaryDB <$> f
  let key = BL.toStrict $ encode blockHash
  result <- LDB.get db LDB.defaultReadOptions key
  liftIO $ do
    bumpDBProfile LevelDBGetOps 1
    bumpDBProfile LevelDBGetKeyBytes $ fromIntegral (B.length key)
    case result of
      Nothing -> bumpDBProfile LevelDBGetMisses 1
      Just bytes -> do
        bumpDBProfile LevelDBGetHits 1
        bumpDBProfile LevelDBReadBytes $ fromIntegral (B.length bytes)
  pure $ fmap (rlpDecode . rlpDeserialize) result

genericInsertBlockSummaryDB :: MonadIO m => m BlockSummaryDB -> Keccak256 -> BlockSummary -> m ()
genericInsertBlockSummaryDB f blockHash bSum = do
  db <- unBlockSummaryDB <$> f
  let key = BL.toStrict $ encode blockHash
      value = rlpSerialize $ rlpEncode bSum
  LDB.put db LDB.defaultWriteOptions key value
  liftIO $ do
    bumpDBProfile LevelDBPutOps 1
    bumpDBProfile LevelDBWriteBytes $ fromIntegral (B.length key + B.length value)

genericDeleteBlockSummaryDB :: MonadIO m => m BlockSummaryDB -> Keccak256 -> m ()
genericDeleteBlockSummaryDB f blockHash = do
  db <- unBlockSummaryDB <$> f
  let key = BL.toStrict $ encode blockHash
  LDB.delete db LDB.defaultWriteOptions key
  liftIO $ do
    bumpDBProfile LevelDBDeleteOps 1
    bumpDBProfile LevelDBDeleteKeyBytes $ fromIntegral (B.length key)

getBSum :: HasBlockSummaryDB m => Keccak256 -> m BlockSummary
getBSum blockHash =
  fromMaybe (error $ "missing value in block summary DB: " ++ format blockHash)
    <$> A.lookup (A.Proxy @BlockSummary) blockHash

putBSum :: HasBlockSummaryDB m => Keccak256 -> BlockSummary -> m ()
putBSum = A.insert (A.Proxy @BlockSummary)

hasBSum :: HasBlockSummaryDB m => Keccak256 -> m Bool
hasBSum blockHash = isJust <$> A.lookup (A.Proxy @BlockSummary) blockHash
