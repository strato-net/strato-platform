{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
module BlockApps.Bloc21.Server.Utils where

import           Control.Concurrent
import           Control.Monad.IO.Class
import           Control.Monad.Log
import           Control.Monad.Loops
import           Data.Maybe
import qualified Data.Text                as Text
import           Servant.Client

import           BlockApps.Bloc21.API.Utils
import           BlockApps.Bloc21.Monad
import           BlockApps.Ethereum
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

tester7 :: BaseUrl
tester7 = BaseUrl Http "tester7.centralus.cloudapp.azure.com" 80 "/bloc"

bayar4a :: BaseUrl
bayar4a = BaseUrl Http "bayar4a.eastus.cloudapp.azure.com" 80 "/bloc"

strato :: BaseUrl
strato = BaseUrl Http "bayar4a.eastus.cloudapp.azure.com" 80 "/strato-api/eth/v1.2"

waitNewBlock :: ClientM ()
waitNewBlock = do
  blockNum <- lastBlockNum
  liftIO $ print blockNum
  untilM_
    (liftIO $ putStrLn "checking condition" >> threadDelay 1000000)
    (do
      liftIO $ putStrLn "getting last block number"
      blockNum' <- lastBlockNum
      liftIO $ print blockNum'
      return $ blockNum' /= blockNum)
  where
    lastBlockNum
      = blockdataNumber
      . blockBlockData
      . withoutNext
      . head <$> getBlocksLast 0

waitNewAccount :: Address -> ClientM Account
waitNewAccount addr = untilJust $ listToMaybe <$>
  getAccountsFilter accountsFilterParams{qaAddress = Just addr}

pollTxResult :: Keccak256 -> Bloc TransactionResult
pollTxResult hash = go 1
  where
    attempts = 30 :: Int
    hashString = keccak256String hash
    go n | n > attempts = blocError . AnError . Text.pack $ "Strato result polling timeout after " ++ show attempts ++ " attempts on transaction hash: " ++ hashString
         | otherwise = do
      liftIO $ threadDelay 1000000
      logWith logNotice . Text.pack $ "[" ++ show n ++ "/" ++ show attempts ++ "] Polling result for transaction hash: " ++ hashString
      result <- blocStrato (getTxResult hash)
      case listToMaybe result of
        Nothing  -> go (n+1)
        Just res -> return res

pollTxResultBatch :: [Keccak256] -> Bloc BatchTransactionResult
pollTxResultBatch keccaks = go 1 where
    attempts   = 15 :: Int
    hashString = show (keccak256String <$> keccaks)
    go n | n > attempts = blocError . AnError . Text.pack $ "Strato result batch polling timeout after " ++ show attempts ++ " attempts for hashes: " ++ hashString
         | otherwise    = do
             logWith logNotice . Text.pack $ "[" ++ show n ++ "/" ++ show attempts ++ "] Looking up " ++ hashString
             resolutions <- blocStrato (postTxResultBatch keccaks)
             if any null (unBatchTransactionResult resolutions)
                 then liftIO (threadDelay 1000000) >> go (n + 1)
                 else return resolutions
emptyTxParams :: TxParams
emptyTxParams = TxParams Nothing Nothing Nothing
