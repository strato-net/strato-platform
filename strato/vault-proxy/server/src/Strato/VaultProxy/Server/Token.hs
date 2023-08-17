{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE Strict #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Strato.VaultProxy.Server.Token where

import Control.Concurrent.Lock as L
import Control.Concurrent.STM
import Control.Monad
import Control.Monad.Catch
import qualified Control.Monad.Catch as C
import Control.Monad.IO.Class
import Data.ByteString.Base64 as B64
import Data.Cache as C
import Data.Cache.Internal as C
import Data.Maybe
import qualified Data.Text as T
import Data.Text.Encoding as TE
import Debug.Trace
import Network.HTTP.Client as HTC hiding (Proxy)
import Network.HTTP.Req as R
import Strato.VaultProxy.DataTypes
import Strato.VaultProxy.RawOauth
import System.Clock
import Text.URI as URI

class HasVirginTokenCall m where
  getVirginToken :: T.Text -> T.Text -> RawOauth -> m VaultToken

instance HasVirginTokenCall IO where
  --This will get a fresh brand new, minty fresh clean token from the OAuth provider,
  --User never really needs to use this function, it is mostly called by getAwesomeToken
  getVirginToken clientId clientSecret additionalOauth = do
    --virginToken
    --Conver the token endpoint to a URI
    uri <- URI.mkURI $ token_endpoint additionalOauth
    --Encode all of the parameters, get ready to send to server
    let (url, _) = fromJust (useHttpsURI $ uri)
        authHeadr = R.header "Authorization" $ TE.encodeUtf8 $ T.concat [T.pack "Basic ", B64.encodeBase64 $ TE.encodeUtf8 $ T.concat [clientId, ":", clientSecret]]
        contType = R.header "Content-Type" $ TE.encodeUtf8 $ T.pack "application/x-www-form-urlencoded"
        urlEncodedPart = ReqBodyUrlEnc $ "grant_type" =: ("client_credentials" :: String)
    --Connect to the server
    makeHttpCall <- runReq defaultHttpConfig $ do
      response <- R.req R.POST url urlEncodedPart (jsonResponse) (authHeadr <> contType)
      pure response
    --Convert the server response to the VaultToken type
    pure $ HTC.responseBody $ toVanillaResponse makeHttpCall

getAwesomeToken :: (MonadIO m, MonadMask m, HasVirginTokenCall m) => Bool -> L.Lock -> VaultCache -> T.Text -> T.Text -> Int -> RawOauth -> m VaultToken
getAwesomeToken debuggingOn awesomeLock squirrel clientId clientSecret reserveTime additionalOauth = do
  --Get the current STM time and the check if the item in memory needs to be cleared, clear it if needed
  cache <- liftIO . atomically $ do
    now <- C.nowSTM
    cash <- lookupSTM True clientId squirrel now
    pure cash

  --If the cache is up to date, then just return the VaultToken
  vaultToken <- case cache of
    Just c -> do
      vaultProxyDebug debuggingOn "Got my token from the cache, not from the remote server."
      pure c
    Nothing -> do
      traceM "Try and acquire a lock to change the token"
      doIHaveControl <- liftIO $ L.tryAcquire awesomeLock
      if doIHaveControl
        then
          ( do
              traceM "One thread got control and is getting the new token"

              traceM "Trying to get a new token from OAuth provider"
              virToken <- getVirginToken clientId clientSecret additionalOauth
              vaultProxyDebug debuggingOn "Trying to calculate the expry time of the token"
              exTime <- makeExpry virToken reserveTime
              vaultProxyDebug debuggingOn "Trying to insert the new token into the cache"
              liftIO . atomically $ insertSTM clientId virToken squirrel (Just exTime)
              traceM "Successfully inserted the new token into the cache, releasing lock and notifiying other threads"
              pure virToken
          )
            `C.finally` (liftIO $ L.release awesomeLock)
        else do
          traceM "Waiting until my neighbor thread updates the token"
          liftIO $ L.wait awesomeLock
          traceM "Lock is released, will try to get the token again."
          checkTokenAgain <- getAwesomeToken debuggingOn awesomeLock squirrel clientId clientSecret reserveTime additionalOauth
          pure checkTokenAgain

  pure vaultToken

--This is the standard expry time for the token, it is 13 seconds less than the expry time from the OAuth provider
makeExpry :: MonadIO m => VaultToken -> Int -> m TimeSpec
--Make the expry negative if the token does not have the expiresIn field set, this will force a new token to be made always
--Not sure if this will really occur, but it is a good safety net 🕸️
makeExpry token reserveTime = do
  whatTimeIsIt <- liftIO $ getTime Monotonic
  let nanoTime :: Integer
      nanoTime = toNanoSecs (whatTimeIsIt)
      tokenExpry :: Integer
      tokenExpry = expiresIn token
      expry :: TimeSpec
      expry = fromNanoSecs (nanoTime + (tokenExpry - toInteger reserveTime) * 1000000000)
  pure expry

--Get the vault token more easily
vaulty :: (MonadIO m, MonadMask m, HasVirginTokenCall m) => VaultConnection -> m VaultToken
vaulty vaultConn = getAwesomeToken db ll tc cid csec rs ao
  where
    cid = oauthClientId vaultConn
    csec = oauthClientSecret vaultConn
    ao = additionalOauth vaultConn
    rs = oauthReserveSeconds vaultConn
    tc = tokenCache vaultConn
    ll = superLock vaultConn
    db = debuggingOn vaultConn

vaultProxyDebug :: Applicative f => Bool -> String -> f ()
vaultProxyDebug debug msg = when debug $ traceM msg
