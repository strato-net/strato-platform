{-# LANGUAGE OverloadedStrings #-}

module Backend.BitcoinRPC where

import Control.Lens hiding ((.=))
import Data.Aeson
import Data.Aeson.Types (parseMaybe)
import qualified Data.ByteString.Lazy as BL
import Network.Wreq
import Network.HTTP.Client (HttpException)
import Control.Exception (try)

-- You may want to read from ENV later
bitcoinRPCUrl :: String
bitcoinRPCUrl = "http://localhost:8332"

authOpts :: Network.Wreq.Options
authOpts = defaults
  & auth ?~ basicAuth "bitcoinrpc" "pass"
  & header "Content-Type" .~ ["application/json"]

-- General RPC caller
callBitcoinRPC :: String -> [Value] -> IO (Either String Value)
callBitcoinRPC method params' = do
  let payload = object
        [ "jsonrpc" .= ("1.0" :: String)
        , "id" .= ("bridge-client" :: String)
        , "method" .= method
        , "params" .= params'
        ]
  result <- try $ postWith authOpts bitcoinRPCUrl (toJSON payload) :: IO (Either HttpException (Response BL.ByteString))
  return $ case result of
    Left err -> Left $ show err
    Right res -> case eitherDecode (res ^. responseBody) of
      Left decodeErr -> Left decodeErr
      Right (Object o) -> case parseMaybe (.: "result") o of
        Just r -> Right r
        Nothing -> Left "No 'result' in RPC response"
      Right _ -> Left "Unexpected RPC response format"