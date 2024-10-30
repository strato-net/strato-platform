{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.Server.Utils
  ( toMaybe,
    getBatchBlocTxStatus,
    partitionWith,
    indexedPartitionWith,
    mergePartitions,
    mergeSortedLists,
    mergeSortedListsWith,
    binRuntimeToCodeHash,
    emptyTxParams,
    waitFor,
    waitForWithTimeout,
    getSigVals,
    getBlockTimestamp,
  )
where

import Bloc.API.Users
import Bloc.API.Utils
import Blockchain.DB.SQLDB (sqlQuery)
import Blockchain.Data.DataDefs
import Blockchain.Data.Json (rtPrimeToRt)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Concurrent (threadDelay)
import Control.Monad (forM, when)
import Control.Monad.Composable.SQL
import qualified Crypto.Secp256k1 as S
import qualified Data.ByteString.Short as BSS
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Data.Time (UTCTime)
import Data.Traversable (for)
import Data.Word
import qualified Database.Esqueleto.Legacy as E
import Handlers.BatchTransactionResult
import Handlers.Transaction
import qualified LabeledError
import qualified MaybeNamed
import SQLM
import Strato.Strato23.API.Types
import UnliftIO

toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b

maybeTxBatchResult ::
  HasSQL m =>
  [Keccak256] ->
  m [Maybe (RawTransaction, TransactionResult)]
maybeTxBatchResult hashes = do
  rtxs <- fmap (map (map rtPrimeToRt)) . for hashes $ \h -> getTransaction' txsFilterParams {qtHash = Just h, qtMinGasLimit = Just 1, qtChainId = Just (MaybeNamed.Named "all")}
  mtxrs <- postBatchTransactionResult hashes
  pure . map (maybeHeads mtxrs) $ (zip hashes rtxs :: [(Keccak256, [RawTransaction])])
  where
    maybeHeads :: M.Map Keccak256 [TransactionResult] -> (Keccak256, [RawTransaction]) -> Maybe (RawTransaction, TransactionResult)
    maybeHeads btxr (h, rtxs) = case (rtxs, M.lookup h btxr) of
      ((rtx : _), Just (txr : _)) -> Just (rtx, txr)
      _ -> Nothing

getBatchBlocTxStatus ::
  HasSQL m =>
  [Keccak256] ->
  m [(BlocTransactionStatus, Maybe (RawTransaction, TransactionResult))]
getBatchBlocTxStatus hashes = do
  mtxrs <- maybeTxBatchResult hashes
  forM mtxrs $ \mtxr ->
    case mtxr of
      Nothing -> return (Pending, mtxr)
      Just (_, txr) -> do
        case transactionResultMessage txr of
          "Success!" -> return (Success, mtxr)
          _ -> return (Failure, mtxr)

emptyTxParams :: TxParams
emptyTxParams = TxParams Nothing Nothing Nothing

binRuntimeToCodeHash :: Text.Text -> Keccak256
binRuntimeToCodeHash = hash . LabeledError.b16Decode "binRuntimeToCodeHash" . Text.encodeUtf8

partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
partitionWith f = map (fmap (map snd)) . indexedPartitionWith f

indexedPartitionWith :: Ord k => (a -> k) -> [a] -> [(k, [(Int, a)])]
indexedPartitionWith f = M.toList . foldr (uncurry builder) M.empty . zip [0 ..]
  where
    builder i a = M.alter (Just . ((i, a) :) . fromMaybe []) (f a)

mergePartitions :: Ord k => [(b, [(k, a)])] -> [a]
mergePartitions = map snd . mergeSortedListsWith fst . map snd

mergeSortedLists :: Ord a => [[a]] -> [a]
mergeSortedLists = mergeSortedListsWith id

mergeSortedListsWith :: Ord k => (a -> k) -> [[a]] -> [a]
mergeSortedListsWith _ [] = []
mergeSortedListsWith _ [as] = as
mergeSortedListsWith f (a1 : a2 : as) = mergeSortedListsWith f ((merge a1 a2) : as)
  where
    merge [] ys = ys
    merge xs [] = xs
    merge (x : xs) (y : ys) =
      if f x <= f y
        then x : merge xs (y : ys)
        else y : merge (x : xs) ys

waitForWithTimeout ::
  MonadIO m =>
  Text.Text ->
  m (Bool, a) ->
  m a
waitForWithTimeout msg action = go 20
  where
    go ms = do
      when (ms > 30000) . throwIO $ CouldNotFind msg
      (b, a) <- action
      if b
        then pure a
        else do
          liftIO . threadDelay $ ms * 1000
          go $ 2 * ms

waitFor ::
  MonadIO m =>
  m (Bool, a) ->
  m (Maybe a)
waitFor action = go 20
  where
    go ms = do
      if (ms > 30000)
        then pure Nothing
        else do
          (b, a) <- action
          if b
            then pure (Just a)
            else do
              liftIO . threadDelay $ ms * 1000
              go $ 2 * ms

-- so we can convert R and S from the signature, and add 27 to V, per
-- Ethereum protocol (and backwards compatibility)
getSigVals :: Signature -> (Word256, Word256, Word8)
getSigVals (Signature (S.CompactRecSig r s v)) =
  let convert = bytesToWord256 . BSS.fromShort
   in (convert r, convert s, v + 0x1b)

getBlockTimestamp :: HasSQL m => Integer -> m UTCTime
getBlockTimestamp n = do
  blk <- sqlQuery $ do
    E.select . E.from $ \bref -> do
      E.where_ (bref E.^. BlockDataRefNumber E.==. E.val n)
      return bref
  case blk of
    (b : _) -> return . blockDataRefTimestamp . E.entityVal $ b
    [] -> error "Could not find this contract's block. Did something terrible happen?"
