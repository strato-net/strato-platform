{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.DB.CodeCollectionDB (
  CodeCollectionDB(..),
  DBCodeCollection(..),
  shaToKey,
  genericLookupCodeCollectionDB,
  genericInsertCodeCollectionDB,
  genericDeleteCodeCollectionDB,
  codeCollectionDBGet,
  codeCollectionDBPut
  ) where



import           Control.DeepSeq
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Data.Binary
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Lazy               as BL
import           Data.Default
import qualified Database.LevelDB                   as DB
import           GHC.Generics
import           Prelude                            hiding (lookup)

import           Blockchain.Database.MerklePatricia
import           Blockchain.Strato.Model.Keccak256

newtype CodeCollectionDB = CodeCollectionDB { unCodeCollectionDB :: DB.DB }

instance NFData CodeCollectionDB where
  rnf (CodeCollectionDB a) = a `seq` ()

newtype DBCodeCollection = DBCodeCollection { unDBCodeCollection :: B.ByteString }
  deriving (Eq, Show, Generic, NFData)

shaToKey :: Keccak256 -> B.ByteString
shaToKey = BL.toStrict . encode . sha2StateRoot

genericLookupCodeCollectionDB :: MonadIO m => m CodeCollectionDB -> Keccak256 -> m (Maybe DBCodeCollection)
genericLookupCodeCollectionDB f codeCollectionHash = do
  db <- unCodeCollectionDB <$> f
  fmap DBCodeCollection <$> DB.get db def (shaToKey codeCollectionHash)

genericInsertCodeCollectionDB :: MonadIO m => m CodeCollectionDB -> Keccak256 -> DBCodeCollection -> m ()
genericInsertCodeCollectionDB f codeCollectionHash codeCollection = do
  db <- unCodeCollectionDB <$> f
  DB.put db def (shaToKey codeCollectionHash) (unDBCodeCollection codeCollection)

genericDeleteCodeCollectionDB :: MonadIO m => m CodeCollectionDB -> Keccak256 -> m ()
genericDeleteCodeCollectionDB f codeCollectionHash = do
  db <- unCodeCollectionDB <$> f
  DB.delete db def (shaToKey codeCollectionHash)

instance MonadIO m => (Keccak256 `Alters` DBCodeCollection) (ReaderT CodeCollectionDB m) where
  lookup _ = genericLookupCodeCollectionDB ask
  insert _ = genericInsertCodeCollectionDB ask
  delete _ = genericDeleteCodeCollectionDB ask

codeCollectionDBPut :: (Keccak256 `Alters` DBCodeCollection) m => B.ByteString -> m Keccak256
codeCollectionDBPut codeCollection = do
  let hsh = hash codeCollection
  insert Proxy hsh (DBCodeCollection codeCollection)
  return hsh

codeCollectionDBGet :: (Keccak256 `Alters` DBCodeCollection) m => Keccak256 -> m (Maybe DBCodeCollection)
codeCollectionDBGet = lookup Proxy

