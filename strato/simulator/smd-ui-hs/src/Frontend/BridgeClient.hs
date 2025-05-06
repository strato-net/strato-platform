{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.BridgeClient where

import Bloc.API.Utils
import Bloc.Client
import BlockApps.Solidity.SolidityValue
import Common.Types
import Control.Exception (throwIO)
import Data.Aeson
import qualified Data.ByteString.Lazy as BL
import qualified Data.Map.Strict as M
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import Frontend.Client
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Servant.Client
import Strato.Options (flags_backend_port)
import Text.Read (readMaybe)
-- import Network.HTTP.Client.TLS (tlsManagerSettings)

-- This must match your server base URL
backendBaseUrl :: BaseUrl
backendBaseUrl = BaseUrl Http "localhost" flags_backend_port ""

-- This must match your server base URL
blocBaseUrl :: BaseUrl
blocBaseUrl = BaseUrl Http "localhost" flags_backend_port "/bloc/v2.2"

fetchBlockSummaries :: IO [BitcoinBlockSummary]
fetchBlockSummaries = do
  mgr <- newManager defaultManagerSettings -- tlsManagerSettings
  result <- runClientM getBlockSummaries (mkClientEnv mgr backendBaseUrl)
  case result of
    Left e -> throwIO e
    Right bSums -> pure bSums

fetchGlobalUtxos :: IO [UtxoSummary]
fetchGlobalUtxos = do
  mgr <- newManager defaultManagerSettings -- tlsManagerSettings
  result <- runClientM getGlobalUtxos (mkClientEnv mgr backendBaseUrl)
  case result of
    Left e -> throwIO e
    Right utxos -> pure utxos

fetchWalletUtxos :: IO [UtxoSummary]
fetchWalletUtxos = do
  mgr <- newManager defaultManagerSettings -- tlsManagerSettings
  result <- runClientM getWalletUtxos (mkClientEnv mgr backendBaseUrl)
  case result of
    Left e -> throwIO e
    Right utxos -> pure utxos

fetchWalletBalance :: IO Double
fetchWalletBalance = do
  mgr <- newManager defaultManagerSettings -- tlsManagerSettings
  result <- runClientM getWalletBalance (mkClientEnv mgr backendBaseUrl)
  case result of
    Left e -> throwIO e
    Right bal -> pure bal

fetchMultisigUtxos :: Text -> IO [UtxoSummary]
fetchMultisigUtxos addr = do
  mgr <- newManager defaultManagerSettings -- tlsManagerSettings
  result <- runClientM (getMultisigUtxos addr) (mkClientEnv mgr backendBaseUrl)
  case result of
    Left e -> throwIO e
    Right utxos -> pure utxos

sendToMultisig :: Text -> Double -> IO Text
sendToMultisig addr amt = do
  mgr <- newManager defaultManagerSettings -- tlsManagerSettings
  result <- runClientM (postSendToMultisig $ PostSendToMultisigArgs addr amt) (mkClientEnv mgr backendBaseUrl)
  case result of
    Left e -> throwIO e
    Right res -> pure res

sendRpcCommand :: Text -> [Value] -> IO Text
sendRpcCommand m ps = do
  mgr <- newManager defaultManagerSettings
  let cmd = RpcCommand m ps
  result <- runClientM (postBitcoinRpcCommand cmd) (mkClientEnv mgr backendBaseUrl)
  case result of
    Left err -> throwIO err
    Right val -> pure $ encodeText val

fetchMarketplaceTransactions :: IO [Transaction]
fetchMarketplaceTransactions = do
  mgr <- newManager defaultManagerSettings
  result <- runClientM getMarketplaceTransactions (mkClientEnv mgr backendBaseUrl)
  case result of
    Right txs -> pure txs
    Left err  -> fail $ "API error: " <> show err

encodeText :: Value -> Text
encodeText = T.decodeUtf8 . BL.toStrict . encode

fetchBridgeState :: IO Double
fetchBridgeState = do
  mgr <- newManager defaultManagerSettings -- tlsManagerSettings
  result <- runClientM (getContractsState (ContractName "BitcoinBrige") 0x1234567890 Nothing Nothing Nothing Nothing False) (mkClientEnv mgr blocBaseUrl)
  case result of
    Left e -> throwIO e
    Right stateMap -> pure $ case M.lookup "balances" stateMap of
      Just (SolidityObject bals) -> ((*0.00000001) . fromInteger) . sum $ map (\case
          SolidityValueAsString s -> maybe 0 id . readMaybe $ T.unpack s
          _ -> 0
        ) (snd <$> bals)
      _ -> 0.0