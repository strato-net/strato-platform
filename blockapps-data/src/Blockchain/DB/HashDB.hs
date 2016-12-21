
module Blockchain.DB.HashDB (
  HashDB,
  HasHashDB(..),
  hashDBPut,
  hashDBGet
  ) where

import Control.Monad.State
import Control.Monad.Trans.Resource
import Data.Default
import qualified Database.LevelDB as DB

import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.Util
import qualified Data.NibbleString as N

type HashDB = DB.DB

class MonadResource m=>
      HasHashDB m where
  getHashDB::Monad m=>m HashDB

hashDBPut::HasHashDB m=>N.NibbleString->m ()
hashDBPut unsafeKey = do
  db <- getHashDB
  DB.put db def
    (nibbleString2ByteString $ MP.keyToSafeKey unsafeKey)
    (nibbleString2ByteString unsafeKey)

hashDBGet::HasHashDB m=>N.NibbleString->m (Maybe N.NibbleString)
hashDBGet key = do
  db <- getHashDB
  liftM (fmap byteString2NibbleString) $
    DB.get db def (nibbleString2ByteString key)
