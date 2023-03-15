{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE Strict            #-}

module Strato.VaultProxy.Server.Token where


import           Control.Concurrent.MVar
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
        response <- R.req R.POST url urlEncodedPart (jsonResponse) (authHeadr <> contType )
        pure response
    --Convert the server response to the VaultToken type
    pure $ HTC.responseBody $ toVanillaResponse makeHttpCall

-- --This will get the correct token and will get a cached token if it is still valid

-- getAwesomeToken :: (MonadIO m, MonadThrow m) => Bool -> L.Lock -> VaultCache -> T.Text -> T.Text -> Int -> RawOauth -> m VaultToken
-- getAwesomeToken debuggingOn awesomeLock squirrel clientId clientSecret reserveTime additionalOauth = do
getAwesomeToken :: (MonadIO m, MonadThrow m) => Bool -> MVar VaultToken -> T.Text -> T.Text -> Int -> RawOauth -> m VaultToken
--         debuggingOn :: Bool
getAwesomeToken _ tokenMVar clientId clientSecret reserveTime additionalOauth = do
    -- Try to take the token from the MVar
    maybeToken <- liftIO $ tryTakeMVar tokenMVar
    case maybeToken of
        Just token -> do
            -- If we got a token, check if it's still valid
            currentTime <- liftIO $ getTime Monotonic
            expiryTime <- makeExpry token reserveTime
            if currentTime < expiryTime then do
                -- If the token is valid, put it back and return it
                liftIO $ putMVar tokenMVar token
                pure token
            else do
                -- If the token is not valid, get a new one and update the MVar
                newToken <- getVirginToken clientId clientSecret additionalOauth
                liftIO $ putMVar tokenMVar newToken
                pure newToken
        Nothing -> do
            -- If there was no token, get a new one and update the MVar
            newToken <- getVirginToken clientId clientSecret additionalOauth
            liftIO $ putMVar tokenMVar newToken
            pure newToken


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
vaulty vaultConn = getAwesomeToken db tmvar cid csec rs ao
    where
        cid = oauthClientId vaultConn
        csec = oauthClientSecret vaultConn
        ao = additionalOauth vaultConn
        rs = oauthReserveSeconds vaultConn
        tmvar = tokenMVar vaultConn
        db = debuggingOn vaultConn

vaultProxyDebug :: Applicative f => Bool -> String -> f()
vaultProxyDebug debug msg  = when debug $ traceM msg


