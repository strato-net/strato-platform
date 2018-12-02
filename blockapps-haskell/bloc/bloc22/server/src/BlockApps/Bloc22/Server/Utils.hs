{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
module BlockApps.Bloc22.Server.Utils where

import           Control.Concurrent
import           Control.Monad                    (forM)
import           Control.Monad.IO.Class
import           Control.Monad.Loops
import           Control.Monad.Trans.State.Strict
import qualified Data.ByteString.Base16           as BS16
import           Data.Foldable                    (toList)
import           Data.Functor.Identity            (runIdentity)
import qualified Data.Map.Strict                  as Map
import           Data.Maybe
import qualified Data.Sequence                    as Q
import qualified Data.Text                        as Text
import qualified Data.Text.Encoding               as Text
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

accumStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m [b]
accumStateT _ [] _ = pure []
accumStateT s (a:as) run = do
  (b,s') <- runStateT (run a) s
  (b:) <$> accumStateT s' as run

buildStateT :: Monad m => s -> [a] -> (a -> StateT s m ()) -> m s
buildStateT s [] _ = pure s
buildStateT s (a:as) run = do
  s' <- execStateT (run a) s
  buildStateT s' as run

partitionWith :: Ord k => (a -> k) -> [a] -> [(k,[a])]
partitionWith f as = map (fmap toList) . Map.toList . runIdentity $ buildStateT Map.empty as $ \a -> do
  let k = f a
  modify $ Map.alter (Just . (Q.|> a) . fromMaybe Q.empty) k
