{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.BlockDB
  ( getHeader,
    getHeaders,
    getBlock,
    getBlocks,
    getTransactions,
    getParent,
    getCanonicalHeader,
    putHeader,
    putHeaders,
    insertHeader,
    insertHeaders,
    deleteHeader,
    deleteHeaders,
    putBlock,
    insertBlock,
    insertBlocks,
    deleteBlock,
    deleteBlocks,
    commonAncestorHelper,
  )
where

import Blockchain.Data.BlockHeader
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.RedisBlockDB.Models as Models
import Control.Arrow ((&&&))
import Control.Monad
import qualified Data.ByteString.Char8 as S8
import Data.Foldable (foldl')
import qualified Data.Map.Strict as M
import Data.Maybe (fromJust, fromMaybe, isNothing)
import qualified Data.Set as S
import Database.Redis

-- todo: move this somewhere?
zipMapM ::
  (Traversable t, Monad m) =>
  (a -> m b) ->
  t a ->
  m (t (a, b))
zipMapM f = mapM (\x -> (,) x <$> f x)

inNamespace ::
  RedisDBKeyable k =>
  BlockDBNamespace ->
  k ->
  S8.ByteString
inNamespace ns k = ns' `S8.append` toKey k
  where
    ns' = namespaceToKeyPrefix ns

namespaceToKeyPrefix :: BlockDBNamespace -> S8.ByteString 
namespaceToKeyPrefix ns = case ns of 
  Headers -> "h:"
  Transactions -> "t:"
  Numbers -> "n:"
  Uncles -> "u:"
  Parent -> "p:"
  Children -> "c:"
  Canonical -> "q:"
  Validators -> "validators"
  X509Certificates -> "x509:"
  ParsedSetWhitePage -> "potu:"
  ParsedSetToX509 -> "psx509:"

getInNamespace ::
  (RedisDBKeyable key) =>
  BlockDBNamespace ->
  key ->
  Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns key = get $ inNamespace ns key

getHeader ::
  Keccak256 ->
  Redis (Maybe BlockHeader)
getHeader sha =
  getInNamespace Headers sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rhead) ->
      let (RedisHeader h) = fromValue rhead
       in return . Just $ morphBlockHeader h

getHeaders ::
  [Keccak256] ->
  Redis [(Keccak256, Maybe BlockHeader)]
getHeaders = zipMapM getHeader

getTransactions ::
  Keccak256 ->
  Redis (Maybe [OutputTx])
getTransactions sha =
  getInNamespace Transactions sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rtxs) ->
      let (RedisTxs txs) = fromValue rtxs
       in return . Just $ morphTx <$> txs

getUncles ::
  Keccak256 ->
  Redis (Maybe [BlockHeader])
getUncles sha =
  getInNamespace Uncles sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rus) ->
      let (RedisUncles uncles) = fromValue rus
       in return . Just $ morphBlockHeader <$> uncles

getParent ::
  Keccak256 ->
  Redis (Maybe Keccak256)
getParent sha =
  getInNamespace Parent sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rps) -> return . Just $ fromValue rps

getCanonical ::
  Integer ->
  Redis (Maybe Keccak256)
getCanonical n =
  getInNamespace Canonical n >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just sha) -> return . Just $ fromValue sha

getCanonicalHeader ::
  Integer ->
  Redis (Maybe BlockHeader)
getCanonicalHeader n =
  getCanonical n >>= \case
    Nothing -> return Nothing
    Just sha -> getHeader sha

getBlock ::
  Keccak256 ->
  Redis (Maybe OutputBlock)
getBlock sha = do
  mybHeader <- getHeader sha
  if isNothing mybHeader
    then return Nothing
    else do
      mybTxs <- getTransactions sha
      if isNothing mybTxs
        then return Nothing
        else do
          mybUncles <- getUncles sha
          if isNothing mybUncles
            then return Nothing
            else
              let header = fromJust mybHeader
                  txs = fromJust mybTxs
                  uncles = fromJust mybUncles
               in return . Just $ buildBlock header txs uncles

getBlocks ::
  [Keccak256] ->
  Redis [(Keccak256, Maybe OutputBlock)]
getBlocks = zipMapM getBlock

putHeader ::
  BlockHeader ->
  Redis (Either Reply Status)
putHeader = uncurry insertHeader . (blockHeaderHash &&& id)

putHeaders ::
  Traversable t =>
  t BlockHeader ->
  Redis (t (Either Reply Status))
putHeaders = mapM putHeader

insertHeader ::
  Keccak256 ->
  BlockHeader ->
  Redis (Either Reply Status)
