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
import qualified Data.Text                       as T
import           Database.PostgreSQL.Simple      (Connection)
import           Database.PostgreSQL.Simple.FromField hiding (name)
import           Opaleye                         hiding (not, null, index, FromField)

import           Blockchain.Strato.Model.Address

import           Strato.Strato23.Crypto
import           Strato.Strato23.Database.Tables



countUsers :: T.Text -> Query (Column PGInt8)
countUsers username = aggregate countStar $ proc () -> do
  (_, name, _, _, _, _, _, _) <- selectTable usersTable -< ()
  restrict -< name .== toFields username

countUsers' :: T.Text -> T.Text -> Query (Column PGInt8)
countUsers' username oauthRealm  = aggregate countStar $ proc () -> do
  (_, name, _, _, _, _, _, oauth) <- selectTable usersTable -< ()
  restrict -< (name .== toFields username  .&& oauth .== toFields oauthRealm ) 


getUserKeyQuery :: T.Text -> Query (Column PGBytea, Column PGBytea, Column PGBytea, Column PGBytea)
getUserKeyQuery username = proc () -> do
  (_, name, salt, nonce, _, encSecPrvKey, address, _) <- selectTable usersTable -< ()
  restrict -< name .== toFields username
  returnA -< (salt, nonce, encSecPrvKey, address)

getUserKeyQuery' :: T.Text -> T.Text -> Query (Column PGBytea, Column PGBytea, Column PGBytea, Column PGBytea)
getUserKeyQuery' username oauthRealm = proc () -> do
  (_, name, salt, nonce, _, encSecPrvKey, address, oauth) <- selectTable usersTable -< ()
  restrict -< (name .== toFields username  .&& oauth .== toFields oauthRealm ) 
  returnA -< (salt, nonce, encSecPrvKey, address)

getUserByAddress :: Address -> Query (Column PGText)
getUserByAddress qaddr = proc () -> do
  (_, name, _, _, _, _, taddr, _) <- selectTable usersTable -< ()
  restrict -< taddr .== toFields qaddr
  returnA -< name

getUserByAddress' :: Address -> Query (Column PGText, Column PGText)
getUserByAddress' qaddr = proc () -> do
  (_, name, _, _, _, _, taddr, oauth) <- selectTable usersTable -< ()
  restrict -< taddr .== toFields qaddr
  returnA -< (name, oauth)

getUserAddresses :: Maybe Int -> Maybe Int -> Query (Column PGText, Column PGBytea)
getUserAddresses mOffset mLimit = maybe id limit mLimit
                                . maybe id offset mOffset
                                $ proc () -> do
  (_, name, _, _, _, _, addr, _) <- selectTable usersTable -< ()
  returnA -< (name, addr)

postUserKeyQuery :: T.Text -> KeyStore -> Connection -> IO Bool
postUserKeyQuery userName KeyStore{..} conn = do
  (userIds :: [Int32]) <- runSelect conn $ proc () -> do
    (userId, name, _, _,_,_,_,_) <- selectTable usersTable -< ()
    restrict -< name .== toFields userName
    returnA -< userId
  case listToMaybe userIds of
    Just _ -> return False
    Nothing -> do
      void $ runInsert_ conn Insert {
        iTable=usersTable,
        iRows=[
            ( Nothing
            , toFields userName
            , toFields keystoreSalt
            , toFields keystoreAcctNonce
            , toFields keystoreAcctEncSecKey
            , toFields keystoreAcctEncSecKey
            , toFields keystoreAcctAddress
            , toFields userName
            )],
        iReturning=rCount,
        iOnConflict=Nothing
        }
      return True

postUserKeyQuery' :: T.Text -> T.Text -> KeyStore -> Connection -> IO Bool
postUserKeyQuery' userName oauthProvider KeyStore{..} conn = do
  (userIds :: [Int32]) <- runSelect conn $ proc () -> do
    (userId, name, _, _,_,_,_, oauth) <- selectTable usersTable -< ()
    restrict -< (name .== toFields userName .&& oauth .== toFields oauthProvider ) 
    returnA -< userId
  case listToMaybe userIds of
    Just _ -> return False
    Nothing -> do
      void $ runInsert_ conn Insert {
        iTable=usersTable,
        iRows=[
            ( Nothing
            , toFields userName
            , toFields keystoreSalt
            , toFields keystoreAcctNonce
            , toFields keystoreAcctEncSecKey
            , toFields keystoreAcctEncSecKey
            , toFields keystoreAcctAddress
            , toFields oauthProvider
            )],
        iReturning=rCount,
        iOnConflict=Nothing
        }
      return True

getMessageQuery :: Query (Column PGBytea, Column PGBytea, Column PGBytea)
getMessageQuery = proc () -> do
  (id', salt, nonce, enc_msg) <- selectTable messageTable -< ()
  restrict -< id' .== toFields (1 :: Int)
  returnA -< (salt, nonce, enc_msg)

postMessageQuery :: ByteString
                 -> SecretBox.Nonce
                 -> ByteString
                 -> Connection
                 -> IO Bool
postMessageQuery salt nonce message conn = do
  (mesg :: [(ByteString, SecretBox.Nonce, ByteString)]) <- runSelect conn getMessageQuery
  case mesg of
    (_:_) -> return False
    [] -> True <$ runInsert_ conn Insert {
      iTable=messageTable,
      iRows=[
          ( Nothing
          , toFields salt
          , toFields nonce
          , toFields message
          )],
      iReturning=rCount,
      iOnConflict=Nothing
      }

instance DefaultFromField PGBytea Address where
  defaultFromField = fromPGSFromField

instance FromField Address where
  fromField f mdata = do
    theByteString <- fromField f mdata
    return $ fromMaybe (error $ "could not decode address: " ++ show theByteString) $ stringAddress $ C8.unpack theByteString

instance Default ToFields Address (Column PGBytea) where
  def = lmap (C8.pack . formatAddressWithoutColor) def

instance DefaultFromField PGBytea SecretBox.Nonce where
  defaultFromField = fromPGSFromField

instance FromField SecretBox.Nonce where
  fromField f theData = do
    theByteString <- fromField f theData
    return $ fromMaybe (error $ "Saltine.decode failed for: " ++ show theByteString) $ Saltine.decode theByteString

instance Default ToFields SecretBox.Nonce (Column PGBytea) where
  def = lmap Saltine.encode def

