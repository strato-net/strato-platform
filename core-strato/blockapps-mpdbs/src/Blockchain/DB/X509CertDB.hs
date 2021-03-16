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
import           Data.Either.Extra (eitherToMaybe)
import qualified Database.LevelDB                   as DB
import           Prelude                            hiding (lookup)

import           Blockchain.Strato.Model.Address
import           BlockApps.X509 (X509Certificate, certToBytes, bsToCert)

newtype X509CertDB = X509CertDB { unX509CertDB :: DB.DB }

instance NFData X509CertDB where
  rnf (X509CertDB a) = a `seq` ()

type HasX509CertDB m = (Address `Alters` X509Certificate) m

genericLookupX509CertDB :: MonadIO m => m X509CertDB -> Address -> m (Maybe X509Certificate)
genericLookupX509CertDB f address = do
  db <- unX509CertDB <$> f
  maybeX509 <- DB.get db def (BL.toStrict $ encode address)
  return $ (eitherToMaybe . bsToCert) =<< maybeX509

genericInsertX509CertDB :: MonadIO m => m X509CertDB -> Address -> X509Certificate -> m ()
genericInsertX509CertDB f address cert = do
  db <- unX509CertDB <$> f
  DB.put db def (BL.toStrict $ encode address) (certToBytes cert)

genericDeleteX509CertDB :: MonadIO m => m X509CertDB -> Address -> m ()
genericDeleteX509CertDB f address = do
  db <- unX509CertDB <$> f
  DB.delete db def (BL.toStrict $ encode address)

-- instance MonadIO m => HasX509CertDB (ReaderT X509CertDB m)
instance MonadIO m => (Address `Alters` X509Certificate) (ReaderT X509CertDB m) where
  lookup _ = genericLookupX509CertDB ask
  insert _ = genericInsertX509CertDB ask
  delete _ = genericDeleteX509CertDB ask

x509CertDBPut :: HasX509CertDB m => Address -> X509Certificate -> m ()
x509CertDBPut = insert Proxy

x509CertDBGet :: HasX509CertDB m => Address -> m (Maybe X509Certificate)
x509CertDBGet = lookup Proxy
