{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Backend.Handlers where

import Backend.Types
import Backend.BitcoinRPC
import Control.Exception (throwIO)
import Control.Monad (guard)
import Data.Aeson
import Data.Aeson.Types
import Data.Foldable (toList)
import Data.Maybe (mapMaybe, maybeToList)
import Data.Scientific (Scientific, toRealFloat)
import Data.Text (Text)
import qualified Data.Text as T
import Control.Monad.IO.Class (liftIO)
import Servant

sci2Int :: Scientific -> Integer
sci2Int n = round (toRealFloat n :: Double) 

-- Exposed to Servant
getBlockSummaries :: Handler [BlockSummary]
getBlockSummaries = liftIO $ do
  -- Get latest 5 blocks
  Right tip' <- callBitcoinRPC "getblockcount" []
  let tip :: Integer
      tip = case tip' of
              Number n -> sci2Int n
              _        -> 0
  blockHashes <- mapM (\h -> callBitcoinRPC "getblockhash" [toJSON (tip - h)]) [(0 :: Integer)..4]
  blockInfos <- mapM (\case Right (Data.Aeson.Types.String bh) -> callBitcoinRPC "getblock" [toJSON bh]; _ -> pure $ Left "hash error") blockHashes
  pure $ concatMap (either (const []) toBlockSummary) blockInfos

toBlockSummary :: Value -> [BlockSummary]
toBlockSummary v = maybeToList $ parseMaybe (withObject "blocksummary"  $ \o -> do
  ht <- sci2Int <$> o .: "height"
  h  <- o .: "hash"
  n  <- sci2Int <$> o .: "nTx"
  t <- sci2Int <$> o .: "time"
  pure $ BlockSummary ht h n t) v

getGlobalUtxos :: Handler [UtxoSummary]
getGlobalUtxos = liftIO $ do
  res <- callBitcoinRPC "listunspent" []
  return $ either (const []) (mapMaybe toUtxoSummary) (parseMaybeArray res)

getWalletUtxos :: Handler [UtxoSummary]
getWalletUtxos = getGlobalUtxos  -- for now, same as above (can be filtered later)

getWalletBalance :: Handler Double
getWalletBalance = liftIO $ do
  result <- callBitcoinRPC "getbalance" []
  case result of
    Right (Number n) -> pure $ toRealFloat n
    Right other -> throwIO . BackendException . T.pack $ "Unexpected result: " <> show other
    Left err -> throwIO . BackendException $ T.pack err

getMultisigUtxos :: Text -> Handler [UtxoSummary]
getMultisigUtxos addr = liftIO $ do
  res <- callBitcoinRPC "listunspent" []
  case res of
    Right (Array arr) -> pure $ mapMaybe (parseUtxoFor addr) (toList arr)
    Right _ -> pure []
    Left err -> throwIO . BackendException $ T.pack err

postSendToMultisig :: PostSendToMultisigArgs -> Handler Text
postSendToMultisig (PostSendToMultisigArgs addr amt) = liftIO $ do
  res <- callBitcoinRPC "sendtoaddress" [toJSON addr, toJSON amt]
  case res of
    Right (String txid) -> pure txid
    Right other -> throwIO . BackendException . T.pack $ "Unexpected result: " <> show other
    Left err -> throwIO . BackendException $ T.pack err

postBitcoinRpcCommand :: RpcCommand -> Handler Value
postBitcoinRpcCommand (RpcCommand m ps) = do
  result <- liftIO $ callBitcoinRPC (T.unpack m) ps
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