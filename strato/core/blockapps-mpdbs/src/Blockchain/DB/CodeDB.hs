{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.DB.CodeDB
  ( CodeDB (..),
    CodeKind (..),
    HasCodeDB,
    DBCode,
    MemCodeDB (..),
    runMemCodeDB,
    runNewMemCodeDB,
    shaToKey,
    dbCodeToValue,
    genericLookupCodeDB,
    genericInsertCodeDB,
    genericDeleteCodeDB,
    addCode,
    getCode,
    getCodeKind,
    getExternallyOwned,
    codeDBGet,
    codeDBPut,
  )
where

import Blockchain.Database.MerklePatricia
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.State.Strict
import Data.Bifunctor (first)
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Default
import qualified Data.Map.Strict as M
import qualified Database.LevelDB as DB
import Prelude hiding (lookup)

newtype CodeDB = CodeDB {unCodeDB :: DB.DB}

instance NFData CodeDB where
  rnf (CodeDB a) = a `seq` ()

type HasCodeDB m = (Keccak256 `A.Alters` DBCode) m

type DBCode = (CodeKind, B.ByteString)

newtype MemCodeDB m a = MemCodeDB {unMemCodeDB :: StateT (M.Map Keccak256 DBCode) m a}
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadTrans MemCodeDB where
  lift = MemCodeDB . lift

instance Monad m => (Keccak256 `A.Alters` DBCode) (MemCodeDB m) where
  lookup _ = MemCodeDB . gets . M.lookup
  insert _ k = MemCodeDB . modify' . M.insert k
  delete _ = MemCodeDB . modify' . M.delete

runMemCodeDB :: Monad m => MemCodeDB m a -> M.Map Keccak256 DBCode -> m a
runMemCodeDB f m = evalStateT (unMemCodeDB f) m

runNewMemCodeDB :: Monad m => MemCodeDB m a -> m a
runNewMemCodeDB f = runMemCodeDB f M.empty

shaToKey :: Keccak256 -> B.ByteString
shaToKey = BL.toStrict . encode . sha2StateRoot

dbCodeToValue :: DBCode -> B.ByteString
dbCodeToValue = uncurry B.cons . first toWord8

genericLookupCodeDB :: MonadIO m => m CodeDB -> Keccak256 -> m (Maybe DBCode)
genericLookupCodeDB f codeHash = do
  db <- unCodeDB <$> f
  mFullBS <- DB.get db def $ shaToKey codeHash
  return $ do
    fullBS <- mFullBS
    (h, t) <- B.uncons fullBS
    return (fromWord8 h, t)

genericInsertCodeDB :: MonadIO m => m CodeDB -> Keccak256 -> DBCode -> m ()
genericInsertCodeDB f codeHash code = do
  db <- unCodeDB <$> f
  DB.put db def (shaToKey codeHash) (dbCodeToValue code)

genericDeleteCodeDB :: MonadIO m => m CodeDB -> Keccak256 -> m ()
genericDeleteCodeDB f codeHash = do
  db <- unCodeDB <$> f
  DB.delete db def (shaToKey codeHash)

instance MonadIO m => (Keccak256 `A.Alters` DBCode) (ReaderT CodeDB m) where
  lookup _ = genericLookupCodeDB ask
  insert _ = genericInsertCodeDB ask
  delete _ = genericDeleteCodeDB ask

toWord8 :: CodeKind -> Word8
toWord8 = fromIntegral . fromEnum

fromWord8 :: Word8 -> CodeKind
fromWord8 = toEnum . fromIntegral

addCode :: HasCodeDB m => CodeKind -> B.ByteString -> m Keccak256
addCode = codeDBPut

getCode :: HasCodeDB m => Keccak256 -> m (Maybe DBCode)
getCode = codeDBGet

getExternallyOwned :: HasCodeDB m => Keccak256 -> m B.ByteString
getExternallyOwned hsh = maybe "" snd <$> getCode hsh

getCodeKind :: HasCodeDB m => Keccak256 -> m CodeKind
getCodeKind hsh = maybe (error $ "no codekind found for " ++ show hsh) fst <$> getCode hsh

codeDBPut :: HasCodeDB m => CodeKind -> B.ByteString -> m Keccak256
codeDBPut kind code = do
  let hsh = hash code
  A.insert A.Proxy hsh (kind, code)
  return hsh

codeDBGet :: HasCodeDB m => Keccak256 -> m (Maybe DBCode)
codeDBGet = A.lookup A.Proxy
