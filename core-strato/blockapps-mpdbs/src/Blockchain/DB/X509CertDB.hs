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
  X509Certificate,
  Subject(..),
  certToBytes,
  bsToCert,
  getCertSubject,
  pubToBytes,
  X509CertDB(..),
  HasX509CertDB,
  genericLookupX509CertDB,
  genericInsertX509CertDB,
  genericDeleteX509CertDB,
  x509CertDBPut,
  x509CertDBGet,
  getCertCommonName,
  getCertOrganization,
  getCertGroup
  ) where


import           Control.DeepSeq
import           Control.Monad.Change.Alter
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

-- instance MonadIO m => HasX509CertDB (ReaderT X509CertDB m)
instance MonadIO m => (Account `Alters` X509Certificate) (ReaderT X509CertDB m) where
  lookup _ = genericLookupX509CertDB ask
  insert _ = genericInsertX509CertDB ask
  delete _ = genericDeleteX509CertDB ask

x509CertDBPut :: HasX509CertDB m => Account -> X509Certificate -> m ()
x509CertDBPut = insert Proxy

x509CertDBGet :: HasX509CertDB m => Account -> m (Maybe X509Certificate)
x509CertDBGet = lookup Proxy
