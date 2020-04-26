{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE Arrows                #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TupleSections         #-}

module Strato.Strato23.Database.Queries where

import           BlockApps.Ethereum
import           Control.Arrow
import           Control.Monad                   (void)
import qualified Crypto.Saltine.Class            as Saltine
import qualified Crypto.Saltine.Core.SecretBox   as SecretBox
import           Data.ByteString                 (ByteString)
import qualified Data.ByteString.Char8           as C8
import           Data.Int                        (Int32)
import           Data.Maybe                      (fromMaybe, listToMaybe)
import           Data.Profunctor
import           Data.Profunctor.Product.Default
import           Data.Text                       (Text)
import           Database.PostgreSQL.Simple      (Connection)
import           Opaleye                         hiding (not, null, index)

import           Strato.Strato23.Crypto
import           Strato.Strato23.Database.Tables

import           Blockchain.Strato.Model.Address


countUsers :: Text -> Query (Column PGInt8)
countUsers username = aggregate countStar $ proc () -> do
  (_, name, _, _, _, _, _) <- queryTable usersTable -< ()
  restrict -< name .== constant username


getUserKeyQuery :: Text -> Query (Column PGBytea, Column PGBytea, Column PGBytea, Column PGBytea)
getUserKeyQuery username = proc () -> do
  (_, name, salt, nonce, _, encSecPrvKey, address) <- queryTable usersTable -< ()
  restrict -< name .== constant username
  returnA -< (salt, nonce, encSecPrvKey, address)

getUserByAddress :: Address -> Query (Column PGText)
getUserByAddress qaddr = proc () -> do
  (_, name, _, _, _, _, taddr) <- queryTable usersTable -< ()
  restrict -< taddr .== constant qaddr
  returnA -< name

getUserAddresses :: Maybe Int -> Maybe Int -> Query (Column PGText, Column PGBytea)
getUserAddresses mOffset mLimit = maybe id limit mLimit
                                . maybe id offset mOffset
                                $ proc () -> do
  (_, name, _, _, _, _, addr) <- selectTable usersTable -< ()
  returnA -< (name, addr)

postUserKeyQuery :: Text -> KeyStore -> Connection -> IO Bool
postUserKeyQuery userName KeyStore{..} conn = do
  (userIds :: [Int32]) <- runQuery conn $ proc () -> do
    (userId,name,_,_,_,_,_) <- queryTable usersTable -< ()
    restrict -< name .== constant userName
    returnA -< userId
  case listToMaybe userIds of
    Just _ -> return False
    Nothing -> do
      void $ runInsertMany conn usersTable [
        ( Nothing
        , constant userName
        , constant keystoreSalt
        , constant keystoreAcctNonce
        , constant keystoreAcctEncSecKey
        , constant keystoreAcctEncSecKey
        , constant keystoreAcctAddress
        )]
      return True

getMessageQuery :: Query (Column PGBytea, Column PGBytea, Column PGBytea)
getMessageQuery = proc () -> do
  (id', salt, nonce, enc_msg) <- queryTable messageTable -< ()
  restrict -< id' .== constant (1 :: Int)
  returnA -< (salt, nonce, enc_msg)

postMessageQuery :: ByteString
                 -> SecretBox.Nonce
                 -> ByteString
                 -> Connection
                 -> IO Bool
postMessageQuery salt nonce message conn = do
  (msg :: [(ByteString, SecretBox.Nonce, ByteString)]) <- runQuery conn getMessageQuery
  case msg of
    (_:_) -> return False
    [] -> True <$ runInsertMany conn messageTable [
                    ( Nothing
                    , constant salt
                    , constant nonce
                    , constant message
                    )]

instance QueryRunnerColumnDefault PGBytea Address where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode address") . stringAddress . C8.unpack)
    queryRunnerColumnDefault
instance Default Constant Address (Column PGBytea) where
  def = lmap (C8.pack . formatAddressWithoutColor) def

instance QueryRunnerColumnDefault PGBytea SecretBox.Nonce where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode nonce") . Saltine.decode)
    queryRunnerColumnDefault
instance Default Constant SecretBox.Nonce (Column PGBytea) where
  def = lmap Saltine.encode def
