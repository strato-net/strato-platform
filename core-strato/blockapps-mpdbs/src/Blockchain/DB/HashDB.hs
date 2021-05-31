{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
module Blockchain.DB.HashDB (
  HashDB(..),
  HasHashDB,
  genericLookupHashDB,
  genericInsertHashDB,
  genericDeleteHashDB,
  hashDBPut,
  hashDBGet
  ) where

import           Control.Arrow                               ((&&&))
import           Control.DeepSeq
import           Control.Monad.FT
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Data.Default
import qualified Database.LevelDB                            as DB
import           Prelude                                     hiding (lookup)

import qualified Blockchain.Database.MerklePatricia.Internal as MP
import           Blockchain.Util
import qualified Data.NibbleString                           as N

newtype HashDB = HashDB { unHashDB :: DB.DB }

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
  DB.put db def
    (nibbleString2ByteString key)
    (nibbleString2ByteString value)

genericDeleteHashDB :: MonadIO m => m HashDB -> N.NibbleString -> m ()
genericDeleteHashDB f key = do
  db <- unHashDB <$> f
  DB.delete db def (nibbleString2ByteString key)

instance MonadIO m => Selectable N.NibbleString N.NibbleString (ReaderT HashDB m) where
  select = genericLookupHashDB ask
instance MonadIO m => Insertable N.NibbleString N.NibbleString (ReaderT HashDB m) where
  insert = genericInsertHashDB ask
instance MonadIO m => Deletable  N.NibbleString N.NibbleString (ReaderT HashDB m) where
  delete = genericDeleteHashDB ask
instance MonadIO m => Alterable  N.NibbleString N.NibbleString (ReaderT HashDB m) where

hashDBPut :: HasHashDB m => N.NibbleString -> m ()
hashDBPut = uncurry insert . (MP.keyToSafeKey &&& id)

hashDBGet :: HasHashDB m => N.NibbleString -> m (Maybe N.NibbleString)
hashDBGet = select
