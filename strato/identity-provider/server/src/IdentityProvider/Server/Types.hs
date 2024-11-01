{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators #-}

module IdentityProvider.Server.Types where

import BlockApps.X509 hiding (isValid)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Change.Modify
import Control.Monad.Reader
import Data.Text (Text)
import Data.Time (UTCTime, diffUTCTime, getCurrentTime)
import Data.IORef ()
import IdentityProvider.Email (SendgridAPIKey)
import IdentityProvider.OAuth hiding (issuer)
import Servant.Client hiding (manager, responseBody)
import Strato.Strato23.API
import UnliftIO hiding (Handler)
import qualified Data.Cache.LRU as LRU

data IdentityError
  = IdentityError Text
  | ExistingIdentity Text
  deriving (Show, Exception)

data IdentityServerData = IdentityServerData
  { issuer :: Issuer, -- issuer of signing cert
    issuerCert :: X509Certificate, -- the signing cert
    issuerPrivKey :: PrivateKey, -- the signing private key
    nodeUrl :: BaseUrl,
    fallbackNodeUrl :: Maybe BaseUrl,
    userRegAddr :: Address,
    userRegCodeHash :: Maybe Keccak256,
    userTableName :: String,
    tokenEndpoint :: String,
    clientId :: String,
    clientSecret :: String,
    accessTokenRef :: IORef (Maybe AccessToken, UTCTime),
    cacheRef :: IORef (LRU.LRU String Address), -- commonName -> userAddress
    notificationServerUrl :: Maybe String,
    sendgridAPIKey :: Maybe SendgridAPIKey
  }

instance Monad m => Accessible IdentityServerData (ReaderT IdentityServerData m) where
  access _ = ask

instance Monad m => Accessible Issuer (ReaderT IdentityServerData m) where
  access _ = asks issuer

instance Monad m => Accessible X509Certificate (ReaderT IdentityServerData m) where
  access _ = asks issuerCert

instance Monad m => Accessible PrivateKey (ReaderT IdentityServerData m) where
  access _ = asks issuerPrivKey

instance Monad m => Accessible (Maybe SendgridAPIKey) (ReaderT IdentityServerData m) where
  access _ = asks sendgridAPIKey

instance MonadIO m => Accessible (Maybe AccessToken) (ReaderT IdentityServerData m) where
  access _ = do
    now <- liftIO getCurrentTime
    ref <- asks accessTokenRef
    readIORef ref >>= \case 
      (Just a@AccessToken {expires_in = ex}, timeRetrieved)
        | (now `diffUTCTime` timeRetrieved) < (fromIntegral ex) ->
            return $ Just a
      _ -> do 
        ci <- asks clientId
        cs <- asks clientSecret
        te <- asks tokenEndpoint
        token <- getAccessToken ci cs te
        atomicWriteIORef ref (token, now)
        return token

instance MonadIO m => (String `A.Alters` Address) (ReaderT IdentityServerData m) where
  lookup _ k = do
    ref <- asks cacheRef
    cache <- readIORef ref
    let (!newCache, !mAdd) = LRU.lookup k cache
    atomicWriteIORef ref newCache
    return mAdd

  insert _ k v = do
    ref <- asks cacheRef
    atomicModifyIORef' ref (\lru -> (LRU.insert k v lru, ()))

  delete _ k = do
    ref <- asks cacheRef
    void $ atomicModifyIORef' ref (\lru -> LRU.delete k lru)