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
    X509Certificate(..)
  , Subject(..)
  , certToBytes
  , bsToCert
  , getCertSubject
  , pubToBytes
  , X509CertDB(..)
  , HasX509CertDB
  , genericLookupX509CertDB
  , genericInsertX509CertDB
  , genericDeleteX509CertDB
  , x509CertDBPut
  , x509CertDBGet
  ) where


import           Control.DeepSeq
import           Control.Monad.FT
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import qualified Data.ByteString.Char8              as BC
import           Data.Default
import           Data.Either.Extra (eitherToMaybe)
import qualified Database.LevelDB                   as DB
import           Prelude                            hiding (lookup)

import           Blockchain.Strato.Model.Account
import           BlockApps.X509

newtype X509CertDB = X509CertDB { unX509CertDB :: DB.DB }

instance NFData X509CertDB where
  rnf (X509CertDB a) = a `seq` ()

type HasX509CertDB m = (Account `Alters` X509Certificate) m

genericLookupX509CertDB :: MonadIO m => m X509CertDB -> Account -> m (Maybe X509Certificate)
genericLookupX509CertDB f account = do
  db <- unX509CertDB <$> f
  maybeX509 <- DB.get db def (BC.pack $ show account)
  return $ (eitherToMaybe . bsToCert) =<< maybeX509

genericInsertX509CertDB :: MonadIO m => m X509CertDB -> Account -> X509Certificate -> m ()
genericInsertX509CertDB f account cert = do
  db <- unX509CertDB <$> f
  DB.put db def (BC.pack $ show account) (certToBytes cert)

genericDeleteX509CertDB :: MonadIO m => m X509CertDB -> Account -> m ()
genericDeleteX509CertDB f account = do
  db <- unX509CertDB <$> f
  DB.delete db def (BC.pack $ show account)

-- GHC bug? Why can't we use the line below to create this instance, even with all the
-- extensions enabled for it?
-- instance MonadIO m => HasX509CertDB (ReaderT X509CertDB m) where
instance MonadIO m => Selectable X509Certificate Account (ReaderT X509CertDB m) where
  select = genericLookupX509CertDB ask
instance MonadIO m => Insertable X509Certificate Account (ReaderT X509CertDB m) where
  insert = genericInsertX509CertDB ask
instance MonadIO m => Deletable  X509Certificate Account (ReaderT X509CertDB m) where
  delete = genericDeleteX509CertDB ask
instance MonadIO m => Alterable  X509Certificate Account (ReaderT X509CertDB m) where

x509CertDBPut :: HasX509CertDB m => Account -> X509Certificate -> m ()
x509CertDBPut = insert

x509CertDBGet :: HasX509CertDB m => Account -> m (Maybe X509Certificate)
x509CertDBGet = select
