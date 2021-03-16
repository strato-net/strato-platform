{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.DB.X509CertDB (
  X509Cert,
  X509CertDB(..),
  HasX509CertDB,
  genericLookupX509CertDB,
  genericInsertX509CertDB,
  genericDeleteX509CertDB
  ) where


import           Control.DeepSeq
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Data.Binary
import qualified Data.ByteString.Lazy               as BL
import           Data.Default
import qualified Database.LevelDB                   as DB
import           Prelude                            hiding (lookup)

import           Blockchain.Strato.Model.Address

import Data.ByteString (ByteString)     -- for temporary use

type X509Cert = ByteString

newtype X509CertDB = X509CertDB { unX509CertDB :: DB.DB }

instance NFData X509CertDB where
  rnf (X509CertDB a) = a `seq` ()

type HasX509CertDB m = (Address `Alters` X509Cert) m

genericLookupX509CertDB :: MonadIO m => m X509CertDB -> Address -> m (Maybe X509Cert)
genericLookupX509CertDB f address = do
  db <- unX509CertDB <$> f
  DB.get db def (BL.toStrict $ encode address)

genericInsertX509CertDB :: MonadIO m => m X509CertDB -> Address -> X509Cert -> m ()
genericInsertX509CertDB f address cert = do
  db <- unX509CertDB <$> f
  DB.put db def (BL.toStrict $ encode address) cert

genericDeleteX509CertDB :: MonadIO m => m X509CertDB -> Address -> m ()
genericDeleteX509CertDB f address = do
  db <- unX509CertDB <$> f
  DB.delete db def (BL.toStrict $ encode address)

-- instance MonadIO m => HasX509CertDB (ReaderT X509CertDB m)
instance MonadIO m => (Address `Alters` X509Cert) (ReaderT X509CertDB m) where
  lookup _ = genericLookupX509CertDB ask
  insert _ = genericInsertX509CertDB ask
  delete _ = genericDeleteX509CertDB ask

x509CertDBPut :: HasX509CertDB m => Address -> X509Cert -> m ()
x509CertDBPut = insert Proxy

x509CertDBGet :: HasX509CertDB m => Address -> m (Maybe X509Cert)
x509CertDBGet = lookup Proxy
