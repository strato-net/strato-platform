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

import qualified Data.Serialize                        as Serialize
import qualified Data.ByteString.Char8                 as S8
import           Data.Maybe                            (fromJust, isNothing)
import           Database.Redis

inNamespace :: BlockDBNamespace -> SHA -> S8.ByteString
inNamespace ns sha = ns' `S8.append` sha'
    where sha' = S8.pack $ "bytestringy sha of" ++ show sha
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
        Right (Just rhead) -> let (h :: Either String RedisHeader) = Serialize.decode rhead in
            either (error . show) (return . Just . morphBlockHeader) h

getTransactions :: TransactionLike t => SHA -> Redis (Maybe [t])
getTransactions sha = getInNamespace Transactions sha >>= \case
        Left _             -> return Nothing
        Right Nothing      -> return Nothing
        Right (Just rtxs ) -> let (Right (RedisTxs txs)) = Serialize.decode rtxs in
            return . Just $ morphTx <$> txs

getUncles :: BlockHeaderLike h => SHA -> Redis (Maybe [h])
getUncles sha = getInNamespace Headers sha >>= \case
        Left _           -> return Nothing
        Right Nothing    -> return Nothing
        Right (Just rus) -> let (Right (RedisUncles uncles)) = Serialize.decode rus in
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

putHeader :: Redis ()
putHeader = undefined

putBlock :: Redis ()
putBlock = undefined
