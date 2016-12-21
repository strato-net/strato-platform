{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.PersistTypes where

import Database.Persist
import Database.Persist.Sql
import Database.Persist.TH

import Blockchain.Data.Address
--import Blockchain.Data.Transaction
import Blockchain.ExtWord
import Blockchain.SHA
import Blockchain.Database.MerklePatricia

import qualified Data.ByteString.Base16 as B16
import qualified Data.Text as T
import Data.Text.Encoding

import Crypto.Types.PubKey.ECC
import Numeric

derivePersistField "Integer"
derivePersistField "Point"

integerCap :: Integer
integerCap = 1000

showHexFixed :: (Integral a, Show a) => Int -> a -> String
showHexFixed len val = pad $ showHex val ""
    where pad s = if length s >= len then s else pad ('0' : s)

instance PersistField Address where
  toPersistValue (Address x) = PersistText . T.pack $ showHex  (fromIntegral $ x :: Integer) ""
  fromPersistValue (PersistText t) = Right $ (Address wd160)
    where
      ((wd160, _):_) = readHex $ T.unpack $ t ::  [(Word160,String)]
  fromPersistValue x = Left $ T.pack $ "PersistField Address: expected PersistText: " ++ (show x)

instance PersistFieldSql Address where
  sqlType _ = SqlOther $ T.pack "varchar(64)" 

{-
instance PersistField Integer where
  toPersistValue i = PersistText . T.pack $ show i
  fromPersistValue (PersistText s) = Right $ read $ T.unpack s -- 
  fromPersistValue x = Left $ T.pack $ "PersistField Integer: expected PersistText: " ++ (show x)

instance PersistFieldSql Integer where
  sqlType _ = SqlNumeric integerCap 0
-}

instance PersistField Word256 where
  toPersistValue i = PersistText . T.pack $ showHexFixed 64 (fromIntegral i :: Integer) 
  fromPersistValue (PersistText s) = Right $ (fromIntegral $ ((fst . head .  readHex $ T.unpack s) :: Integer) :: Word256)
  fromPersistValue x = Left $ T.pack $ "PersistField Word256: expected integer: " ++ (show x)

instance PersistFieldSql Word256 where
  sqlType _ = SqlOther $ T.pack "varchar(64)" 

instance PersistField Word512 where
  toPersistValue i = PersistText . T.pack $ showHexFixed 128 (fromIntegral i :: Integer) 
  fromPersistValue (PersistText s) = Right $ (fromIntegral $ ((fst . head .  readHex $ T.unpack s) :: Integer) :: Word512)
  fromPersistValue x = Left $ T.pack $ "PersistField Word512: expected integer: " ++ (show x)

instance PersistFieldSql Word512 where
  sqlType _ = SqlOther $ T.pack "varchar(128)" 

instance PersistField StateRoot where
  toPersistValue (StateRoot s) = PersistText . decodeUtf8 . B16.encode $ s
  fromPersistValue (PersistText s) = Right . StateRoot . fst . B16.decode . encodeUtf8 $ s
  fromPersistValue _ = Left $ "StateRoot must be persisted as PersistText"

instance PersistFieldSql StateRoot where
  sqlType _ = SqlOther $ T.pack "varchar(64)" 

{-
instance PersistField Point where
  toPersistValue p@(Point p1 p2) = PersistText . decodeUtf8 . B16.encode $ B.pack $ pointToBytes p
  fromPersistValue (PersistText s) = Right . bytesToPoint . B.unpack . fst . B16.decode . encodeUtf8 $ s
  fromPersistValue _ = Left $ "Point must be persisted as PersistText"


instance PersistFieldSql Point where
  sqlType _ = SqlOther $ T.pack "varchar" 
-}

instance PersistField SHA where
  toPersistValue (SHA i) = PersistText . T.pack $ showHexFixed 64 i
  fromPersistValue (PersistText s) = Right $ SHA $ (fromIntegral $ ((fst . head .  readHex $ T.unpack s) :: Integer) :: Word256)
  fromPersistValue _ = Left $ T.pack $ "PersistField SHA must be persisted as PersistText"

instance PersistFieldSql SHA where
  sqlType _ = SqlOther $ T.pack "varchar(64)" 



