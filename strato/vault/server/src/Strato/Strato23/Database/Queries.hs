{-# LANGUAGE Arrows #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.Database.Queries where

import Blockchain.Strato.Model.Address
import Control.Arrow
import Control.Monad (void)
import qualified Crypto.Saltine.Class as Saltine
import qualified Crypto.Saltine.Core.SecretBox as SecretBox
import Data.ByteString (ByteString)
import qualified Data.ByteString.Char8 as C8
import Data.Int (Int32)
import Data.Maybe (fromMaybe, listToMaybe)
import Data.Profunctor
import Data.Profunctor.Product.Default
import qualified Data.Text as T
import Database.PostgreSQL.Simple (Connection)
import Database.PostgreSQL.Simple.FromField hiding (name)
import Opaleye hiding (FromField, index, not, null)
import qualified Opaleye as O
import Opaleye.Internal.PGTypesExternal
import Opaleye.Internal.QueryArr
import Strato.Strato23.Crypto
import Strato.Strato23.Database.Tables

countUsers :: T.Text -> Query (O.Field PGInt8)
countUsers username = aggregate countStar $ proc () -> do
  (_, name, _, _, _, _, _) <- selectTable usersTable -< ()
  restrict -< name .== toFields username

countUsers' :: T.Text -> T.Text -> Query (O.Field PGInt8)
countUsers' username oauthRealm = aggregate countStar $ proc () -> do
  (_, name, oauth, _, _, _, _) <- selectTable usersTable -< ()
  restrict -< (name .== toFields username .&& oauth .== toFields oauthRealm)

getUserKeyQuery :: T.Text -> Query (O.Field PGBytea, O.Field PGBytea, O.Field PGBytea, O.Field PGBytea)
getUserKeyQuery username = proc () -> do
  (_, name, _, salt, nonce, encSecPrvKey, address) <- selectTable usersTable -< ()
  restrict -< name .== toFields username
  returnA -< (salt, nonce, encSecPrvKey, address)

getUserKeyQuery' :: T.Text -> T.Text -> Query (O.Field PGBytea, O.Field PGBytea, O.Field PGBytea, O.Field PGBytea)
getUserKeyQuery' username oauthRealm = proc () -> do
  (_, name, oauth, salt, nonce, encSecPrvKey, address) <- selectTable usersTable -< ()
  restrict -< (name .== toFields username .&& oauth .== toFields oauthRealm)
  returnA -< (salt, nonce, encSecPrvKey, address)

getUserByAddress :: Address -> Query (O.Field PGText)
getUserByAddress qaddr = proc () -> do
  (_, name, _, _, _, _, taddr) <- selectTable usersTable -< ()
  restrict -< taddr .== toFields qaddr
  returnA -< name

getUserByAddress' :: Address -> Query (O.Field PGText, O.Field PGText)
getUserByAddress' qaddr = proc () -> do
  (_, name, oauth, _, _, _, taddr) <- selectTable usersTable -< ()
  restrict -< taddr .== toFields qaddr
  returnA -< (name, oauth)

getUserAddresses :: Maybe Int -> Maybe Int -> Query (O.Field PGText, O.Field PGBytea)
getUserAddresses mOffset mLimit = maybe id limit mLimit
  . maybe id offset mOffset
  $ proc () -> do
    (_, name, _, _, _, _, addr) <- selectTable usersTable -< ()
    returnA -< (name, addr)

postUserKeyQuery :: T.Text -> KeyStore -> Connection -> IO Bool
postUserKeyQuery userName KeyStore {..} conn = do
  (userIds :: [Int32]) <- runSelect conn $ proc () -> do
    (userId, name, _, _, _, _, _) <- selectTable usersTable -< ()
    restrict -< name .== toFields userName
    returnA -< userId
  case listToMaybe userIds of
    Just _ -> return False
    Nothing -> do
      void $
        runInsert
          conn
          Insert
            { iTable = usersTable,
              iRows =
                [ ( Nothing,
                    toFields userName,
                    toFields userName,
                    toFields keystoreSalt,
                    toFields keystoreAcctNonce,
                    toFields keystoreAcctEncSecKey,
                    toFields keystoreAcctAddress
                  )
                ],
              iReturning = rCount,
              iOnConflict = Nothing
            }
      return True

postUserKeyQuery' :: T.Text -> T.Text -> KeyStore -> Connection -> IO Bool
postUserKeyQuery' userName oauthProvider KeyStore {..} conn = do
  (userIds :: [Int32]) <- runSelect conn $ proc () -> do
    (userId, name, oauth, _, _, _, _) <- selectTable usersTable -< ()
    restrict -< (name .== toFields userName .&& oauth .== toFields oauthProvider)
    returnA -< userId
  case listToMaybe userIds of
    Just _ -> return False
    Nothing -> do
      void $
        runInsert
          conn
          Insert
            { iTable = usersTable,
              iRows =
                [ ( Nothing,
                    toFields userName,
                    toFields oauthProvider,
                    toFields keystoreSalt,
                    toFields keystoreAcctNonce,
                    toFields keystoreAcctEncSecKey,
                    toFields keystoreAcctAddress
                  )
                ],
              iReturning = rCount,
              iOnConflict = Nothing
            }
      return True

getMessageQuery :: Query (O.Field PGBytea, O.Field PGBytea, O.Field PGBytea)
getMessageQuery = proc () -> do
  (id', salt, nonce, enc_msg) <- selectTable messageTable -< ()
  restrict -< id' .== toFields (1 :: Int)
  returnA -< (salt, nonce, enc_msg)

-- Used for the mercata migration. --Can be deleted
getMessageQueryAll :: Query (O.Field PGBytea, O.Field PGBytea, O.Field PGBytea)
getMessageQueryAll = proc () -> do
  (_, salt, nonce, enc_msg) <- selectTable messageTable -< ()
  returnA -< (salt, nonce, enc_msg)

postMessageQuery ::
  ByteString ->
  SecretBox.Nonce ->
  ByteString ->
  Connection ->
  IO Bool
postMessageQuery salt nonce message conn = do
  (mesg :: [(ByteString, SecretBox.Nonce, ByteString)]) <- runSelect conn getMessageQuery
  case mesg of
    (_ : _) -> return False
    [] ->
      True
        <$ runInsert
          conn
          Insert
            { iTable = messageTable,
              iRows =
                [ ( Nothing,
                    toFields salt,
                    toFields nonce,
                    toFields message
                  )
                ],
              iReturning = rCount,
              iOnConflict = Nothing
            }

instance DefaultFromField PGBytea Address where
  defaultFromField = fromPGSFromField

instance FromField Address where
  fromField f mdata = do
    !theByteString <- fromField f mdata
    let !returnVal = fromMaybe (error $ "could not decode address: " ++ show theByteString) $ stringAddress $ C8.unpack theByteString
    return returnVal

instance Default ToFields Address (O.Field PGBytea) where
  def = lmap (C8.pack . formatAddressWithoutColor) def

instance DefaultFromField PGBytea SecretBox.Nonce where
  defaultFromField = fromPGSFromField

instance FromField SecretBox.Nonce where
  fromField f theData = do
    !theByteString <- fromField f theData
    let !returnVal = fromMaybe (error $ "Saltine.decode failed for: " ++ show theByteString) $ Saltine.decode theByteString
    return returnVal

instance Default ToFields SecretBox.Nonce (O.Field PGBytea) where
  def = lmap Saltine.encode def
