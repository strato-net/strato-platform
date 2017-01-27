{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
module Blockchain.Strato.RedisBlockDB
    ( getHeader, getTransactions, getUncles, getBlock
    , putHeader, putBlock
    ) where

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA

import           Blockchain.Strato.RedisBlockDB.Models

import qualified Data.Binary                           as Binary
import qualified Data.ByteString.Char8                 as S8
import qualified Data.ByteString.Lazy                  as BL
import           Data.Maybe                            (fromJust, isNothing)
import           Database.Redis

inNamespace :: BlockDBNamespace -> SHA -> S8.ByteString
inNamespace ns sha = ns' `S8.append` sha'
    where sha' = error "todo"
          ns'  = case ns of
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
        Right (Just rhead) -> let (h :: RedisHeader) = Binary.decode (BL.fromStrict rhead) in
            return . Just $ morphBlockHeader h

getTransactions :: TransactionLike t => SHA -> Redis (Maybe [t])
getTransactions sha = getInNamespace Transactions sha >>= \case
        Left _             -> return Nothing
        Right Nothing      -> return Nothing
        Right (Just rtxs ) -> let (RedisTxs txs) = Binary.decode (BL.fromStrict rtxs) in
            return . Just $ morphTx <$> txs

getUncles :: BlockHeaderLike h => SHA -> Redis (Maybe [h])
getUncles sha = getInNamespace Headers sha >>= \case
        Left _           -> return Nothing
        Right Nothing    -> return Nothing
        Right (Just rus) -> let (RedisUncles uncles) = Binary.decode (BL.fromStrict rus) in
            return . Just $ morphBlockHeader <$> uncles

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
            else let head' = fromJust head
                     txs'  = fromJust txs
                     uncs' = fromJust uncles
                     in return . Just $ buildBlock head' txs' uncs'

putHeader :: Redis ()
putHeader = undefined

putBlock :: Redis ()
putBlock = undefined
