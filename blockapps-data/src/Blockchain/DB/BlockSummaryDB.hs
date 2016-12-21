
module Blockchain.DB.BlockSummaryDB (
  BlockSummaryDB,
  HasBlockSummaryDB(..),
  putBSum,
  getBSum
  ) where


import Control.Monad.Trans.Resource
import Data.Binary
import qualified Data.ByteString.Lazy as BL
import Data.Maybe
import qualified Database.LevelDB as LDB

import Blockchain.Data.BlockSummary
import Blockchain.Data.RLP
import Blockchain.Format
import Blockchain.SHA

type BlockSummaryDB = LDB.DB

class MonadResource m=>
      HasBlockSummaryDB m where
  getBlockSummaryDB::Monad m=>m BlockSummaryDB

        
getBSum::(MonadResource m, HasBlockSummaryDB m)=>SHA->m BlockSummary
getBSum blockHash = do
  db <- getBlockSummaryDB
  fmap (rlpDecode . rlpDeserialize . fromMaybe (error $ "missing value in block summary DB: " ++ format blockHash)) $ LDB.get db LDB.defaultReadOptions $ BL.toStrict $ encode blockHash

putBSum::(MonadResource m, HasBlockSummaryDB m)=>SHA->BlockSummary->m ()
putBSum blockHash bSum = do
  db <- getBlockSummaryDB
  LDB.put db LDB.defaultWriteOptions (BL.toStrict $ encode blockHash) (rlpSerialize $ rlpEncode bSum)


