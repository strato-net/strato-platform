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
import           Control.Monad.IO.Class           (liftIO)
import qualified Data.ByteString.Base16           as BS16
import qualified Data.Map.Strict                  as M
import           Data.Maybe
import qualified Data.Text                        as Text
import qualified Data.Text.Encoding               as Text

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum         hiding (Transaction (..))
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types

import           UnliftIO

toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b

maybeTxBatchResult :: [Keccak256] -> Bloc [Maybe TransactionResult]
maybeTxBatchResult hashes = maybeHeads <$> (blocStrato (postTxResultBatch hashes))
  where maybeHeads btxr =
          let list = map (flip M.lookup $ unBatchTransactionResult btxr) hashes
          in flip map list $ \mtrs -> case mtrs of
            Nothing -> Nothing
            Just trs -> listToMaybe trs


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

waitFor :: Text.Text -> Bloc Bool -> Bloc ()
waitFor msg action = go 20
  where go :: Int -> Bloc ()
        go ms = do
          when (ms > 30000) . throwIO $ CouldNotFind msg
          b <- action
          unless b $ do
            liftIO . threadDelay $ ms * 1000
            go $ 2 * ms
