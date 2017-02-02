{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE LambdaCase             #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE OverloadedStrings      #-}
{-# LANGUAGE ScopedTypeVariables    #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.RedisBlockDB
    ( getSHAsByNumber
    , getHeader, getHeaders, getHeadersByNumber, getHeadersByNumbers
    , getBlock,  getBlocks,  getBlocksByNumber,  getBlocksByNumbers
    , getTransactions, getUncles
    , getParent, getParents
    , getParentChain, getHeaderChain, getBlockChain
    , getCanonicalHeader, getCanonicalHeaderChain
    , getChildren
    , putHeader, putHeaders, putBlock, putBlocks
    , HasRedisBlockDB(..), withRedisBlockDB
    ) where

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.RedisBlockDB.Models as Models

import qualified Data.ByteString.Char8                 as S8
import           Data.Maybe                            (fromJust, isJust, isNothing)
import           Control.Arrow                         (second)
import           Control.Monad
import           Control.Monad.Trans
import           Database.Redis

zipM' :: (Traversable t, Monad m)
      => (a -> m b)
      -> t a
      -> m (t (a, b))
zipM' f = mapM (\x -> (,) x <$> f x)

-- zipA' :: (Traversable t, Applicative a) => (x -> a b) -> t x -> a (t (x, y))
-- zipA' f = traverse (strength . id &&& f)
--     where
--         strength (x, fy) = fmap (,) x fy

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

getInNamespace :: BlockDBNamespace
               -> SHA
               -> Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns sha = get $ inNamespace ns sha

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

getParentChain :: SHA
               -> Int
               -> Redis [SHA]
getParentChain start limit = (start:) <$> helper start limit
    where helper h l | l <= 0    = return []
                     | otherwise = getParent h >>= maybe (return []) chainDown
          chainDown parent = (parent:) <$> helper parent (limit - 1)

getZippedParentChain :: (SHA -> Redis (Maybe t)) -> SHA -> Int -> Redis [(SHA, t)]
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

getCanonicalHeader :: (BlockHeaderLike h)
                   => Integer
                   -> Int
                   -> Redis (Maybe h)
getCanonicalHeader = undefined

getCanonicalHeaderChain :: (BlockHeaderLike h)
                        => Integer
                        -> Int
                        -> Redis [(SHA, h)]
getCanonicalHeaderChain = undefined


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
