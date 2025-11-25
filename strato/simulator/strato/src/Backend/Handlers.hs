{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Backend.Handlers where

import Backend.BitcoinRPC
import Bloc.API.Transaction
import Bloc.Client
import BlockApps.Solidity.ArgValue
import Common.BridgeClient (backendBaseUrl, blocBaseUrl)
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
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Servant hiding (HNil)
import Servant.Client
import Strato.Lite.Rest.Server (cirrusClient)

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
                      result <- runClientM (postBlocTransaction Nothing True pbtr) (mkClientEnv mgr blocBaseUrl)
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
      result <- runClientM (postBlocTransaction Nothing True pbtr) (mkClientEnv mgr blocBaseUrl)
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

callCirrus :: Text -> Handler Value
callCirrus t = liftIO $ do
  mgr <- newManager defaultManagerSettings
  eRes <- runClientM (cirrusClient t) (mkClientEnv mgr backendBaseUrl)
  case eRes of
    Left ce -> throwIO ce
    Right res -> pure res

getUserMe :: Handler Value
getUserMe = do
  result <- callCirrus "BlockApps-AdminRegistry"
  pure result

getUserAdmin :: Handler Value
getUserAdmin = pure emptyObject

postUserAdmin :: Value -> Handler Value
postUserAdmin _ = pure emptyObject

deleteUserAdmin :: Value -> Handler Value
deleteUserAdmin _ = pure emptyObject

getTokenBalance :: Handler Value
getTokenBalance = pure emptyObject

getTokenByAddress :: Text -> Handler Value
getTokenByAddress _ = pure emptyObject

getAllTokens :: Handler Value
getAllTokens = pure emptyObject

postToken :: Value -> Handler Value
postToken _ = pure emptyObject

postTokenTransfer :: Value -> Handler Value
postTokenTransfer _ = pure emptyObject

postTokenApprove :: Value -> Handler Value
postTokenApprove _ = pure emptyObject

postTokenTransferFrom :: Value -> Handler Value
postTokenTransferFrom _ = pure emptyObject

postTokenStatus :: Value -> Handler Value
postTokenStatus _ = pure emptyObject

getSwappableTokens :: Handler Value
getSwappableTokens = pure emptyObject

getSwappableTokenPairsByAddress :: Text -> Handler Value
getSwappableTokenPairsByAddress _ = pure emptyObject

getPoolByTokenPair :: Handler Value
getPoolByTokenPair = pure emptyObject

getCalculateSwap :: Handler Value
getCalculateSwap = pure emptyObject

getCalculateSwapReverse :: Handler Value
getCalculateSwapReverse = pure emptyObject

getLPToken :: Handler Value
getLPToken = pure emptyObject

getSwapPoolByAddress :: Text -> Handler Value
getSwapPoolByAddress _ = pure emptyObject

getAllSwapPools :: Handler Value
getAllSwapPools = pure emptyObject

postSwapPool :: Value -> Handler Value
postSwapPool _ = pure emptyObject

postSwapPoolAddLiquidity :: Value -> Handler Value
postSwapPoolAddLiquidity _ = pure emptyObject

postSwapPoolRemoveLiquidity :: Value -> Handler Value
postSwapPoolRemoveLiquidity _ = pure emptyObject

postSwapPoolSwap :: Value -> Handler Value
postSwapPoolSwap _ = pure emptyObject

getLendingPool :: Handler Value
getLendingPool = pure emptyObject

getLendingPoolDepositableTokens :: Handler Value
getLendingPoolDepositableTokens = pure emptyObject

getLendingPoolWithdrawableTokens :: Handler Value
getLendingPoolWithdrawableTokens = pure emptyObject

getLendingPoolLoans :: Handler Value
getLendingPoolLoans = pure emptyObject

getLendingPoolLoanById :: Text -> Handler Value
getLendingPoolLoanById _ = pure emptyObject

postLendingPoolDepositLiquidity :: Value -> Handler Value
postLendingPoolDepositLiquidity _ = pure emptyObject

postLendingPoolWithdrawLiquidity :: Value -> Handler Value
postLendingPoolWithdrawLiquidity _ = pure emptyObject

postLendingPoolRepay :: Value -> Handler Value
postLendingPoolRepay _ = pure emptyObject

postLendingPoolManageLiquidity :: Value -> Handler Value
postLendingPoolManageLiquidity _ = pure emptyObject

postLendingPoolBorrow :: Value -> Handler Value
postLendingPoolBorrow _ = pure emptyObject

postLendingPoolSetInterestRate :: Value -> Handler Value
postLendingPoolSetInterestRate _ = pure emptyObject

postLendingPoolSetCollateralRatio :: Value -> Handler Value
postLendingPoolSetCollateralRatio _ = pure emptyObject

postLendingPoolSetLiquidationBonus :: Value -> Handler Value
postLendingPoolSetLiquidationBonus _ = pure emptyObject

getLendingPoolLiquidatable :: Handler Value
getLendingPoolLiquidatable = pure emptyObject

getLendingPoolLiquidatableNearUnhealthy :: Handler Value
getLendingPoolLiquidatableNearUnhealthy = pure emptyObject

getLendingPoolLiquidatableById :: Text -> Handler Value
getLendingPoolLiquidatableById _ = pure emptyObject

postLendingPoolLiquidateById :: Text -> Value -> Handler Value
postLendingPoolLiquidateById _ _ = pure emptyObject

getOraclePrice :: Handler Value
getOraclePrice = pure emptyObject

postOraclePrice :: Value -> Handler Value
postOraclePrice _ = pure emptyObject

getOnRamp :: Handler Value
getOnRamp = pure emptyObject

postOnRampBuy :: Value -> Handler Value
postOnRampBuy _ = pure emptyObject

postOnRampSell :: Value -> Handler Value
postOnRampSell _ = pure emptyObject

postBridgeIn :: Value -> Handler Value
postBridgeIn _ = pure emptyObject

postBridgeOut :: Value -> Handler Value
postBridgeOut _ = pure emptyObject

getBridgeBalanceByAddress :: Text -> Handler Value
getBridgeBalanceByAddress _ = pure emptyObject

getBridgeInTokens :: Handler Value
getBridgeInTokens = pure emptyObject

getBridgeOutTokens :: Handler Value
getBridgeOutTokens = pure emptyObject

getBridgeDepositStatus :: Text -> Handler Value
getBridgeDepositStatus _ = pure emptyObject

getBridgeWithdrawalStatus :: Text -> Handler Value
getBridgeWithdrawalStatus _ = pure emptyObject

getHealth :: Handler Value
getHealth = pure emptyObject