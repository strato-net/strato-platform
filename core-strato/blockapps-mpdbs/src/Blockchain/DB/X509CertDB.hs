{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.DB.X509CertDB (
    X509Certificate(..)
  , Subject(..)
  , certToBytes
  , bsToCert
  , getCertSubject
  , pubToBytes
  , X509CertDB(..)
  , X509CertMap
  , HasX509CertDB
  , Flushable(..)
  , genericLookupX509CertDB
  , genericInsertX509CertDB
  , genericDeleteX509CertDB
  , genericFlushX509
  , x509CertDBPut
  , x509CertDBGet
  , x509CertFlush
  , x509CertGetOrg
  , x509CertOrg
  ) where


import           Control.DeepSeq
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.State
import           Control.Monad.Trans.Class         (lift)
import           Control.Applicative                hiding (empty)
import           Control.Monad
import           Data.Default
import           Data.Either.Extra (eitherToMaybe)
import           Data.Map                           (Map)
import qualified Data.Map                           as M
import           Data.Maybe                         (fromMaybe)
import qualified Database.LevelDB                   as DB
import           Prelude                            hiding (lookup)

import           Blockchain.Strato.Model.Address
import           BlockApps.X509

data Modification a = Modified a | Deleted deriving (Show)

newtype X509CertDB = X509CertDB { unX509CertDB :: DB.DB }

type X509CertMap = Map Address (Modification X509Certificate)

instance NFData X509CertDB where
  rnf (X509CertDB a) = a `seq` ()

instance NFData (Modification a) where
    rnf a = a `seq` ()

type HasX509CertDB m = (Address `Flushable` X509Certificate) m

genericLookupX509CertDB :: MonadIO m => X509CertDB -> X509CertMap -> Address -> m (Maybe X509Certificate)
genericLookupX509CertDB (X509CertDB db) mp address = do
  maybeX509 <- DB.get db def (addressToHex address)
  let maybeX509Level = (eitherToMaybe . bsToCert) =<< maybeX509
      maybeX509' = case M.lookup address mp of
                            Just (Modified cert)  -> Just cert
                            _                      -> Nothing
      myX509 = maybeX509' <|> maybeX509Level
  return $ myX509

genericInsertX509CertDB :: X509CertMap -> Address -> X509Certificate -> X509CertMap
genericInsertX509CertDB f address cert = M.insert address (Modified cert) f

genericDeleteX509CertDB :: X509CertMap -> Address -> X509CertMap
genericDeleteX509CertDB  f address = M.insert address Deleted f

genericFlushX509 :: MonadIO m => X509CertDB -> X509CertMap -> m ()
genericFlushX509 (X509CertDB db)  mp = M.traverseWithKey traverseFunc mp >> pure ()
    where traverseFunc k v = case v of
                Modified v' -> DB.put db def (addressToHex k) (certToBytes v')
                Deleted     -> DB.delete db def (addressToHex k)

instance MonadIO m => (Address `Alters` X509Certificate) (ReaderT X509CertDB (StateT X509CertMap m)) where
  lookup _ k = join $ liftA3 genericLookupX509CertDB ask (lift get) (pure k)
  insert _ k v = lift $ modify (\m -> genericInsertX509CertDB m k v)
  delete _ k = lift $ modify (\m -> genericDeleteX509CertDB m k)

class Alters k a f => Flushable k a f where
    flush :: Proxy a -> Proxy k -> f ()

instance MonadIO m => (Address `Flushable` X509Certificate) (ReaderT X509CertDB (StateT X509CertMap m)) where
    flush _ _ = join (liftA2 genericFlushX509 ask (lift get))
                    >> lift (put M.empty)

x509CertDBPut :: HasX509CertDB m => Address -> X509Certificate -> m ()
x509CertDBPut = insert Proxy

x509CertDBGet :: HasX509CertDB m => Address -> m (Maybe X509Certificate)
x509CertDBGet = lookup Proxy

x509CertFlush :: HasX509CertDB m => m () 
x509CertFlush = flush (Proxy :: Proxy X509Certificate) (Proxy :: Proxy Address)

x509CertGetOrg :: HasX509CertDB m => Address -> m String
x509CertGetOrg addr = x509CertOrg <$> x509CertDBGet addr

x509CertOrg :: Maybe X509Certificate -> String
x509CertOrg mcert = fromMaybe "" . fmap subOrg $ getCertSubject =<< mcert
