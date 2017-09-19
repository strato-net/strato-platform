{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
module BlockApps.Bloc22.Server.Utils where

import           Control.Concurrent
import           Control.Monad.IO.Class
import           Control.Monad.Log
import           Control.Monad.Loops
import qualified Data.ByteString.Base16 as BS16
import           Data.Maybe
import qualified Data.Text                as Text
import qualified Data.Text.Encoding               as Text
import           Servant.Client

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

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
waitNewAccount addr = do
  account <- getAccount
  case account of 
    Just acc -> return acc 
    Nothing -> untilJust $ delay1 >> getAccount
  where
    getAccount = listToMaybe <$> getAccountsFilter accountsFilterParams{qaAddress = Just addr}
    delay1 = liftIO $ do
      putStrLn $ "Waiting on transaction result for new account at address " ++ addressString addr
      threadDelay 1000000

putBlocTxData :: BlocTransactionResult -> Maybe BlocTransactionData -> BlocTransactionResult
putBlocTxData BlocTransactionResult{..} = BlocTransactionResult blocTransactionStatus blocTransactionHash

maybeTxResult :: Keccak256 -> Bloc (Maybe TransactionResult)
maybeTxResult hash = listToMaybe <$> blocStrato (getTxResult hash)

getBlocTxStatus :: Keccak256 -> Bloc BlocTransactionStatus
getBlocTxStatus hash = do
  maybeResult <- maybeTxResult hash
  case maybeResult of
    Nothing -> return Pending
    Just res -> case transactionresultMessage res of
      "Success!" -> return Success
      _          -> return Failure

pollBlocTxStatus :: Keccak256 -> Bloc BlocTransactionStatus
pollBlocTxStatus hash = go 1
  where
    attempts = 30 :: Int
    hashString = keccak256String hash
    go n = do
      logWith logNotice . Text.pack $ "[" ++ show n ++ "/" ++ show attempts ++ "] Polling BlocTransactionStatus for transaction hash: " ++ hashString
      status <- getBlocTxStatus hash
      case status of
        Pending -> if n > attempts 
                     then return status
                     else return (threadDelay 1000000) >> go (n+1)
        _       -> return status

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

binRuntimeToCodeHash :: Text.Text -> Keccak256
binRuntimeToCodeHash = keccak256 . fst . BS16.decode . Text.encodeUtf8
