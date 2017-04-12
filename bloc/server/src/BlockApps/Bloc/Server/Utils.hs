{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.Server.Utils where


import Control.Concurrent
import Control.Monad.Log
import Control.Monad.Loops
import Control.Monad.IO.Class
import Data.Maybe
import Data.Monoid
import Data.Text (Text)
import Servant.Client

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Ethereum
import BlockApps.Strato.Client
import BlockApps.Strato.Types

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
    (liftIO (putStrLn "checking condition" >> (threadDelay 1000000)))
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

pollTxResult :: Text -> Bloc TransactionResult
pollTxResult hash = untilJust $ do
  liftIO $ threadDelay 1000000
  logWith logNotice $ "Looking up " <> hash
  result <- blocStrato $ getTxResult hash
  return $ listToMaybe result

emptyTxParams :: TxParams
emptyTxParams = TxParams Nothing Nothing Nothing
