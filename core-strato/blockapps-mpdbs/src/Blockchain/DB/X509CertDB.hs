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
  , x509CertDBDelete
  , x509CertDBGet
  , x509CertFlush
  , x509CertCacheTop
  , x509CertCachePop
  , x509CertCachePut
  , x509CertGetOrg
  , x509CertGetUser
  , x509CertGetGroup
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

type Modification a = Maybe a  -- Just a = value changed to a; Nothing = value deleted

newtype X509CertDB = X509CertDB { unX509CertDB :: DB.DB }

type X509CertMap = Map Address (Modification X509Certificate)

instance NFData X509CertDB where
  rnf (X509CertDB a) = a `seq` ()

type HasX509CertDB m = (Address `Flushable` X509Certificate) m

genericLookupX509CertDB :: MonadIO m => X509CertDB -> X509CertMap -> Address -> m (Maybe X509Certificate)
genericLookupX509CertDB (X509CertDB db) mp address = do
  maybeX509 <- DB.get db def (addressToHex address)
  let maybeX509Level = (eitherToMaybe . bsToCert) =<< maybeX509
      maybeX509' = join $ M.lookup address mp
      myX509 = maybeX509' <|> maybeX509Level
  return $ myX509

genericInsertX509CertDB :: X509CertMap -> Address -> X509Certificate -> X509CertMap
genericInsertX509CertDB f address cert = M.insert address (Just cert) f

genericDeleteX509CertDB :: X509CertMap -> Address -> X509CertMap
genericDeleteX509CertDB f address = M.insert address Nothing f

genericFlushX509 :: MonadIO m => X509CertDB -> X509CertMap -> m ()
genericFlushX509 (X509CertDB db)  mp = M.traverseWithKey traverseFunc mp >> pure ()
    where traverseFunc k v = case v of
                Just v'     -> DB.put db def (addressToHex k) (certToBytes v')
                Nothing     -> DB.delete db def (addressToHex k)

instance MonadIO m => (Address `Alters` X509Certificate) (ReaderT X509CertDB (StateT X509CertMap m)) where
  lookup _ k = join $ liftA3 genericLookupX509CertDB ask (lift get) (pure k)
  insert _ k v = lift $ modify (\m -> genericInsertX509CertDB m k v)
  delete _ k = lift $ modify (\m -> genericDeleteX509CertDB m k)

class Alters k a f => Flushable k a f where
    flush :: Proxy a -> Proxy k -> f ()
    topCache :: Proxy a -> Proxy k -> f X509CertMap
    popCache :: Proxy a -> Proxy k -> f X509CertMap

instance MonadIO m => (Address `Flushable` X509Certificate) (ReaderT X509CertDB (StateT X509CertMap m)) where
    flush _ _ = join (liftA2 genericFlushX509 ask (lift get))
                    >> lift (put M.empty)
    topCache _ _ = lift get
    popCache _ _ = lift get <* lift (put M.empty)

x509CertDBPut :: HasX509CertDB m => Address -> X509Certificate -> m ()
x509CertDBPut = insert Proxy

x509CertDBGet :: HasX509CertDB m => Address -> m (Maybe X509Certificate)
x509CertDBGet = lookup Proxy

x509CertDBDelete :: HasX509CertDB m => Address -> m ()
x509CertDBDelete = delete (Proxy :: Proxy X509Certificate)

x509CertFlush :: HasX509CertDB m => m () 
x509CertFlush = flush (Proxy :: Proxy X509Certificate) (Proxy :: Proxy Address)

x509CertCacheTop :: HasX509CertDB m => m X509CertMap
x509CertCacheTop = topCache (Proxy :: Proxy X509Certificate) (Proxy :: Proxy Address)

x509CertCachePop :: HasX509CertDB m => m X509CertMap
x509CertCachePop = popCache (Proxy :: Proxy X509Certificate) (Proxy :: Proxy Address)

x509CertCachePut :: HasX509CertDB m => X509CertMap -> m ()
x509CertCachePut mp = M.traverseWithKey traverseFunc mp >> pure ()
    where traverseFunc :: HasX509CertDB m => Address -> Modification X509Certificate -> m ()
          traverseFunc k v = case v of
                Just v'     -> insert Proxy k v'
                Nothing     -> delete (Proxy :: Proxy X509Certificate) k

x509CertGetOrg :: HasX509CertDB m => Address -> m String
x509CertGetOrg addr = x509CertOrg <$> x509CertDBGet addr

x509CertGetUser :: HasX509CertDB m => Address -> m String
x509CertGetUser addr = x509CertUser <$> x509CertDBGet addr

x509CertGetGroup :: HasX509CertDB m => Address -> m String
x509CertGetGroup addr = x509CertGroup <$> x509CertDBGet addr

x509CertOrg :: Maybe X509Certificate -> String
x509CertOrg mcert = fromMaybe "" . fmap subOrg $ getCertSubject =<< mcert

x509CertUser :: Maybe X509Certificate -> String
x509CertUser mcert = fromMaybe "" . fmap subCommonName $ getCertSubject =<< mcert

x509CertGroup :: Maybe X509Certificate -> String
x509CertGroup mcert = fromMaybe "" $ subUnit =<< getCertSubject =<< mcert
