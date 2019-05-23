{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.DB.CodeDB (
  CodeDB(..),
  CodeKind(..),
  HasCodeDB,
  DBCode,
  shaToKey,
  dbCodeToValue,
  genericLookupCodeDB,
  genericInsertCodeDB,
  genericDeleteCodeDB,
  addCode,
  getCode,
  getCodeKind,
  getEVMCode,
  codeDBGet,
  codeDBPut
  ) where



import           Control.DeepSeq
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Data.Bifunctor                     (first)
import           Data.Binary
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Lazy               as BL
import           Data.Default
import qualified Database.LevelDB                   as DB
import           Prelude                            hiding (lookup)

import           Blockchain.Database.MerklePatricia
import           Blockchain.SHA
import           Blockchain.SolidVM.Model

newtype CodeDB = CodeDB { unCodeDB :: DB.DB }

instance NFData CodeDB where
  rnf (CodeDB a) = a `seq` ()

type HasCodeDB m = (SHA `Alters` DBCode) m

type DBCode = (CodeKind, B.ByteString)

shaToKey :: SHA -> B.ByteString
shaToKey = BL.toStrict . encode . sha2StateRoot

dbCodeToValue :: DBCode -> B.ByteString
dbCodeToValue = uncurry B.cons . first toWord8

--codeValueToCode :: B.ByteString -> Either String Code
--codeValueToCode = maybe (Left err) (Right . first fromWord8) . B.uncons
--  where err = "codeValueToCode: encountered empty ByteString"

genericLookupCodeDB :: MonadIO m => m CodeDB -> SHA -> m (Maybe DBCode)
genericLookupCodeDB f codeHash = do
  db <- unCodeDB <$> f
  mFullBS <- DB.get db def $ shaToKey codeHash
  return $ do
    fullBS <- mFullBS
    (h, t) <- B.uncons fullBS
    return (fromWord8 h, t)

genericInsertCodeDB :: MonadIO m => m CodeDB -> SHA -> DBCode -> m ()
genericInsertCodeDB f codeHash code = do
  db <- unCodeDB <$> f
  DB.put db def (shaToKey codeHash) (dbCodeToValue code)

genericDeleteCodeDB :: MonadIO m => m CodeDB -> SHA -> m ()
genericDeleteCodeDB f codeHash = do
  db <- unCodeDB <$> f
  DB.delete db def (shaToKey codeHash)

instance MonadIO m => (SHA `Alters` DBCode) (ReaderT CodeDB m) where
  lookup _ = genericLookupCodeDB ask
  insert _ = genericInsertCodeDB ask
  delete _ = genericDeleteCodeDB ask

toWord8 :: CodeKind -> Word8
toWord8 = fromIntegral . fromEnum

fromWord8 :: Word8 -> CodeKind
fromWord8 = toEnum . fromIntegral

addCode :: HasCodeDB m => CodeKind -> B.ByteString -> m SHA
addCode = codeDBPut

getCode :: HasCodeDB m => SHA -> m (Maybe DBCode)
getCode = codeDBGet

getEVMCode :: HasCodeDB m => SHA -> m B.ByteString
getEVMCode hsh = maybe "" snd <$> getCode hsh

getCodeKind :: HasCodeDB m => SHA -> m CodeKind
getCodeKind hsh = maybe (error $ "no codekind found for " ++ show hsh) fst <$> getCode hsh

codeDBPut :: HasCodeDB m => CodeKind -> B.ByteString -> m SHA
codeDBPut kind code = do
  let hsh = hash code
  insert Proxy hsh (kind,code)
  return hsh

codeDBGet :: HasCodeDB m => SHA -> m (Maybe DBCode)
codeDBGet = lookup Proxy
