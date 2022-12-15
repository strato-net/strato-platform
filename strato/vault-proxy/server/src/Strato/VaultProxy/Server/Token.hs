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
import           Control.Monad.STM.Class  hiding (newTVar)
import           Data.ByteString.Base64   as B64
import           Data.Cache               as C
import           Data.Cache.Internal      as C
import           Data.Maybe
import qualified Data.Text               as T
import           Data.Text.Encoding      as TE
import           Debug.Trace
import           GHC.Conc
import           Network.HTTP.Client     as HTC hiding (Proxy)
import           Network.HTTP.Req        as R
import           Strato.VaultProxy.RawOauth
import           System.Clock            as S
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

makeSTM :: a -> STM a
makeSTM = pure

--This will get the correct token and will get a cached token if it is still valid
--run this inside of "atomically" so it might look like: "liftIO $ atomically $ getAwesomeToken squirrel clientId clientSecret reserveTime additionalOauth"
getAwesomeToken :: (MonadIO m, MonadThrow m) => VaultCache -> T.Text -> T.Text -> Int -> RawOauth -> STM (VaultToken)
getAwesomeToken squirrel clientId clientSecret reserveTime additionalOauth = do
    --Get the current STM time and the check if the item in memory needs to be cleared, clear it if needed
    rightNow <- C.nowSTM
    cache <- liftIO . atomically $ do 
        cash <- lookupSTM True clientId squirrel rightNow
        case cash of 
            Just c -> pure c
            --If the token was old destroy the old token and get a new one
            Nothing -> do 
                traceM "Get a new token"
                virToken <- unsafeIOToSTM $ getVirginToken clientId clientSecret additionalOauth
                --Calculate the time that the token will expire
                exTime <- unsafeIOToSTM $ makeExpry (makeSTM virToken) reserveTime
                rook <- newCacheSTM (Just $ liftIO $ atomically exTime)
                --Insert the new token into the STM cache
                insertSTM clientId virToken rook (Just exTime)
                traceM "Successfully inserted the new token into the cache"
                pure virToken

    pure cache

-- unSTM :: STM a -> a
-- unSTM = pure

--This is the standard expry time for the token, it is 13 seconds less than the expry time from the OAuth provider
makeExpry :: (MonadIO m, MonadSTM m) => STM VaultToken -> Int -> m (STM TimeSpec)
--Make the expry negative if the token does not have the expiresIn field set, this will force a new token to be made always
    --Not sure if this will really occur, but it is a good safety net 🕸️
makeExpry token reserveTime = do 
    traceM "Calculating the expry time for a token."
    whatTimeIsIt <- C.nowSTM
    let nanoTime :: Integer
        nanoTime = toNanoSecs (whatTimeIsIt)
        tokenExpry :: Integer
        tokenExpry = (liftIO $ atomically token) ^. expiresIn
        expry :: TimeSpec
        expry = fromNanoSecs ( nanoTime + (tokenExpry - toInteger reserveTime) * 1000000000)
    pure expry

--Get the vault token more easily
vaulty :: (MonadIO m, MonadThrow m, MonadSTM m) => VaultConnection -> m VaultToken
vaulty vaultConn = getAwesomeToken tcSTM cid csec rs ao
    where cid = oauthClientId vaultConn
          csec = oauthClientSecret vaultConn
          ao = additionalOauth vaultConn
          rs = oauthReserveSeconds vaultConn
          tcSTM = tokenCache vaultConn
    -- whatTimeIsIt <- liftIO $ getTime Monotonic
    -- tc <- lookupSTM False cid tcSTM whatTimeIsIt
    --Get the token from the cache
    -- fish <- 
    -- pure $ 