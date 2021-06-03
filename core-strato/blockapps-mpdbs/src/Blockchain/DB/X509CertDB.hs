{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE LambdaCase                 #-}
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
  , genericLookupX509CertDB'
  , genericInsertX509CertDB'
  , genericDeleteX509CertDB'
  , genericFlushX509'
  , x509CertDBPut
  , x509CertDBGet
  , x509CertFlush
  ) where


import           Control.DeepSeq
import           Control.Monad.Change.Alter
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.State
import           Control.Monad.Trans.Class         (lift)
import           Control.Applicative                hiding (empty)
import           Data.Default
import           Data.Either.Extra (eitherToMaybe)
import           Data.Map                           (Map)
import qualified Data.Map                           as M
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

-- instance NFData X509CertMap where
--   rnf a = a `seq` ()

type HasX509CertDB m = (Address `Flushable` X509Certificate) m


genericLookupX509CertDB' :: MonadIO m => m X509CertDB -> m X509CertMap -> Address -> m (Maybe X509Certificate)
genericLookupX509CertDB' db mp address = do
  (X509CertDB certdb) <- db
  maping <- mp
  maybeX509 <- DB.get certdb def (addressToHex address)
  let maybeX509Level = (eitherToMaybe . bsToCert) =<< maybeX509
      maybeX509' = case M.lookup address maping of
                            Just (Modified cert)  -> Just cert
                            _                      -> Nothing
      myX509 = maybeX509' <|> maybeX509Level
  pure myX509

genericInsertX509CertDB' :: Monad m => m X509CertMap -> Address -> X509Certificate -> m X509CertMap
genericInsertX509CertDB' f address cert = M.insert address (Modified cert) <$> f

genericDeleteX509CertDB' :: Monad m => m X509CertMap -> Address -> m X509CertMap
genericDeleteX509CertDB' f address = M.insert address Deleted <$> f 

genericFlushX509' :: MonadIO m => m X509CertDB -> m X509CertMap -> m ()
genericFlushX509' db mp = do
    (X509CertDB certdb) <- db
    let traverseFunc k v = case v of
                Modified v' -> DB.put certdb def (addressToHex k) (certToBytes v')
                Deleted     -> DB.delete certdb def (addressToHex k)
    mapping <- mp
    _ <- M.traverseWithKey traverseFunc mapping
    pure ()







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
  lookup _ k = do -- lift ((\k a m -> genericLookupX509CertDB m a k) k <$> get) =<< ask  --flip genericLookupX509CertDB k $ (,) <$> ask <*> lift get
        db <- ask
        cmap <- lift get    
        genericLookupX509CertDB db cmap k
  insert _ k v = lift $ modify (\m -> genericInsertX509CertDB m k v) --modify genericInsertX509CertDB ask
  delete _ k = lift $ modify (\m -> genericDeleteX509CertDB m k)

class Alters k a f => Flushable k a f where
    flush :: Proxy a -> Proxy k -> f ()

instance MonadIO m => (Address `Flushable` X509Certificate) (ReaderT X509CertDB (StateT X509CertMap m)) where
    flush _ _ = do
        mp <- lift get
        db <- ask
        genericFlushX509 db mp
        lift . put $ M.empty

x509CertDBPut :: HasX509CertDB m => Address -> X509Certificate -> m ()
x509CertDBPut = insert Proxy

x509CertDBGet :: HasX509CertDB m => Address -> m (Maybe X509Certificate)
x509CertDBGet = lookup Proxy

x509CertFlush :: HasX509CertDB m => m () 
x509CertFlush = flush (Proxy :: Proxy X509Certificate) (Proxy :: Proxy Address)
