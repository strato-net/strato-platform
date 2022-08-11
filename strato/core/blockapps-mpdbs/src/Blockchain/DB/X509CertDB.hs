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
  , getCertIssuer
  , rootCert
  , rootPubKey
  , pubToBytes
  , bsToPub
  , verifyCert
  , verifyCertSignedBy
  , verifyBlockApps
  , X509CertDB(..)
  , HasX509CertDB
  , flushX509ToLevelDB
  , genericLookupX509CertDB
  , genericInsertX509CertDB
  , genericDeleteX509CertDB
  , x509CertDBPut
  , x509CertDBGet
  , getParentUserAddress
  , getCertValidity
  , dateTimeToString
  ) where


import           Control.DeepSeq
import           Control.Monad.Change.Alter
import qualified Control.Monad.Change.Modify       as Mod
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Data.Default
import           Data.Either.Extra (eitherToMaybe)
import           Data.Map                           (Map, empty)
import qualified Database.LevelDB                   as DB
import           Prelude                            hiding (lookup)

import           Blockchain.Strato.Model.Address
import           BlockApps.X509

newtype X509CertDB = X509CertDB { unX509CertDB :: DB.DB }

instance NFData X509CertDB where
  rnf (X509CertDB a) = a `seq` ()

type HasX509CertDB m = (Address `Alters` X509Certificate) m

genericLookupX509CertDB :: MonadIO m => m X509CertDB -> Address -> m (Maybe X509Certificate)
genericLookupX509CertDB f address = do
  db <- unX509CertDB <$> f
  maybeX509 <- DB.get db def (addressToHex address)
  return $ (eitherToMaybe . bsToCert) =<< maybeX509

genericInsertX509CertDB :: MonadIO m => m X509CertDB -> Address -> X509Certificate -> m ()
genericInsertX509CertDB f address cert = do
  db <- unX509CertDB <$> f
  DB.put db def (addressToHex address) (certToBytes cert)

genericDeleteX509CertDB :: MonadIO m => m X509CertDB -> Address -> m ()
genericDeleteX509CertDB f address = do
  db <- unX509CertDB <$> f
  DB.delete db def (addressToHex address)

flushX509ToLevelDB :: (Mod.Modifiable (Map Address X509Certificate) m, HasX509CertDB m) => m ()
flushX509ToLevelDB = do
    x509s <- Mod.get (Proxy @(Map Address X509Certificate))
    insertMany (Proxy @X509Certificate) x509s
    Mod.put (Mod.Proxy @(Map Address X509Certificate)) empty

-- GHC bug? Why can't we use the line below to create this instance, even with all the
-- extensions enabled for it?
-- instance MonadIO m => HasX509CertDB (ReaderT X509CertDB m) where
instance MonadIO m => (Address `Alters` X509Certificate) (ReaderT X509CertDB m) where
  lookup _ = genericLookupX509CertDB ask
  insert _ = genericInsertX509CertDB ask
  delete _ = genericDeleteX509CertDB ask

x509CertDBPut :: HasX509CertDB m => Address -> X509Certificate -> m ()
x509CertDBPut = insert Proxy

x509CertDBGet :: HasX509CertDB m => Address -> m (Maybe X509Certificate)
x509CertDBGet = lookup Proxy
