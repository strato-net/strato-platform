{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TupleSections     #-}

module Strato.VaultProxy.Server.Key where

-- import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader        as RT
-- import           Control.Monad.Trans.RWS.CPS
-- import           Data.Text                         (Text)
import           Network.HTTP.Req                  as R

-- import           Servant.Client --needed for the bouncing service and runClientM
import           Strato.VaultProxy.API
-- import           Strato.VaultProxy.Server
-- import           Strato.VaultProxy.Server.Token    (vaulty)
import           Strato.VaultProxy.Monad
-- import           Strato.VaultProxy.API.Token       as Tok
import           Strato.VaultProxy.DataTypes
-- import           Data.ByteString                  as B
-- import           Data.ByteString.Char8             as B
import           Data.Maybe                        (fromJust, fromMaybe)
-- import           Data.IORef
import           Data.Text                        as T
import qualified Data.Text.Encoding               as TE
-- import           GHC.Conc
-- import           Network.HTTP.Client              as HTC
-- import           Database.PostgreSQL.Simple       (Connection)
-- import           Network.HTTP.Req                 as R
-- import           Strato.VaultProxy.Crypto
-- import           Strato.VaultProxy.Monad
-- import           Strato.VaultProxy.DataTypes
import           Strato.VaultProxy.Server.Token
-- import           Servant.Client
import qualified Text.URI                          as URI


-- import           Hflags

--Bounce that request
getKey :: Text -> Maybe Text -> VaultProxyM AddressAndKey --TODO: Make this able to avoid using providing anything (This should replace getCurrentKey)
getKey headerUsername queryParamUserName = do --not sure if queryParamUserName is needed (haven't seen it used)
  let userName = fromMaybe headerUsername queryParamUserName
  --Get the VaultConnection information
  vaultConn <- ask
  --Make the url for getting the key
  let url = (vaultUrl vaultConn) <> "/key" <> "$username=" <> userName
  uri <- URI.mkURI url
  --Make the other pieces that are needed to connect to the shared vault
  let (ur,_) = fromJust (useHttpsURI $ uri)
  --Get the jwt token from the vaultProxy
  jwt <- vaulty vaultConn
  --Make the jwt header to allow for the connecting of the foreign vault
  let authHeadr = header "Authorization" ("Bearer " <> (TE.encodeUtf8 $ T.pack $ show jwt))
  --make a req request to the shared vault
  makeHttpCall <- runReq defaultHttpConfig $ do
    response <- R.req R.GET ur NoReqBody jsonResponse (authHeadr)
    pure $ R.responseBody response
  --Convert the response to the correct type automatically
  pure makeHttpCall

postKey :: Text -> VaultProxyM AddressAndKey
-- postKey userName = pure undefined
postKey username = do 
  --Get the VaultConnection information
  vaultConn <- ask
  --Make the url for getting the key
  let url = (vaultUrl vaultConn) <> "/key"
  uri <- URI.mkURI url
  --Make the other pieces that are needed to connect to the shared vault
  let (ur,_) = fromJust (useHttpsURI $ uri)
  --Get the jwt token from the vaultProxy
  jwt <- vaulty vaultConn
  --Make the jwt header to allow for the connecting of the foreign vault
  let authHeadr = header "Authorization" ("Bearer " <> TE.encodeUtf8 $ T.pack $ show jwt)
      userHeadr = header "X-USER-ACCESS-TOKEN" (TE.encodeUtf8 username)
  --make a req request to the shared vault
  makeHttpCall <- runReq defaultHttpConfig $ do
    response <- R.req R.POST ur NoReqBody jsonResponse (authHeadr <> userHeadr)
    pure $ R.responseBody response
  --Convert the response to the correct type automatically
  pure makeHttpCall

-- Get an ECDH shared secret from the user's private key and a supplied public key
getSharedKey :: Text -> PublicKey -> VaultProxyM SharedKey
-- getSharedKey userName otherPub = pure undefined
getSharedKey username otherPub = do
    --Get the VaultConnection information
  vaultConn <- ask
  --Make the url for getting the key
  let url = (vaultUrl vaultConn) <> "/key"
      urlEncodedPart = ReqBodyJson pub
  uri <- URI.mkURI url
  --Make the other pieces that are needed to connect to the shared vault
  let (ur,_) = fromJust (useHttpsURI $ uri)
  jwt <- vaulty vaultConn
  --Make the jwt header to allow for the connecting of the foreign vault
  let authHeadr = header "Authorization" ("Bearer " <> TE.encodeUtf8 $ T.pack $ show jwt)
      pubKeyHeadr = header "X-USER-ACCESS-TOKEN" (TE.encodeUtf8 $ T.pack $ show pub) --TODO: NOT CORRECT BUT WILL FIX LATER
  --make a req request to the shared vault
  makeHttpCall <- runReq defaultHttpConfig $ do
    response <- R.req R.GET ur urlEncodedPart jsonResponse (authHeadr <> pubKeyHeadr)
    pure $ R.responseBody response
  --Convert the response to the correct type automatically
  pure makeHttpCall