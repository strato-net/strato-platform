{-# LANGUAGE OverloadedStrings #-}

-- | Minimal JSON-RPC 2.0 client for the node's co-located ethereum-jsonrpc
-- service, used by transaction simulation.
module Bloc.Server.JsonRpc
  ( jsonRpcCall,
  )
where

import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.Aeson ((.=), (.:?))
import qualified Data.Aeson as Aeson
import Data.Text (Text)
import qualified Data.Text as Text
import Network.HTTP.Client
import System.IO.Unsafe (unsafePerformIO)
import UnliftIO (tryAny)

data RpcErr = RpcErr
  { rpcErrMessage :: Maybe Text,
    rpcErrRaw :: Aeson.Value
  }

instance Aeson.FromJSON RpcErr where
  parseJSON v = case v of
    Aeson.Object o -> RpcErr <$> o .:? "message" <*> pure v
    _ -> pure $ RpcErr Nothing v

data RpcEnvelope = RpcEnvelope
  { rpcError :: Maybe RpcErr,
    rpcResult :: Maybe Aeson.Value
  }

instance Aeson.FromJSON RpcEnvelope where
  parseJSON = Aeson.withObject "JSON-RPC response" $ \o ->
    RpcEnvelope <$> o .:? "error" <*> o .:? "result"

-- A single process-wide connection pool (per-request managers leak sockets).
-- The response timeout exceeds the node's 120s VM budget for debug commands.
{-# NOINLINE sharedManager #-}
sharedManager :: Manager
sharedManager =
  unsafePerformIO . newManager $
    defaultManagerSettings {managerResponseTimeout = responseTimeoutMicro 130000000}

-- | POST a JSON-RPC request and return the result payload, or a rendered
-- transport\/RPC error message.
jsonRpcCall :: MonadIO m => String -> Text -> [Aeson.Value] -> m (Either Text Aeson.Value)
jsonRpcCall baseUrl rpcMethod params = liftIO $ do
  let body =
        Aeson.object
          [ "jsonrpc" .= ("2.0" :: Text),
            "id" .= (1 :: Int),
            "method" .= rpcMethod,
            "params" .= params
          ]
  eResp <- tryAny $ do
    req <- parseRequest baseUrl
    httpLbs
      req
        { method = "POST",
          requestHeaders = [("Content-Type", "application/json")],
          requestBody = RequestBodyLBS $ Aeson.encode body
        }
      sharedManager
  pure $ case eResp of
    Left ex -> Left $ "JSON-RPC transport error: " <> Text.pack (show ex)
    Right resp -> case Aeson.eitherDecode (responseBody resp) of
      Left err -> Left $ "invalid JSON-RPC response: " <> Text.pack err
      Right env -> case (rpcError env, rpcResult env) of
        (Just e, _) -> Left $ case rpcErrMessage e of
          Just msg -> msg
          Nothing -> Text.pack . show $ rpcErrRaw e
        (Nothing, Just v) -> Right v
        (Nothing, Nothing) -> Left "JSON-RPC response has neither result nor error"
