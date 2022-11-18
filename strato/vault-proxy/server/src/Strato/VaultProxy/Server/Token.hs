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
-- import           Control.Lens
import           Control.Monad.Catch
-- import           Control.Monad.Composable.VaultProxy
import           Control.Monad.IO.Class
-- import           Control.Monad.Reader
-- import           Control.Monad.Change.Modify
-- import           Data.Aeson  
-- import           Data.Aeson.Types
import           Data.ByteString.Base64   as B64
import           Data.Cache               as C
import           Data.Cache.Internal      as C
import           Data.Maybe
-- import           Data.Proxy
-- import qualified Data.Scientific         as Scientific
import qualified Data.Text               as T
import           Data.Text.Encoding      as TE
-- import           GHC.Generics
import           Network.HTTP.Client     as HTC hiding (Proxy)
import           Network.HTTP.Req        as R
-- import           Servant.API             as SA
-- import           Servant.Auth            as SAA
-- import           Servant.Auth.Server     as SAS
-- import           Servant.Client
-- import           Servant.Server          as SS
import           Strato.VaultProxy.API
import           Strato.VaultProxy.Monad
import           System.Clock
import           Text.URI                as URI
-- import           Yesod.Core.Types        as YC

import           Strato.VaultProxy.DataTypes


--This will get a fresh brand new, minty fresh clean token from the OAuth provider,
--User never really needs to use this function, it is mostly called by getAwesomeToken 
getVirginToken ::  (MonadIO m, MonadThrow m) => T.Text -> T.Text -> RawOauth -> m VaultToken --OAuth2Token ---Might need to include the discovery URL later
getVirginToken clientId clientSecret additionalOauth = do --virginToken
    --Conver the token endpoint to a URI
    uri <- URI.mkURI $ token_endpoint additionalOauth
    --Encode all of the parameters, get ready to send to server
    let (url, _) = fromJust (useHttpsURI $ uri)
        authHeadr = header "Authorization" $ TE.encodeUtf8 $ T.concat [T.pack "Basic ", B64.encodeBase64 $ TE.encodeUtf8 $ T.concat [clientId, ":", clientSecret]]
        contType = header "Content-Type" $ TE.encodeUtf8 $ T.pack "application/x-www-form-urlencoded"
        urlEncodedPart = ReqBodyUrlEnc $ "grant_type" =: ("client_credentials" :: String)
    --Connect to the server
    makeHttpCall <- runReq defaultHttpConfig $ do
        response <- R.req R.POST url urlEncodedPart (jsonResponse) (authHeadr <> contType )
        pure response
    --Convert the server response to the VaultToken type
    pure $ HTC.responseBody $ toVanillaResponse makeHttpCall

--This will get the correct token and will get a cached token if it is still valid
getAwesomeToken :: (MonadIO m, MonadThrow m) => VaultCache -> T.Text -> T.Text -> Int -> RawOauth -> m VaultToken
getAwesomeToken squirrel clientId clientSecret reserveTime additionalOauth = do
    --Get the current STM time and the check if the item in memory needs to be cleared, clear it if needed
    cache <- liftIO . atomically $ do 
        now <- C.nowSTM
        cash <- lookupSTM True clientId squirrel now
        pure cash

    --If the cache is up to date, then just return the VaultToken
    vaultToken <- case cache of 
        Just c -> pure c
        --If the token was old destroy the old token and get a new one
        Nothing -> do 
            -- Get the virgin token from the provider
            let vToken = getVirginToken clientId clientSecret additionalOauth
            virToken <- vToken
            --Calculate the time that the token will expire
            exTime <- makeExpry virToken reserveTime
            --Insert the new token into the STM cache
            liftIO . atomically $ insertSTM clientId virToken squirrel (Just exTime)
            pure virToken
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
        tokenExpry =  expiresIn token
        expry :: TimeSpec
        expry = fromNanoSecs ( nanoTime + (tokenExpry - toInteger reserveTime) * 1000000000)
    pure expry

getRawToken :: VaultProxyM T.Text
getRawToken = pure undefined

getCurrentUser :: VaultProxyM T.Text
getCurrentUser = pure undefined