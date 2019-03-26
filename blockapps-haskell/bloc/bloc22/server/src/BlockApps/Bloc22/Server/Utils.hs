{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
module BlockApps.Bloc22.Server.Utils
  ( getBatchBlocTxStatus
  , accumStateT
  , partitionWith
  , binRuntimeToCodeHash
  , emptyTxParams
  ) where

import           Control.Monad                    (forM)
import           Control.Monad.Trans.State.Strict
import qualified Data.ByteString.Base16           as BS16
import           Data.Functor.Identity
import qualified Data.Map.Strict                  as Map
import           Data.Maybe
import qualified Data.Text                        as Text
import qualified Data.Text.Encoding               as Text

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum         hiding (Transaction (..))
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

maybeTxBatchResult :: Maybe ChainId -> [Keccak256] -> Bloc [Maybe TransactionResult]
maybeTxBatchResult chainId hashes = maybeHeads <$> (blocStrato (postTxResultBatch chainId hashes))
  where maybeHeads btxr =
          let list = map (flip Map.lookup $ unBatchTransactionResult btxr) hashes
          in flip map list $ \mtrs -> case mtrs of
            Nothing -> Nothing
            Just trs -> listToMaybe trs


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
accumStateT s as f = evalStateT (mapM f as) s

buildStateT :: Monad m => s -> [a] -> (a -> StateT s m ()) -> m s
buildStateT s as f = execStateT (mapM_ f as) s

partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
partitionWith f as = Map.toList . fmap reverse . runIdentity . buildStateT Map.empty as $ \a ->
  modify $ Map.alter (Just . (a:) . fromMaybe []) (f a)
