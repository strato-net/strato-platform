{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
{-# OPTIONS -fno-warn-unused-matches #-}
module Blockchain.Strato.RedisBlockDB
    ( getSHAsByNumber
    , getHeader, getHeaders, getHeadersByNumber, getHeadersByNumbers
    , getBlock,  getBlocks,  getBlocksByNumber,  getBlocksByNumbers
    , getTransactions, getUncles
    , getParent, getParents
    , getParentChain, getHeaderChain, getBlockChain
    , getCanonical, getCanonicalHeader, getCanonicalChain, getCanonicalHeaderChain
    , getChildren
    , putHeader, putHeaders, putBlock, putBlocks
    , getBestBlockInfo, putBestBlockInfo
    , HasRedisBlockDB(..), withRedisBlockDB
    , commonAncestorHelper
    ) where

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.RedisBlockDB.Models as Models

import           Control.Arrow                         (second)
import           Control.Monad
import           Control.Monad.Trans
import qualified Data.ByteString.Char8                 as S8
import           Data.Maybe                            (catMaybes, fromJust, fromMaybe, isJust, isNothing)
import qualified Data.Set                              as Set
import           Database.Redis

zipM' :: (Traversable t, Monad m)
      => (a -> m b)
      -> t a
      -> m (t (a, b))
zipM' f = mapM (\x -> (,) x <$> f x)

class (Monad m) => HasRedisBlockDB m where
    getRedisBlockDB :: m Connection

withRedisBlockDB :: (MonadIO m, HasRedisBlockDB m)
                 => Redis a
                 -> m a
withRedisBlockDB m = do
    db <- getRedisBlockDB
    liftIO $ runRedis db m

inNamespace :: RedisDBKeyable k
            => BlockDBNamespace
            -> k
            -> S8.ByteString
inNamespace ns k = ns' `S8.append` toKey k
    where ns' = case ns of
            Headers      -> "h:"
            Transactions -> "t:"
            Numbers      -> "n:"
            Uncles       -> "u:"
            Parent       -> "p:"
            Children     -> "c:"
            Canonical    -> "q:"

bestBlockInfoKey :: S8.ByteString
bestBlockInfoKey = S8.pack "<best>"
{-# INLINE bestBlockInfoKey #-}

getInNamespace :: (RedisDBKeyable key)
               => BlockDBNamespace
               -> key
               -> Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns key = get $ inNamespace ns key

getMembersInNamespace :: (RedisDBKeyable key)
                      => BlockDBNamespace
                      -> key
                      -> Redis (Either Reply [S8.ByteString])
getMembersInNamespace ns = smembers . inNamespace ns

getSHAsByNumber :: Integer
                -> Redis (Maybe [SHA])
getSHAsByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _   -> return Nothing
    Right hs -> let hashes = fromValue <$> hs in
        return (Just hashes)

getHeader :: BlockHeaderLike h
          => SHA
          -> Redis (Maybe h)
getHeader sha = getInNamespace Headers sha >>= \case
    Left _             -> return Nothing
    Right Nothing      -> return Nothing
    Right (Just rhead) -> let (RedisHeader h) = fromValue rhead in
        return . Just $ morphBlockHeader h

getHeaders :: BlockHeaderLike h
           => [SHA]
           -> Redis [(SHA, Maybe h)]
getHeaders = zipM' getHeader

getHeadersByNumber :: BlockHeaderLike h
                   => Integer
                   -> Redis [(SHA, Maybe h)]
getHeadersByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _       -> return []
    Right hashes -> getHeaders (fromValue <$> hashes)

getHeadersByNumbers :: BlockHeaderLike h
                    => [Integer]
                    -> Redis [(Integer, [(SHA, Maybe h)])]
getHeadersByNumbers = zipM' getHeadersByNumber

getTransactions :: TransactionLike t
                => SHA
                -> Redis (Maybe [t])
getTransactions sha = getInNamespace Transactions sha >>= \case
    Left _            -> return Nothing
    Right Nothing     -> return Nothing
    Right (Just rtxs) -> let (RedisTxs txs) = fromValue rtxs in
        return . Just $ morphTx <$> txs

getUncles :: BlockHeaderLike h
          => SHA
          -> Redis (Maybe [h])
getUncles sha = getInNamespace Uncles sha >>= \case
    Left _           -> return Nothing
    Right Nothing    -> return Nothing
    Right (Just rus) -> let (RedisUncles uncles) = fromValue rus in
        return . Just $ morphBlockHeader <$> uncles

getParent :: SHA
          -> Redis (Maybe SHA)
getParent sha = getInNamespace Parent sha >>= \case
    Left _           -> return Nothing
    Right Nothing    -> return Nothing
    Right (Just rps) -> return . Just $ fromValue rps

getParents :: (Traversable f)
           => f SHA
           -> Redis (f (SHA, Maybe SHA))
getParents = zipM' getParent

getChain :: (a -> Redis (Maybe a))
         -> a
         -> Int
         -> Redis [a]
getChain getNext start limit = (start:) <$> helper start limit
    where helper h l | l <= 0    = return []
                     | otherwise = getNext h >>= maybe (return []) chainDown
          chainDown next = (next:) <$> helper next (limit - 1)

getParentChain :: SHA
               -> Int
               -> Redis [SHA]
getParentChain = getChain getParent

getZippedParentChain :: (SHA -> Redis (Maybe t))
                     -> SHA
                     -> Int
                     -> Redis [(SHA, t)]
getZippedParentChain mapper start limit = do
    shaChain <- getParentChain start limit
    mapChain <- zipM' mapper shaChain
    return $ second fromJust <$> takeWhile (isJust . snd) mapChain

getHeaderChain :: (BlockHeaderLike h)
               => SHA
               -> Int
               -> Redis [(SHA, h)]
getHeaderChain = getZippedParentChain getHeader

getBlockChain :: (BlockLike h t b)
              => SHA
              -> Int
              -> Redis [(SHA, b)]
getBlockChain = getZippedParentChain getBlock

getCanonical :: Integer
             -> Redis (Maybe SHA)
getCanonical n = getInNamespace Canonical n >>= \case
    Left _           -> return Nothing
    Right Nothing    -> return Nothing
    Right (Just sha) -> return . Just $ fromValue sha

getCanonicalHeader :: (BlockHeaderLike h)
                   => Integer
                   -> Redis (Maybe h)
getCanonicalHeader n = getCanonical n >>= \case
    Nothing  -> return Nothing
    Just sha -> getHeader sha

getCanonicalChain :: Integer
                  -> Int
                  -> Redis [SHA]
getCanonicalChain start limit = do
    let chain = forM (take limit [start..]) getCanonical
    catMaybes <$> chain

getZippedCanonicalChain :: (SHA -> Redis (Maybe t))
                        -> Integer
                        -> Int
                        -> Redis [(SHA, t)]
getZippedCanonicalChain mapper start limit = do
    shaChain <- getCanonicalChain start limit
    mapChain <- zipM' mapper shaChain
    return $ second fromJust <$> takeWhile (isJust . snd) mapChain

getCanonicalHeaderChain :: (BlockHeaderLike h)
                        => Integer
                        -> Int
                        -> Redis [(SHA, h)]
getCanonicalHeaderChain = getZippedCanonicalChain getHeader

getChildren :: SHA
            -> Redis (Maybe [SHA])
getChildren sha = getMembersInNamespace Children sha >>= \case
    Left _    -> return Nothing
    Right chs -> return . Just $ fromValue <$> chs

getBlock :: BlockLike h t b
         => SHA
         -> Redis (Maybe b)
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
            else let header = fromJust mybHeader
                     txs    = fromJust mybTxs
                     uncles = fromJust mybUncles
                 in return . Just $ buildBlock header txs uncles

getBlocks :: BlockLike h t b
          => [SHA]
          -> Redis [(SHA, Maybe b)]
getBlocks = zipM' getBlock

getBlocksByNumber :: (BlockLike h t b)
                  => Integer
                  -> Redis [(SHA, Maybe b)]
getBlocksByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _       -> return []
    Right hashes -> getBlocks (fromValue <$> hashes)

getBlocksByNumbers :: (BlockLike h t b)
                   => [Integer]
                   -> Redis [(Integer, [(SHA, Maybe b)])]
getBlocksByNumbers = zipM' getBlocksByNumber

putHeader :: (BlockHeaderLike h)
          => h
          -> Redis (Either Reply Status)
putHeader h = do
    let sha       = blockHeaderHash h
        parent    = blockHeaderParentHash h
        number    = blockHeaderBlockNumber h
        storeHead = morphBlockHeader h :: RedisHeader
        inNS'     = flip inNamespace sha
    res <- multiExec $ do
        void $ setnx (inNS' Headers) (toValue storeHead)
        void $ setnx (inNS' Parent) (toValue parent)
        void $ sadd (inNamespace Children parent) [toValue sha]
        sadd (inNamespace Numbers number) [toValue sha]
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack "Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack e)

putHeaders :: (Traversable f, BlockHeaderLike h)
           => f h
           -> Redis (f (Either Reply Status))
putHeaders = mapM putHeader

putBlock :: (BlockLike h t b, BlockHeaderLike h, TransactionLike t)
         => b
         -> Redis (Either Reply Status)
putBlock b = do
    let sha     = blockHash b
        header  = blockHeader b
        number  = blockHeaderBlockNumber header
        parent  = blockHeaderParentHash header
        header' = morphBlockHeader header :: RedisHeader
        txs     = RedisTxs (morphTx <$> blockTransactions b :: [Models.RedisTx])
        uncles  = RedisUncles (morphBlockHeader <$> blockUncleHeaders b)
        inNS'   = flip inNamespace sha
    res <- multiExec $ do
        void $ setnx (inNS' Headers) (toValue header')
        void $ setnx (inNS' Transactions) (toValue txs)
        void $ setnx (inNS' Uncles) (toValue uncles)
        void $ setnx (inNS' Parent) (toValue parent)
        void $ sadd (inNamespace Children parent) [toKey sha]
        sadd (inNamespace Numbers number) [toKey sha]
        --forM_ uncles -- todo index the uncles' headers/numbers/etc?
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack "Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack e)

putBlocks :: (Traversable f, BlockLike h t b, BlockHeaderLike h, TransactionLike t)
          => f b
          -> Redis (f (Either Reply Status))
putBlocks = mapM putBlock

putBestBlockInfo :: SHA
                 -> Integer
                 -> Integer
                 -> Redis (Either Reply Status)
putBestBlockInfo newSha newNumber newTDiff = do
    oldBBI' <- getBestBlockInfo
    case oldBBI' of
        Left err      -> return (Left err)
        Right (oldSha, oldNumber, _) -> do
            helper' <- commonAncestorHelper oldNumber newNumber oldSha newSha (Set.singleton oldSha)
            case helper' of
                Left err -> return (Left err)
                Right (ancestorSha, ancestorNumber, updates, deletions) -> do
                    res <- multiExec $ do
                        forM_ updates $ \(sha, num) -> set (inNamespace Canonical $ toKey num) (toValue sha)
                        forM_ deletions $ del . pure . inNamespace Canonical . toKey
                        set bestBlockInfoKey . toValue $ RedisBestBlock (newSha, newNumber, newTDiff)
                    case res of
                        TxSuccess _ -> return $ Right Ok
                        TxAborted   -> return . Left $ SingleLine (S8.pack "Aborted")
                        TxError e   -> return . Left $ SingleLine (S8.pack e)

commonAncestorHelper :: Integer -> Integer
                     -> SHA -> SHA
                     -> Set.Set SHA
                     -> Redis (Either Reply (SHA, Integer, [(SHA, Integer)], [Integer]))
commonAncestorHelper oldNum newNum oldSha newSha seen = do
    ps@[newParent, oldParent] <- mapM (\x -> fromMaybe x <$> getParent x) [newSha, oldSha]
    let seen' = Set.union seen (Set.fromList ps) -- todo double Set.insert is probably more optimal
    if newParent `Set.member` seen'
        then complete newParent
        else commonAncestorHelper oldNum newNum oldParent newParent seen'

    where complete ancestor = error "todo: we did it reddit!"


getBestBlockInfo :: Redis (Either Reply (SHA, Integer, Integer))
getBestBlockInfo = get bestBlockInfoKey >>= \case
    Left l  -> return (Left l)
    Right r -> case r of
        Nothing -> return . Left $ SingleLine "No BestBlock data set in RedisBlockDB"
        Just bs -> let (RedisBestBlock (sha, num, tDiff)) = fromValue bs in return $ Right (sha, num, tDiff)
