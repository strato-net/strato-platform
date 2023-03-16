{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE Strict            #-}

module Strato.VaultProxy.Server.Token where


import           Control.Concurrent.MVar
import           GHC.Conc
import           Control.Monad
import           Control.Monad.Catch
import           Control.Monad.IO.Class
import           Data.ByteString.Base64   as B64
import           Data.Maybe
import qualified Data.Text               as T
import           Data.Text.Encoding      as TE
import           Debug.Trace
import           Network.HTTP.Client     as HTC hiding (Proxy)
import           Network.HTTP.Req        as R
import           System.Clock
import           Text.URI                as URI

import           Strato.VaultProxy.DataTypes


--This will get a fresh brand new, minty fresh clean token from the OAuth provider,
--User never really needs to use this function, it is mostly called by getAwesomeToken 
getVirginToken ::  (MonadIO m, MonadThrow m) => T.Text -> T.Text -> RawOauth -> m VaultToken --OAuth2Token ---Might need to include the discovery URL later
getVirginToken clientId clientSecret additionalOauth = do --virginToken
    --Conver the token endpoint to a URI
    uri <- URI.mkURI $ token_endpoint additionalOauth
    --Encode all of the parameters, get ready to send to server
    let (url, _) = fromJust (useHttpsURI $ uri)
        authHeadr = R.header "Authorization" $ TE.encodeUtf8 $ T.concat [T.pack "Basic ", B64.encodeBase64 $ TE.encodeUtf8 $ T.concat [clientId, ":", clientSecret]]
        contType = R.header "Content-Type" $ TE.encodeUtf8 $ T.pack "application/x-www-form-urlencoded"
        urlEncodedPart = ReqBodyUrlEnc $ "grant_type" =: ("client_credentials" :: String)
    --Connect to the server
    makeHttpCall <- runReq defaultHttpConfig $ do 
        R.req R.POST url urlEncodedPart jsonResponse (authHeadr <> contType)
    --Convert the server response to the VaultToken type
    pure $ HTC.responseBody $ toVanillaResponse makeHttpCall

-- --This will get the correct token and will get a cached token if it is still valid
getAwesomeToken :: (MonadIO m, MonadThrow m) => Bool -> TVar (Maybe (VaultToken, TimeSpec)) -> MVar () -> T.Text -> T.Text -> Int -> RawOauth -> m VaultToken
getAwesomeToken debuggingOn tokenTVar updateLock clientId clientSecret reserveTime additionalOauth = do
    -- Read the current token and expiry time from the TVar
    maybeTokenExpiry <- liftIO . atomically $ readTVar tokenTVar
    currentTime <- liftIO $ getTime Monotonic
    case maybeTokenExpiry of
        Just (token, expiryTime) | currentTime < expiryTime -> do
            -- If there is a valid token, return it
            pure token
        _ -> do
            -- If there is no valid token, try to acquire the lock to update it
            gotLock <- liftIO $ tryPutMVar updateLock ()
            if gotLock then do
                -- If we got the lock, get a new token and update the TVar
                newToken <- getVirginToken clientId clientSecret additionalOauth
                newExpiryTime <- makeExpry newToken reserveTime
                liftIO . atomically $ writeTVar tokenTVar (Just (newToken, newExpiryTime))
                -- Release the lock
                liftIO $ takeMVar updateLock
                pure newToken
            else do
                -- If we didn't get the lock, wait for the lock to be released and try again
                liftIO $ readMVar updateLock
                getAwesomeToken debuggingOn tokenTVar updateLock clientId clientSecret reserveTime additionalOauth



--This is the standard expry time for the token, it is 13 seconds less than the expry time from the OAuth provider
makeExpry :: MonadIO m => VaultToken -> Int -> m TimeSpec 
--Make the expry negative if the token does not have the expiresIn field set, this will force a new token to be made always
    --Not sure if this will really occur, but it is a good safety net 🕸️
makeExpry token reserveTime = do 
    whatTimeIsIt <- liftIO $ getTime Monotonic
    let nanoTime :: Integer
        nanoTime = toNanoSecs (whatTimeIsIt)
        tokenExpry :: Integer
        tokenExpry =  expiresIn token
        expry :: TimeSpec
        expry = fromNanoSecs ( nanoTime + (tokenExpry - toInteger reserveTime) * 1000000000)
    pure expry

--Get the vault token more easily
vaulty :: (MonadIO m, MonadThrow m) => VaultConnection -> m VaultToken
vaulty vaultConn = getAwesomeToken db ttvar tlock cid csec rs ao
    where
        cid = oauthClientId vaultConn
        csec = oauthClientSecret vaultConn
        ao = additionalOauth vaultConn
        rs = oauthReserveSeconds vaultConn
        ttvar = tokenTVar vaultConn
        tlock = updateLock vaultConn
        db = debuggingOn vaultConn

vaultProxyDebug :: Applicative f => Bool -> String -> f()
vaultProxyDebug debug msg  = when debug $ traceM msg


