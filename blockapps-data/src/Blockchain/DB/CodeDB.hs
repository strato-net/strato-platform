
module Blockchain.DB.CodeDB (
  CodeDB,
  HasCodeDB(..),
  addCode,
  getCode,
  codeDBGet,
  codeDBPut
  ) where


import Control.Monad.Trans.Resource
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Default
import qualified Database.LevelDB as DB

import Blockchain.SHA
import Blockchain.Database.MerklePatricia

type CodeDB = DB.DB

class MonadResource m=>
      HasCodeDB m where
  getCodeDB::Monad m=>m CodeDB

addCode::(HasCodeDB m, MonadResource m)=>B.ByteString->m ()
addCode = codeDBPut

getCode::(HasCodeDB m, MonadResource m)=>SHA->m (Maybe B.ByteString)
getCode theHash = 
  codeDBGet (BL.toStrict $ encode $ sha2StateRoot theHash)

codeDBPut::HasCodeDB m=>B.ByteString->m ()
codeDBPut code = do
  db <- getCodeDB
  DB.put db def (BL.toStrict $ encode $ hash code) code
    

codeDBGet::HasCodeDB m=>B.ByteString->m (Maybe B.ByteString)
codeDBGet key = do
  db <- getCodeDB
  DB.get db def key

