{-# LANGUAGE OverloadedStrings #-}
module Blockchain.DB.CodeDB (
  CodeDB,
  CodeKind(..),
  HasCodeDB(..),
  addCode,
  getCode,
  getEVMCode,
  codeDBGet,
  codeDBPut
  ) where


import           Control.Monad.Trans.Resource
import           Data.Binary
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Lazy               as BL
import           Data.Default
import qualified Database.LevelDB                   as DB

import           Blockchain.Database.MerklePatricia
import           Blockchain.SHA

type CodeDB = DB.DB

class MonadResource m => HasCodeDB m where
  getCodeDB :: m CodeDB

data CodeKind = EVM
              | SolidVM
              deriving (Eq, Show, Enum, Ord)

toWord8 :: CodeKind -> Word8
toWord8 = fromIntegral . fromEnum

fromWord8 :: Word8 -> CodeKind
fromWord8 = toEnum . fromIntegral

addCode :: (HasCodeDB m, MonadResource m) => CodeKind -> B.ByteString -> m ()
addCode = codeDBPut . toWord8

getCode :: (HasCodeDB m, MonadResource m) => SHA -> m (Maybe (CodeKind, B.ByteString))
getCode theHash = codeDBGet (BL.toStrict $ encode $ sha2StateRoot theHash)

getEVMCode :: (HasCodeDB m, MonadResource m) => SHA -> m B.ByteString
getEVMCode hsh = maybe "" snd <$> getCode hsh

codeDBPut :: HasCodeDB m => Word8 -> B.ByteString -> m ()
codeDBPut kind code = do
  db <- getCodeDB
  DB.put db def (BL.toStrict $ encode $ hash code) $ B.cons kind code


codeDBGet :: HasCodeDB m => B.ByteString -> m (Maybe (CodeKind, B.ByteString))
codeDBGet key = do
  db <- getCodeDB
  mFullBS <- DB.get db def key
  return $ do
    fullBS <- mFullBS
    (h, t) <- B.uncons fullBS
    return (fromWord8 h, t)
