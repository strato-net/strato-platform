{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.VaultProxy.Server.Signature where

-- import           Control.Monad.Reader                  (asks)
-- import qualified Data.ByteString                       as B
-- import qualified Data.Cache                            as Cache
-- import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
-- import           Data.Text                             (Text)
import           Blockchain.Strato.Model.Secp256k1
import           Strato.VaultProxy.Monad
import           Strato.VaultProxy.API.Types
import           Text.URI                     as URI
import           Data.Text                    as T
import           Data.Text.Encoding           as TE
import           Network.HTTP.Req             as R
-- import           Network.HTTP.Client          as HTC
import           Data.Maybe                   (fromJust)
import           Strato.VaultProxy.Server.Token
import           Strato.VaultProxy.DataTypes
-- import           Strato.VaultProxy.Client
-- import           GHC.Conc
-- import           Servant.Client


--bounce the request to the vault
postSignature :: MsgHash -> VaultProxyM Signature
-- postSignature userName (MsgHash msgBS) = pure undefined
postSignature (MsgHash msgBS) = do
  vaultConn <- ask
  --Make the url for getting the key
  let url = (vaultUrl vaultConn) <> "/postSignature"
  uri <- URI.mkURI url
  --Make the other pieces that are needed to connect to the shared vault
  let (ur,_) = fromJust (useHttpsURI $ uri)
      -- mgr = httpManager vaultConn
      urlEncodedPart = ReqBodyBs msgBS
  --Get the jwt token from the vaultProxy
  jwt <- vaulty vaultConn
  --Make the jwt header to allow for the connecting of the foreign vault
  let authHeadr = R.header "Authorization" ("Bearer " <> TE.encodeUtf8 $ T.pack $ show jwt)
  --make a req request to the shared vault
  makeHttpCall <- runReq defaultHttpConfig $ do
    response <- R.req R.POST ur urlEncodedPart jsonResponse (authHeadr)
    pure $ R.responseBody response
  --Convert the response to the correct type automatically
  pure makeHttpCall
  
  -- mgr <- ask httpManager
  -- url <- ask vaultUrl
  -- clientEnv <- mkClientEnv mgr url
  -- kii <- runClientM (postSignature username msgBS) clientEnv --TODO: need to figure out how to pass the vaultproxy config to this function instead of clientEnv
  -- key <- case kii of
  --   Left err -> error $ "Error connecting to the shared vault: " ++ show err
  --   Right k -> return k
  -- pure key
  -- do
  -- cache <- asks keyStoreCache
  -- cachedPk <- liftIO $ Cache.lookup cache userName
  -- (_,nonce,pKey,_) <- case cachedPk of
  --   Just (KeyStore a b c d) -> pure (a,b,c,d)
  --   Nothing -> do
  --     mpk <- vaultTransaction
  --          . vaultQueryMaybe
  --          $ getUserKeyQuery userName
  --     (a,b,c,d) <- case mpk of
  --       Just pk -> return pk
  --       Nothing -> vaultWrapperError $ UserError ("User " <> userName <> " doesn't exist")
  --     liftIO . Cache.insert cache userName $ KeyStore a b c d
  --     pure (a,b,c,d)
  -- withSecretKey $ \key -> case decryptSecKey key nonce pKey of
  --   Nothing -> vaultWrapperError IncorrectPasswordError
  --   Just prvKey 
  --     | B.length msgBS == 32 -> return $ signMsg prvKey msgBS 
  --     | otherwise -> vaultWrapperError $ AnError "Message was not 32 bytes long"
