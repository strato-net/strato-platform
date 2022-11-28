module Strato.VaultProxy.Server.Ping where

import           Control.Monad.Trans.Reader
import           Strato.VaultProxy.Monad
import           Text.URI                     as URI
import           Data.ByteString.Char8        as B
import           Data.Text                    as T
import           Data.Text.Encoding           as TE
import           Network.HTTP.Req             as R
-- import           Network.HTTP.Client          as HTC
import           Data.Maybe                   (fromJust)
import           Strato.VaultProxy.Server.Token
import           Strato.VaultProxy.DataTypes
-- import           GHC.Conc
-- import           Servant.Client

getPing :: VaultProxyM String
getPing = do
  vaultConn <- ask
  --Make the url for getting the key
  let url = (vaultUrl vaultConn) <> T.pack "/_ping"
  uri <- URI.mkURI url
  --Make the other pieces that are needed to connect to the shared vault
  let (ur,_) = fromJust (useHttpsURI $ uri)
  --Get the jwt token from the vaultProxy
  jwt <- vaulty vaultConn
  --Make the jwt header to allow for the connecting of the foreign vault
  let authHeadr = R.header (B.pack "Authorization") (TE.encodeUtf8 $ T.pack $ "Bearer " <> show jwt)
  --make a req request to the shared vault
  makeHttpCall <- runReq defaultHttpConfig $ do
    response <- R.req R.GET ur NoReqBody jsonResponse (authHeadr)
    pure $ R.responseBody response
  --Convert the response to the correct type automatically
  pure makeHttpCall