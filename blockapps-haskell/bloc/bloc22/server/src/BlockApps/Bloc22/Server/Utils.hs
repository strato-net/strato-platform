{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
module BlockApps.Bloc22.Server.Utils where

import           Control.Concurrent
import           Control.Monad          (forM)
import           Control.Monad.IO.Class
import           Control.Monad.Loops
import qualified Data.ByteString.Base16 as BS16
import qualified Data.Map.Strict        as Map
import           Data.Maybe
import qualified Data.Text                as Text
import qualified Data.Text.Encoding               as Text
import           Servant.Client

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum         hiding (Transaction (..))
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

maybeTxResult :: Keccak256 -> Bloc (Maybe TransactionResult)
maybeTxResult hash = listToMaybe <$> blocStrato (getTxResult hash)

maybeTxBatchResult :: [Keccak256] -> Bloc [Maybe TransactionResult]
maybeTxBatchResult hashes = maybeHeads <$> (blocStrato (postTxResultBatch hashes))
  where maybeHeads btxr =
          let list = map (flip Map.lookup $ unBatchTransactionResult btxr) hashes
          in flip map list $ \mtrs -> case mtrs of
            Nothing -> Nothing
            Just trs -> listToMaybe trs


maybeTx :: Keccak256 -> Bloc (Maybe Transaction)
maybeTx hash = do
  mtx <- blocStrato $ listToMaybe <$> getTxsFilter txsFilterParams{qtHash = Just hash}
  case mtx of
    Just tx -> return $ Just $ withoutNext tx
    Nothing -> return Nothing

getBlocTxStatus :: Keccak256 -> Bloc (BlocTransactionStatus, Maybe TransactionResult)
getBlocTxStatus hash = do
  mtxr <- maybeTxResult hash
  case mtxr of
    Nothing -> return (Pending,mtxr)
    Just txr -> do
      case transactionresultMessage txr of
        "Success!" -> return (Success,mtxr)
        _          -> return (Failure,mtxr)

getBatchBlocTxStatus :: [Keccak256] -> Bloc [(BlocTransactionStatus, Maybe TransactionResult)]
getBatchBlocTxStatus hashes = do
  mtxrs <- maybeTxBatchResult hashes
  forM mtxrs $ \mtxr ->
    case mtxr of
      Nothing -> return (Pending, mtxr)
      Just txr -> do
        case transactionresultMessage txr of
          "Success!" -> return (Success, mtxr)
          _          -> return (Failure, mtxr)

emptyTxParams :: TxParams
emptyTxParams = TxParams Nothing Nothing Nothing

binRuntimeToCodeHash :: Text.Text -> Keccak256
binRuntimeToCodeHash = keccak256 . fst . BS16.decode . Text.encodeUtf8
