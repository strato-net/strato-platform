{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.HashDB
  ( HashDB (..),
    HasHashDB,
    genericLookupHashDB,
    genericInsertHashDB,
    genericDeleteHashDB,
    hashDBPut,
    hashDBPutAndGetSafeKey,
    hashDBGet,
  )
where

import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.Database.MerklePatricia.Profile
import Blockchain.Strato.Model.Util
import Control.DeepSeq
import Control.Monad (void)
import Control.Monad.Change.Alter
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Data.Default
import qualified Data.ByteString as B
import qualified Data.NibbleString as N
import qualified Database.LevelDB as DB
import Prelude hiding (lookup)

newtype HashDB = HashDB {unHashDB :: DB.DB}

instance NFData HashDB where
  rnf (HashDB a) = a `seq` ()

type HasHashDB m = (N.NibbleString `Alters` N.NibbleString) m

genericLookupHashDB :: MonadIO m => m HashDB -> N.NibbleString -> m (Maybe N.NibbleString)
genericLookupHashDB f key = do
  db <- unHashDB <$> f
  let rawKey = nibbleString2ByteString key
  result <- DB.get db def rawKey
  liftIO $ do
    bumpDBProfile LevelDBGetOps 1
    bumpDBProfile LevelDBGetKeyBytes $ fromIntegral (B.length rawKey)
    case result of
      Nothing -> bumpDBProfile LevelDBGetMisses 1
      Just bytes -> do
        bumpDBProfile LevelDBGetHits 1
        bumpDBProfile LevelDBReadBytes $ fromIntegral (B.length bytes)
  pure $ fmap byteString2NibbleString result

genericInsertHashDB :: MonadIO m => m HashDB -> N.NibbleString -> N.NibbleString -> m ()
genericInsertHashDB f key value = do
  db <- unHashDB <$> f
  let rawKey = nibbleString2ByteString key
      rawValue = nibbleString2ByteString value
  DB.put
    db
    def
    rawKey
    rawValue
  liftIO $ do
    bumpDBProfile LevelDBPutOps 1
    bumpDBProfile LevelDBWriteBytes $ fromIntegral (B.length rawKey + B.length rawValue)

genericDeleteHashDB :: MonadIO m => m HashDB -> N.NibbleString -> m ()
genericDeleteHashDB f key = do
  db <- unHashDB <$> f
  let rawKey = nibbleString2ByteString key
  DB.delete db def rawKey
  liftIO $ do
    bumpDBProfile LevelDBDeleteOps 1
    bumpDBProfile LevelDBDeleteKeyBytes $ fromIntegral (B.length rawKey)

instance MonadIO m => (N.NibbleString `Alters` N.NibbleString) (ReaderT HashDB m) where
  lookup _ = genericLookupHashDB ask
  insert _ = genericInsertHashDB ask
  delete _ = genericDeleteHashDB ask

hashDBPut :: HasHashDB m => N.NibbleString -> m ()
hashDBPut = void . hashDBPutAndGetSafeKey

-- | Populate the reverse-key database and return the hashed trie key. Callers
-- that immediately update the Merkle trie can reuse it instead of hashing the
-- same storage path a second time.
hashDBPutAndGetSafeKey :: HasHashDB m => N.NibbleString -> m N.NibbleString
hashDBPutAndGetSafeKey rawKey = do
  let safeKey = MP.keyToSafeKey rawKey
  insert (Proxy @N.NibbleString) safeKey rawKey
  pure safeKey

hashDBGet :: HasHashDB m => N.NibbleString -> m (Maybe N.NibbleString)
hashDBGet = lookup (Proxy @N.NibbleString)
