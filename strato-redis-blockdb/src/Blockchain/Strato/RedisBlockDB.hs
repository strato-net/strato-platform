{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE LambdaCase             #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE OverloadedStrings      #-}
{-# LANGUAGE ScopedTypeVariables    #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}
module Blockchain.Strato.RedisBlockDB
    ( getHeader, getTransactions, getUncles, getBlock
    , putHeader, putBlock
    , HasRedisBlockDB(..), withRedisBlockDB
    ) where

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.RedisBlockDB.Models as Models

import qualified Data.ByteString.Char8                 as S8
import           Data.Maybe                            (fromJust, isNothing)
import           Control.Monad
import           Control.Monad.Trans
import           Database.Redis

class (Monad m) => HasRedisBlockDB m where
    getRedisBlockDB :: m Connection

withRedisBlockDB :: (MonadIO m, HasRedisBlockDB m) => Redis a -> m a
withRedisBlockDB m = do
    db <- getRedisBlockDB
    liftIO $ runRedis db m

inNamespace :: RedisDBKeyable k => BlockDBNamespace -> k -> S8.ByteString
inNamespace ns k = ns' `S8.append` toKey k
    where ns' = case ns of
            Headers      -> "h:"
            Transactions -> "t:"
            Numbers      -> "n:"
            Uncles       -> "u:"

getInNamespace :: BlockDBNamespace -> SHA -> Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns sha = get $ inNamespace ns sha

getHeader :: BlockHeaderLike h => SHA -> Redis (Maybe h)
getHeader sha = getInNamespace Headers sha >>= \case
        Left _             -> return Nothing
        Right Nothing      -> return Nothing
        Right (Just rhead) -> let (RedisHeader h) = fromValue rhead in
            return . Just $ morphBlockHeader h

getTransactions :: TransactionLike t => SHA -> Redis (Maybe [t])
getTransactions sha = getInNamespace Transactions sha >>= \case
        Left _            -> return Nothing
        Right Nothing     -> return Nothing
        Right (Just rtxs) -> let (RedisTxs txs) = fromValue rtxs in
            return . Just $ morphTx <$> txs

getUncles :: BlockHeaderLike h => SHA -> Redis (Maybe [h])
getUncles sha = getInNamespace Headers sha >>= \case
        Left _           -> return Nothing
        Right Nothing    -> return Nothing
        Right (Just rus) -> let (RedisUncles uncles) = fromValue rus in
            return . Just $ morphBlockHeader <$> uncles

getBlock :: BlockLike h t b => SHA -> Redis (Maybe b)
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

putHeader :: (BlockHeaderLike h) => h -> Redis (Either Reply Status)
putHeader h = do
    let sha       = blockHeaderHash h
        number    = blockHeaderBlockNumber h
        storeHead = morphBlockHeader h :: RedisHeader
    res <- multiExec $ do
        void $ setnx (inNamespace Headers sha) (toValue storeHead)
        sadd (inNamespace Numbers number) [toValue sha]
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack "Aborted")  
        TxError e   -> pure . Left $ SingleLine (S8.pack e) 

putBlock :: (BlockLike h t b, BlockHeaderLike h, TransactionLike t) => b -> Redis (Either Reply Status)
putBlock b = do
    let sha    = blockHash b
        number = blockHeaderBlockNumber (blockHeader b)
        header = morphBlockHeader (blockHeader b) :: RedisHeader
        txs    = RedisTxs $ morphTx <$> blockTransactions b
        uncles = RedisUncles $ morphBlockHeader <$> blockUncleHeaders b
        inNS'  = flip inNamespace sha
    res <- multiExec $ do
        void $ setnx (inNS' Headers) (toValue header)
        void $ setnx (inNS' Transactions) (toValue txs)
        void $ setnx (inNS' Uncles) (toValue uncles)
        sadd (inNamespace Numbers number) [toValue sha]
        --forM_ uncles -- todo index the uncles' headers/numbers/etc?
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack "Aborted")  
        TxError e   -> pure . Left $ SingleLine (S8.pack e) 

