{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

module Backend.BitcoinRPC where

import Backend.Types
import Control.Lens hiding ((.=))
import Data.Aeson
import Data.Aeson.Types (parseEither, parseMaybe)
import qualified Data.ByteString.Lazy as BL
import Data.Kind
import Data.Proxy
import Data.Text (Text)
import Network.Wreq hiding (Proxy)
import Network.HTTP.Client (HttpException)
import Control.Exception (try)

type family All (k :: Type -> Constraint) (xs :: [Type]) :: Constraint where
  All _ '[] = ()
  All f (x ': xs) = (f x, All f xs)

data HList (xs :: [Type]) where
  HNil  :: HList '[]
  HEnd  :: x -> HList '[x]
  (:::) :: x -> HList xs -> HList (x ': xs)

toJSONH :: All ToJSON xs => HList xs -> [Value]
toJSONH HNil       = []
toJSONH (HEnd x)   = [toJSON x]
toJSONH (x ::: xs) = toJSON x : toJSONH xs

instance All ToJSON xs => ToJSON (HList xs) where
  toJSON = toJSON . toJSONH

class BitcoinRPCEndpoint a where
  type Params a :: [Type]
  type ReturnType a :: Type
  method :: Proxy a -> String

-- You may want to read from ENV later
bitcoinRPCUrl :: String
bitcoinRPCUrl = "http://localhost:8332/wallet/asdf"

authOpts :: Network.Wreq.Options
authOpts = defaults
  & auth ?~ basicAuth "bitcoinrpc" "pass"
  & header "Content-Type" .~ ["application/json"]

-- General RPC caller
callBitcoinRPC :: ( BitcoinRPCEndpoint a
                  , All ToJSON (Params a)
                  , FromJSON (ReturnType a)
                  )
               => Proxy a
               -> HList (Params a)
               -> IO (Either String (ReturnType a))
callBitcoinRPC p params' = (parseEither parseJSON =<<)
                       <$> callBitcoinRPCRaw (method p) (toJSONH params')

-- General RPC caller
callBitcoinRPCRaw :: String
                  -> [Value]
                  -> IO (Either String Value)
callBitcoinRPCRaw method' params' = do
  let payload = object
        [ "jsonrpc" .= ("1.0" :: String)
        , "id" .= ("bridge-client" :: String)
        , "method" .= method'
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

data GetBlockCount

instance BitcoinRPCEndpoint GetBlockCount where
  type Params GetBlockCount     = '[]
  type ReturnType GetBlockCount = Integer
  method _ = "getblockcount"

data GetBlockHash

instance BitcoinRPCEndpoint GetBlockHash where
  type Params GetBlockHash     = '[Integer]
  type ReturnType GetBlockHash = Text
  method _ = "getblockhash"

data GetBlock

instance BitcoinRPCEndpoint GetBlock where
  type Params GetBlock     = '[Text]
  type ReturnType GetBlock = BitcoinBlockSummary
  method _ = "getblock"

data GetWalletUTXOSummaries

instance BitcoinRPCEndpoint GetWalletUTXOSummaries where
  type Params GetWalletUTXOSummaries     = '[]
  type ReturnType GetWalletUTXOSummaries = [UtxoSummary]
  method _ = "listunspent"

data GetWalletUTXOs

instance BitcoinRPCEndpoint GetWalletUTXOs where
  type Params GetWalletUTXOs     = '[]
  type ReturnType GetWalletUTXOs = [UTXO]
  method _ = "listunspent"

data GetBalance

instance BitcoinRPCEndpoint GetBalance where
  type Params GetBalance     = '[]
  type ReturnType GetBalance = Double
  method _ = "getbalance"

data SendToAddress

instance BitcoinRPCEndpoint SendToAddress where
  type Params SendToAddress     = '[Text, Double]
  type ReturnType SendToAddress = Text
  method _ = "sendtoaddress"

data GetNewAddress

instance BitcoinRPCEndpoint GetNewAddress where
  type Params GetNewAddress     = '[]
  type ReturnType GetNewAddress = Text
  method _ = "getnewaddress"

data ValidateAddress

instance BitcoinRPCEndpoint ValidateAddress where
  type Params ValidateAddress     = '[Text]
  type ReturnType ValidateAddress = AddressValidation
  method _ = "validateaddress"

data CreateMultiSig

instance BitcoinRPCEndpoint CreateMultiSig where
  type Params CreateMultiSig     = '[Integer, [Text]]
  type ReturnType CreateMultiSig = MultiSigAddress
  method _ = "createmultisig"