
module Blockchain.DB.BlockDB (
  HasBlockDB(..),
  BlockDB,
  blockDBGet,
  blockDBPut
  ) where

import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import Data.Default
import qualified Database.LevelDB as DB

type BlockDB = DB.DB
  
class MonadResource m=>
      HasBlockDB m where
  getBlockDB::Monad m=>m BlockDB

blockDBPut::HasBlockDB m=>B.ByteString->B.ByteString->m ()
blockDBPut key val = do
  db <- getBlockDB
  DB.put db def key val
    
blockDBGet::HasBlockDB m=>B.ByteString->m (Maybe B.ByteString)
blockDBGet key = do
  db <- getBlockDB
  DB.get db def key

