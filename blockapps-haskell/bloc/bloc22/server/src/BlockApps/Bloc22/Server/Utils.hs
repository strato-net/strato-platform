{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
module BlockApps.Bloc22.Server.Utils where

import           Control.Concurrent
import           Control.Monad              (forM)
import           Control.Monad.IO.Class
import           Control.Monad.Loops
import           Control.Monad.State.Lazy   (State, execState, get, put)
import qualified Data.ByteString.Base16     as BS16
import qualified Data.Map.Strict            as Map
import           Data.Maybe
import qualified Data.Text                  as Text
import qualified Data.Text.Encoding         as Text
import           Servant.Client

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum         hiding (Transaction (..))
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

waitNewBlock :: Maybe ChainId -> ClientM ()
waitNewBlock chainId = do
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
      . head <$> getBlocksLast 0 chainId

maybeTxResult :: Maybe ChainId -> Keccak256 -> Bloc (Maybe TransactionResult)
maybeTxResult chainId hash = listToMaybe <$> blocStrato (getTxResult hash chainId)

maybeTxBatchResult :: Maybe ChainId -> [Keccak256] -> Bloc [Maybe TransactionResult]
maybeTxBatchResult chainId hashes = maybeHeads <$> (blocStrato (postTxResultBatch chainId hashes))
  where maybeHeads btxr =
          let list = map (flip Map.lookup $ unBatchTransactionResult btxr) hashes
          in flip map list $ \mtrs -> case mtrs of
            Nothing -> Nothing
            Just trs -> listToMaybe trs


maybeTx :: Maybe ChainId -> Keccak256 -> Bloc (Maybe Transaction)
maybeTx chainId hash = do
  mtx <- blocStrato $ listToMaybe <$> getTxsFilter txsFilterParams{qtHash = Just hash, qtChainId = chainId}
  case mtx of
    Just tx -> return $ Just $ withoutNext tx
    Nothing -> return Nothing

getBlocTxStatus :: Maybe ChainId -> Keccak256 -> Bloc (BlocTransactionStatus, Maybe TransactionResult)
getBlocTxStatus chainId hash = do
  mtxr <- maybeTxResult chainId hash
  case mtxr of
    Nothing -> return (Pending,mtxr)
    Just txr -> do
      case transactionresultMessage txr of
        "Success!" -> return (Success,mtxr)
        _          -> return (Failure,mtxr)

getBatchBlocTxStatus :: Maybe ChainId -> [Keccak256] -> Bloc [(BlocTransactionStatus, Maybe TransactionResult)]
getBatchBlocTxStatus chainId hashes = do
  mtxrs <- maybeTxBatchResult chainId hashes
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

buildState :: s -> [a] -> (a -> State s ()) -> s
buildState s [] _ = s
buildState s (a:as) run =
  let s' = execState (run a) s
   in buildState s' as run

partitionWith :: Ord k => (a -> k) -> [a] -> [(k,[a])]
partitionWith f as = map (fmap reverse) . Map.toList . buildState Map.empty as $ \a -> do
  s <- get
  let k = f a
  case Map.lookup k s of
    Nothing -> put (Map.insert k [a] s)
    Just _  -> put (Map.update (Just . (a:)) k s)
