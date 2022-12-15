{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}

module Strato.VaultProxy.Server.Token where

import           Control.Concurrent.STM
import           Control.Lens
import           Control.Monad.Catch
import           Control.Monad.IO.Class
import           Data.ByteString.Base64   as B64
import           Data.Cache               as C
import           Data.Cache.Internal      as C
import           Data.Maybe
import qualified Data.Text               as T
import           Data.Text.Encoding      as TE
import           Debug.Trace
import           Network.HTTP.Client     as HTC hiding (Proxy)
import           Network.HTTP.Req        as R
import           Strato.VaultProxy.RawOauth
import           System.Clock
import           Text.URI                as URI

import           Strato.VaultProxy.DataTypes


--This will get a fresh brand new, minty fresh clean token from the OAuth provider,
--User never really needs to use this function, it is mostly called by getAwesomeToken 
getVirginToken ::  (MonadIO m, MonadThrow m) => T.Text -> T.Text -> RawOauth -> m (VaultToken) --OAuth2Token ---Might need to include the discovery URL later
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

--This will get the correct token and will get a cached token if it is still valid
getAwesomeToken :: (MonadIO m, MonadThrow m) => VaultCache -> T.Text -> T.Text -> Int -> RawOauth -> m (VaultToken)
getAwesomeToken squirrel clientId clientSecret reserveTime additionalOauth = do
    --Get the current STM time and the check if the item in memory needs to be cleared, clear it if needed
    cache <- liftIO . atomically $ do 
        now <- C.nowSTM
        cash <- lookupSTM True clientId squirrel now
        case cash of 
            Just c -> pure c
            --If the token was old destroy the old token and get a new one
            Nothing -> do 
                traceM "Get a new token"
                let virToken = getVirginToken clientId clientSecret additionalOauth
                vtoken <- virToken
                --Calculate the time that the token will expire
                exTime <- makeExpry vtoken reserveTime
                --Insert the new token into the STM cache
                insertSTM clientId virToken (Cache clientId virToken) (Just exTime)
                traceM "Successfully inserted the new token into the cache"
                pure virToken

    pure cache

makeSTM :: a -> STM a
makeSTM = pure

--This is the standard expry time for the token, it is 13 seconds less than the expry time from the OAuth provider
makeExpry :: MonadIO m => VaultToken -> Int -> m TimeSpec 
--Make the expry negative if the token does not have the expiresIn field set, this will force a new token to be made always
    --Not sure if this will really occur, but it is a good safety net 🕸️
makeExpry token reserveTime = do 
    traceM "Calculating the expry time for a token."
    whatTimeIsIt <- liftIO $ getTime Monotonic
    let nanoTime :: Integer
        nanoTime = toNanoSecs (whatTimeIsIt)
        tokenExpry :: Integer
        tokenExpry = token ^. expiresIn
        expry :: TimeSpec
        expry = fromNanoSecs ( nanoTime + (tokenExpry - toInteger reserveTime) * 1000000000)
    pure expry

--Get the vault token more easily
vaulty :: (MonadIO m, MonadThrow m) => VaultConnection -> m VaultToken
vaulty vaultConn = getAwesomeToken tc cid csec rs ao
    where
        cid = oauthClientId vaultConn
        csec = oauthClientSecret vaultConn
        ao = additionalOauth vaultConn
        rs = oauthReserveSeconds vaultConn
        tc = tokenCache vaultConn