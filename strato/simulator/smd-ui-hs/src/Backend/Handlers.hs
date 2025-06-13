{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Backend.Handlers where

import Backend.BitcoinRPC
import Bloc.API.Transaction
import Bloc.Client
import BlockApps.Solidity.ArgValue
import Common.Types
import Control.Exception (throwIO)
import Control.Monad (guard)
import Control.Monad.IO.Class (liftIO)
import Data.Aeson
import Data.Aeson.Types
import Data.Foldable (toList)
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, mapMaybe)
import Data.Proxy
import Data.Scientific (toRealFloat)
import Data.Text (Text)
import qualified Data.Text as T
import Frontend.BridgeClient (blocBaseUrl)
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Servant hiding (HNil)
import Servant.Client

-- Exposed to Servant
getBlockSummaries :: Handler [BitcoinBlockSummary]
getBlockSummaries = liftIO $ do
  -- Get latest 5 blocks
  callBitcoinRPC (Proxy @GetBlockCount) HNil >>= \case
    Left _ -> pure []
    Right tip -> do
      blockHashes <- mapM (\h -> callBitcoinRPC (Proxy @GetBlockHash) (HEnd $ tip - h)) [(0 :: Integer)..4]
      catMaybes . map (either (const Nothing) Just) <$> mapM (\case Right bh -> callBitcoinRPC (Proxy @GetBlock) (HEnd bh); _ -> pure $ Left "hash error") blockHashes

getGlobalUtxos :: Handler [UtxoSummary]
getGlobalUtxos = getWalletUtxos  -- for now, same as above (can be filtered later)

getWalletUtxos :: Handler [UtxoSummary]
getWalletUtxos = liftIO $ either (const []) id <$> callBitcoinRPC (Proxy @GetWalletUTXOSummaries) HNil

listWalletUtxos :: IO [UTXO]
listWalletUtxos = either (const []) id <$> callBitcoinRPC (Proxy @GetWalletUTXOs) HNil

getWalletBalance :: Handler Double
getWalletBalance = liftIO $ do
  result <- callBitcoinRPC (Proxy @GetBalance) HNil
  case result of
    Right bal -> pure bal
    Left err -> throwIO . BackendException $ T.pack err

getMultisigUtxos :: Text -> Handler [UtxoSummary]
getMultisigUtxos addr = liftIO $ do
  res <- callBitcoinRPCRaw "listunspent" []
  case res of
    Right (Array arr) -> pure $ mapMaybe (parseUtxoFor addr) (toList arr)
    Right _ -> pure []
    Left err -> throwIO . BackendException $ T.pack err

