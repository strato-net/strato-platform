
module Blockchain.DB.BlockSummaryDB (
  BlockSummaryDB,
  HasBlockSummaryDB(..),
  putBSum,
  getBSum,
  hasBSum
  ) where


import           Control.Monad.IO.Class
import           Data.Binary
import qualified Data.ByteString.Lazy         as BL
import           Data.Maybe
import qualified Database.LevelDB             as LDB

import           Blockchain.Data.BlockSummary
import           Blockchain.Data.RLP
import           Blockchain.SHA

import           Text.Format

type BlockSummaryDB = LDB.DB

class MonadIO m => HasBlockSummaryDB m where
  getBlockSummaryDB :: m BlockSummaryDB


getBSum:: HasBlockSummaryDB m=>SHA->m BlockSummary
getBSum blockHash = do
  db <- getBlockSummaryDB
  fmap (rlpDecode . rlpDeserialize . fromMaybe (error $ "missing value in block summary DB: " ++ format blockHash)) $ LDB.get db LDB.defaultReadOptions $ BL.toStrict $ encode blockHash

putBSum::HasBlockSummaryDB m=>SHA->BlockSummary->m ()
putBSum blockHash bSum = do
  db <- getBlockSummaryDB
  LDB.put db LDB.defaultWriteOptions (BL.toStrict $ encode blockHash) (rlpSerialize $ rlpEncode bSum)

hasBSum::HasBlockSummaryDB m=>SHA->m Bool
hasBSum blockHash = do
    db <- getBlockSummaryDB
    isJust <$> LDB.get db LDB.defaultReadOptions (BL.toStrict $ encode blockHash)
