{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
module Blockchain.Strato.RedisBlockDB
    ( getHeader, getTransactions, getUncles, getBlock
    , putHeader, putBlock
    ) where

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA

import           Blockchain.Strato.RedisBlockDB.Models

import qualified Data.ByteString                       as B
import           Data.Maybe                            (fromJust, isNothing)
import           Database.Redis

inNamespace :: BlockDBNamespace -> SHA -> B.ByteString
inNamespace ns sha = ns' `B.append` sha'
    where sha' = error "todo"
          ns'  = case ns of
                    Headers      -> "h:"
                    Transactions -> "t:"
                    Numbers      -> "n:"
                    Uncles       -> "u:"


getInNamespace :: BlockDBNamespace -> SHA -> Redis (Maybe B.ByteString)
getInNamespace ns sha = get $ inNamespace ns sha

getHeader :: BlockHeaderLike h => SHA -> Redis (Maybe h)
getHeader sha = do
    head' <- getInNamespace Headers sha
    if isNothing head'
    then return Nothing
    else let (RedisHeader h) = decode (fromJust head') in return . Just $ morphBlockHeader h

getTransactions :: TransactionLike t => SHA -> Redis (Maybe [t])
getTransactions sha = do
    txs' <- getInNamespace Transactions sha
    if isNothing txs'
    then return Nothing
    else let (RedisTxs txs) = decode (fromJust txs') in return . Just $ morphTx <$> txs

getUncles :: BlockHeaderLike h => SHA -> Redis (Maybe [h])
getUncles sha = do
    uncles' <- getInNamespace Headers sha
    if isNothing uncles'
    then return Nothing
    else let (RedisUncles uncles) = decode (fromJust uncles') in return . Just $ morphBlockHeader <$> uncles

getBlock :: BlockLike h t b => SHA -> Redis (Maybe b)
getBlock sha = do
    head <- getHeader sha
    if isNothing head
    then return Nothing
    else do
        txs <- getTransactions sha
        if isNothing txs
        then return Nothing
        else do
            uncles <- getUncles sha
            if isNothing uncles
            then return Nothing
            else return . Just $ buildBlock head txs uncles

putHeader :: Redis ()
putHeader = undefined

putBlock :: Redis ()
putBlock = undefined