postSendToMultisig :: PostSendToMultisigArgs -> Handler Text
postSendToMultisig (PostSendToMultisigArgs funcName amt) = liftIO $ do
  if funcName == "bridgeIn"
    then do
      addrs'' <- sequence (replicate 1 $ callBitcoinRPC (Proxy @GetNewAddress) HNil >>= \a -> a <$ putStrLn ("MULTISIG Address: " ++ show a))
      case sequence addrs'' of
        Left e -> throwIO . BackendException $ T.pack e
        Right [] -> throwIO . BackendException $ T.pack "Empty list"
        Right (addrs':_) -> do
          -- vals' <- traverse (\a -> callBitcoinRPC (Proxy @ValidateAddress) (HEnd a) >>= \a' -> a' <$ putStrLn ("MULTISIG Address Validation: " ++ show a')) addrs'
          -- case sequence vals' of
          --   Left e -> throwIO . BackendException $ T.pack e
          --   Right vals -> do
          --     callBitcoinRPC (Proxy @CreateMultiSig) (2 ::: HEnd (avScriptPubKey <$> vals)) >>= \case
          --       Left e -> throwIO . BackendException $ T.pack e
          --       Right multisig -> do
          --         putStrLn $ "MULTISIG Script: " ++ show multisig
                  -- callBitcoinRPC (Proxy @SendToAddress) (addrs' ::: HEnd amt) >>= \case
                  --   Left e -> throwIO . BackendException $ T.pack e
                  --   Right txid -> do
                      mgr <- newManager defaultManagerSettings -- tlsManagerSettings
                      let payload = BlocFunction $ FunctionPayload
                            { functionpayloadContractAddress = 0x1234567890,
                              functionpayloadMethod = funcName,
                              functionpayloadArgs = M.fromList [("_txid", ArgString addrs'), ("_amount", ArgInt (round $ amt * 100000000))],
                              functionpayloadTxParams = Nothing,
                              functionpayloadMetadata = Just $ M.fromList [("VM", "SolidVM")]
                            }
                          pbtr = PostBlocTransactionRequest Nothing [payload] Nothing Nothing
                      result <- runClientM (postBlocTransaction (Just False) True pbtr) (mkClientEnv mgr blocBaseUrl)
                      pure . T.pack $ show result
    else do
      mgr <- newManager defaultManagerSettings -- tlsManagerSettings
      let payload = BlocFunction $ FunctionPayload
            { functionpayloadContractAddress = 0x1234567890,
              functionpayloadMethod = funcName,
              functionpayloadArgs = M.fromList [("_txid", ArgString . T.pack $ "dummy" ++ show amt), ("_amount", ArgInt (round $ amt * 100000000))],
              functionpayloadTxParams = Nothing,
              functionpayloadMetadata = Just $ M.fromList [("VM", "SolidVM")]
            }
          pbtr = PostBlocTransactionRequest Nothing [payload] Nothing Nothing
      result <- runClientM (postBlocTransaction (Just False) True pbtr) (mkClientEnv mgr blocBaseUrl)
      pure . T.pack $ show result
  -- callBitcoinRPC (Proxy @GetNewAddress) HNil >>= \case
  --   Left e -> throwIO . BackendException $ T.pack e
  --   Right addr -> callBitcoinRPC (Proxy @SendToAddress) (addr ::: HEnd amt) >>= \case
  --     Right txid -> pure txid
  --     Left err -> throwIO . BackendException $ T.pack err

postBitcoinRpcCommand :: RpcCommand -> Handler Value
postBitcoinRpcCommand (RpcCommand m ps) = do
  result <- liftIO $ callBitcoinRPCRaw (T.unpack m) ps
  case result of
    Left err -> throwError err500 { errBody = encode (String $ T.pack err) }
    Right val -> pure val

sampleTransactions :: [Transaction]
sampleTransactions =
  [ Transaction 892370 "Order" "Supreme® x Jordan® Biggie S/S Top" "/img/shirt.png" 1 (Just 60.0) "dnorwood-personal" "blockapps_clothing" (Just "d280e8...") "Oct 11, 2024 12:02 PM" "Successful"
  , Transaction 428027 "Redemption" "Sad Dog Kennel Club ($SADDOGS)" "/img/dog.png" 1 Nothing "dnorwood-personal" "blockapps_tokens" Nothing "Sep 15, 2024 8:00 PM" "Pending"
  ]

getMarketplaceTransactions :: Handler [Transaction]
getMarketplaceTransactions = pure sampleTransactions
-- === Helpers ===

parseMaybeArray :: Either e Value -> Either e [Value]
parseMaybeArray (Right (Array arr)) = Right (toList arr)
parseMaybeArray (Right _) = Right []
parseMaybeArray (Left e) = Left e

toUtxoSummary :: Value -> Maybe UtxoSummary
toUtxoSummary = parseMaybe . withObject "utxo" $ \o -> do
  addr <- o .: "address"
  amt  <- toRealFloat <$> o .: "amount"
  conf <- fromInteger . sci2Int <$> o .: "confirmations"
  return $ UtxoSummary addr amt conf

parseUtxoFor :: Text -> Value -> Maybe UtxoSummary
parseUtxoFor target v = do
  UtxoSummary addr amt conf <- toUtxoSummary v
  guard (addr == target)
  pure $ UtxoSummary addr amt conf