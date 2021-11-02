{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
module BlockApps.Bloc22.Server.Utils
  ( toMaybe
  , getBatchBlocTxStatus
  , partitionWith
  , indexedPartitionWith
  , mergePartitions
  , mergeSortedLists
  , mergeSortedListsWith
  , binRuntimeToCodeHash
  , emptyTxParams
  , waitFor
  ) where

import           Control.Concurrent               (threadDelay)
import           Control.Monad                    (forM, unless, when)
import qualified Data.ByteString.Base16           as BS16
import qualified Data.Map.Strict                  as M
import           Data.Maybe
import qualified Data.Text                        as Text
import qualified Data.Text.Encoding               as Text
import           Data.Traversable                 (for)
import           UnliftIO


import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json            (rtPrimeToRt)
import           Blockchain.Strato.Model.Keccak256

import           Control.Monad.Composable.SQL

import           Handlers.BatchTransactionResult
import           Handlers.Transaction
import           SQLM


toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b

maybeTxBatchResult :: HasSQL m =>
                      [Keccak256] -> m [Maybe (RawTransaction, TransactionResult)]
maybeTxBatchResult hashes = do
  rtxs <- fmap (map (map rtPrimeToRt)) . for hashes $ \h -> getTransaction' txsFilterParams{qtHash=Just h}
  mtxrs <- postBatchTransactionResult hashes
  pure . map (maybeHeads mtxrs) $ (zip hashes rtxs :: [(Keccak256, [RawTransaction])])
  where maybeHeads :: M.Map Keccak256 [TransactionResult] -> (Keccak256, [RawTransaction]) -> Maybe (RawTransaction, TransactionResult)
        maybeHeads btxr (h, rtxs) = case (rtxs, M.lookup h btxr) of
          ((rtx:_), Just (txr:_)) -> Just (rtx, txr)
          _ -> Nothing

getBatchBlocTxStatus :: HasSQL m =>
                        [Keccak256] -> m [(BlocTransactionStatus, Maybe (RawTransaction, TransactionResult))]
getBatchBlocTxStatus hashes = do
  mtxrs <- maybeTxBatchResult hashes
  forM mtxrs $ \mtxr ->
    case mtxr of
      Nothing -> return (Pending, mtxr)
      Just (_, txr) -> do
        case transactionResultMessage txr of
          "Success!" -> return (Success, mtxr)
          _          -> return (Failure, mtxr)

emptyTxParams :: TxParams
emptyTxParams = TxParams Nothing Nothing Nothing

binRuntimeToCodeHash :: Text.Text -> Keccak256
binRuntimeToCodeHash = hash . fst . BS16.decode . Text.encodeUtf8

partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
partitionWith f = map (fmap (map snd)) . indexedPartitionWith f

indexedPartitionWith :: Ord k => (a -> k) -> [a] -> [(k, [(Int, a)])]
indexedPartitionWith f = M.toList . foldr (uncurry builder) M.empty . zip [0..]
  where builder i a = M.alter (Just . ((i,a):) . fromMaybe []) (f a)

mergePartitions :: Ord k => [(b, [(k, a)])] -> [a]
mergePartitions = map snd . mergeSortedListsWith fst . map snd

mergeSortedLists :: Ord a => [[a]] -> [a]
mergeSortedLists = mergeSortedListsWith id

mergeSortedListsWith :: Ord k => (a -> k) -> [[a]] -> [a]
mergeSortedListsWith _ []         = []
mergeSortedListsWith _ [as]       = as
mergeSortedListsWith f (a1:a2:as) = mergeSortedListsWith f ((merge a1 a2):as)
  where merge [] ys = ys
        merge xs [] = xs
        merge (x:xs) (y:ys) = if f x <= f y
                                then x:merge xs (y:ys)
                                else y:merge (x:xs) ys

waitFor :: MonadIO m =>
           Text.Text -> m Bool -> m ()
waitFor msg action = go 20
  where go ms = do
          when (ms > 30000) . throwIO $ CouldNotFind msg
          b <- action
          unless b $ do
            liftIO . threadDelay $ ms * 1000
            go $ 2 * ms
