{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Strato.VaultProxy.Server.User
  ( getUsers
  ) where

-- import Data.Int
import Control.Monad.Trans.Reader
-- import Data.Text hiding (map)

-- import BlockApps.Logging
import Strato.VaultProxy.API
import Strato.VaultProxy.Monad
-- import           Data.ByteString                   (ByteString)
import           Data.ByteString.Char8             as B
import           Data.Maybe                       (fromJust)
-- import           Data.IORef
import           Data.Text                        as T
import qualified Data.Text.Encoding               as TE
-- import           GHC.Conc
-- import           Network.HTTP.Client              as HTC
-- import           Database.PostgreSQL.Simple       (Connection)
import           Network.HTTP.Req                 as R
-- import           Strato.VaultProxy.Crypto
-- import           Strato.VaultProxy.Monad
import           Strato.VaultProxy.DataTypes
import           Strato.VaultProxy.Server.Token
-- import           Servant.Client
import qualified Text.URI                          as URI

--Replace with the bouncer
getUsers :: Text -> Maybe Address -> Maybe Int -> Maybe Int -> VaultProxyM [User]
-- getUsers headerUsername mAddr mLimit mOffset = pure undefined
getUsers userName mAddr mLimit mOffset = do
  --Get the VaultConnection information
  vaultConn <- ask
  jwt <- vaulty vaultConn
  let url = (vaultUrl vaultConn) <> "/users" <> "$address=" <> (T.pack $ show mAddr) <> "&limit=" <> (T.pack $ show mLimit) <> "&offset=" <> (T.pack $ show mOffset)
  uri <- URI.mkURI url
  --Make the other pieces that are needed to connect to the shared vault
  let (ur,_) = fromJust (useHttpsURI $ uri)
  --Make the jwt header to allow for the connecting of the foreign vault
  let authHeadr = R.header (B.pack "Authorization") (TE.encodeUtf8 $ T.pack $ "Bearer " <> show jwt)
      userHeadr = R.header (B.pack "X-USER-ACCESS-TOKEN") (TE.encodeUtf8 userName)
  --make a req request to the shared vault
  makeHttpCall <- runReq defaultHttpConfig $ do
    response <- R.req R.GET ur NoReqBody jsonResponse (authHeadr <> userHeadr)
    pure $ R.responseBody response
  --Convert the response to the correct type automatically
  pure makeHttpCall
