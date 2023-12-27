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
    hashDBGet,
  )
where

import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.Strato.Model.Util
import Control.Arrow ((&&&))
import Control.DeepSeq
import Control.Monad.Change.Alter
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Data.Default
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
  fmap byteString2NibbleString <$> DB.get db def (nibbleString2ByteString key)

genericInsertHashDB :: MonadIO m => m HashDB -> N.NibbleString -> N.NibbleString -> m ()
genericInsertHashDB f key value = do
  db <- unHashDB <$> f
  DB.put
    db
    def
    (nibbleString2ByteString key)
    (nibbleString2ByteString value)

genericDeleteHashDB :: MonadIO m => m HashDB -> N.NibbleString -> m ()
genericDeleteHashDB f key = do
  db <- unHashDB <$> f
  DB.delete db def (nibbleString2ByteString key)

instance MonadIO m => (N.NibbleString `Alters` N.NibbleString) (ReaderT HashDB m) where
  lookup _ = genericLookupHashDB ask
  insert _ = genericInsertHashDB ask
  delete _ = genericDeleteHashDB ask

hashDBPut :: HasHashDB m => N.NibbleString -> m ()
hashDBPut = uncurry (insert (Proxy @N.NibbleString)) . (MP.keyToSafeKey &&& id)

hashDBGet :: HasHashDB m => N.NibbleString -> m (Maybe N.NibbleString)
hashDBGet = lookup (Proxy @N.NibbleString)