insertHeader sha h = do
  let parent = blockHeaderParentHash h
      number' = blockHeaderBlockNumber h
      storeHead = morphBlockHeader h :: RedisHeader
      inNS' = flip inNamespace sha

  res <- multiExec $ do
    void $ setnx (inNS' Headers) (toValue storeHead)
    void $ setnx (inNS' Parent) (toValue parent)
    void $ sadd (inNamespace Children parent) [toValue sha]
    sadd (inNamespace Numbers number') [toValue sha]
  case res of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack "insertHeader - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "insertHeader - Error" ++ e)

insertHeaders ::
  M.Map Keccak256 BlockHeader ->
  Redis (M.Map Keccak256 (Either Reply Status))
insertHeaders = sequenceA . M.mapWithKey insertHeader

deleteHeader ::
  Keccak256 ->
  Redis (Either Reply Status)
deleteHeader _ = pure . Left $ SingleLine (S8.pack "deleteHeader - Not Implemented")

deleteHeaders ::
  Traversable t =>
  t Keccak256 ->
  Redis (t (Either Reply Status))
deleteHeaders = mapM deleteHeader

putBlock ::
  OutputBlock ->
  Redis (Either Reply Status)
putBlock b =
  let sha = blockHash b
   in insertBlock sha b

--partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
-- partitionWith f = map (fmap (map snd)) . indexedPartitionWith f

insertBlock ::
  Keccak256 ->
  OutputBlock ->
  Redis (Either Reply Status)
insertBlock sha b = do
  let header = blockHeader b
      number' = blockHeaderBlockNumber header
      parent = blockHeaderParentHash header
      header' = morphBlockHeader header :: RedisHeader
      txs = RedisTxs (morphTx <$> blockTransactions b :: [Models.RedisTx])
      uncles = RedisUncles (morphBlockHeader <$> blockUncleHeaders b)
      inNS' = flip inNamespace sha
  res <- multiExec $ do
    void $ setnx (inNS' Headers) (toValue header')
    void $ setnx (inNS' Transactions) (toValue txs)
    void $ setnx (inNS' Uncles) (toValue uncles)
    void $ setnx (inNS' Parent) (toValue parent)
    void $ sadd (inNamespace Children parent) [toKey sha]
    sadd (inNamespace Numbers number') [toKey sha]
  --forM_ uncles -- todo index the uncles' headers/numbers/etc?
  case res of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack "Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack e)

insertBlocks ::
  M.Map Keccak256 OutputBlock ->
  Redis (M.Map Keccak256 (Either Reply Status))
insertBlocks = sequenceA . M.mapWithKey insertBlock

deleteBlock ::
  Keccak256 ->
  Redis (Either Reply Status)
deleteBlock _ = pure . Left $ SingleLine (S8.pack "deleteBlock - Not Implemented")

deleteBlocks ::
  Traversable t =>
  t Keccak256 ->
  Redis (t (Either Reply Status))
deleteBlocks = mapM deleteBlock

commonAncestorHelper ::
  Integer ->
  Integer ->
  Keccak256 ->
  Keccak256 ->
  Redis (Either Reply ([(Keccak256, Integer)], [Integer])) -- ([Updates], [Deletions])
commonAncestorHelper oldNum newNum oldSha' newSha' = helper [oldSha'] [newSha'] (S.fromList [oldSha', newSha'])
  where
    helper [oldSha] [newSha] _ | oldSha == newSha = return $ Right ([], [])
    helper (_ : (oldSha'' : _)) (_ : (newSha'' : ns)) _ | oldSha'' == newSha'' = complete oldSha'' (mkParentChain newSha'' ns)
    helper oldShaChain newShaChain seen = do
      let oldSha = head oldShaChain
          newSha = head newShaChain
      newParent <- (\x -> fromMaybe x <$> getParent x) newSha
      oldParent <- (\x -> fromMaybe x <$> getParent x) oldSha
      let ps = [newParent, oldParent]
      let seen' = foldl' (flip S.insert) seen (filter (/= unsafeCreateKeccak256FromWord256 0) ps) -- todo double S.insert is probably more optimal
      if newParent `S.member` seen
        then complete newParent (mkParentChain newParent newShaChain)
        else
          if oldParent `S.member` seen
            then complete oldParent (mkParentChain oldParent newShaChain)
            else helper (mkParentChain oldParent oldShaChain) (mkParentChain newParent newShaChain) seen'

    -- earlier, we "cycle" the last block we were able to get if we cant traverse the parent chain any
    -- deeper (i.e., we hit genesis block, and cant get any more parents for that chain)
    -- this prevents the cycling from prepending the same block over and over to the chain head
    -- and messing up the chain lengths
    --
    -- the second case is impossible because `helper`, which calls mkParentChain,
    -- always gets called with a list of at least length 1
    mkParentChain :: Keccak256 -> [Keccak256] -> [Keccak256]
    mkParentChain h xs | keccak256ToWord256 h == 0 = xs
    mkParentChain y xs@(x : _) = if x == y then xs else y : xs
    mkParentChain _ [] = error "the impossible happened, somehow called (mkParentChain _ [])"

    complete :: Keccak256 -> [Keccak256] -> Redis (Either Reply ([(Keccak256, Integer)], [Integer]))
    complete lca newShaChain =
      getHeader lca >>= \case
        Nothing ->
          if lca /= unsafeCreateKeccak256FromWord256 0 -- genesis block is sha 0
            then
              return . Left . SingleLine . S8.pack $
                "Could not get ancestor header for Keccak256 " ++ keccak256ToHex lca
            else complete (head newShaChain) newShaChain
        Just ancestor -> do
          --liftIO . putStrLn $ show (keccak256ToHex lca, keccak256ToHex <$> newShaChain)
          let ancestorNumber = blockHeaderBlockNumber ancestor
              deletions = [newNum + 1 .. oldNum]
              updates = flip zip [ancestorNumber ..] $ dropWhile (/= lca) newShaChain
          return $ Right (updates, deletions)
