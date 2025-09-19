{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.PersistTypes where

import BlockApps.Solidity.Xabi
import Blockchain.Data.PubKey
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.StateRoot
import Blockchain.Strato.Model.Validator
import Crypto.Types.PubKey.ECC
import Data.Bifunctor (bimap)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Short as BSS
import Data.Ratio
import qualified Data.Text as T
import Data.Text.Encoding
import Data.Word (Word32)
import Database.Persist
import Database.Persist.Sql
import Database.Persist.TH
import qualified LabeledError
import Numeric
import Text.Read (readMaybe)

-- derivePersistField "Point"
derivePersistFieldJSON "Xabi"

integerCap :: Word32
integerCap = 1000

showHexFixed :: (Integral a) => Int -> a -> String
showHexFixed len val = pad $ showHex val ""
  where
    pad s = if length s >= len then s else pad ('0' : s)

instance PersistFieldSql Integer where
  sqlType _ = SqlString

instance PersistField Integer where
  toPersistValue = PersistText . T.pack . show
  fromPersistValue (PersistRational r) = case denominator r of
    1 -> Right $ fromIntegral $ numerator r
    _ -> Left $ "Invalid Integer: " <> T.pack (show r)
  fromPersistValue v = case fromPersistValue v of
    Left e -> Left e
    Right t ->
      let s = T.unpack t
       in case readMaybe s of
            Just i -> Right i
            Nothing -> case readMaybe s :: Maybe Double of
              Just d -> Right $ round d
              Nothing -> Left $ "Invalid Integer: " <> t

instance PersistField Word256 where
  toPersistValue i = PersistText . T.pack $ showHexFixed 64 (fromIntegral i :: Integer)
  fromPersistValue (PersistText s) = case readHex $ T.unpack s of
    [] -> Left $ "PersistField Word256: Could not read hex from string " <> s
    (x:_) -> Right $ (fromIntegral $ ((fst x) :: Integer) :: Word256)
  fromPersistValue x = Left $ T.pack $ "PersistField Word256: expected integer: " ++ (show x)

instance PersistFieldSql Word256 where
  sqlType _ = SqlOther $ T.pack "varchar(64)"

instance PersistField Word512 where
  toPersistValue i = PersistText . T.pack $ showHexFixed 128 (fromIntegral i :: Integer)
  fromPersistValue (PersistText s) = case readHex $ T.unpack s of
    [] -> Left $ "PersistField Word512: Could not read hex from string " <> s
    (x:_) -> Right $ (fromIntegral $ ((fst x) :: Integer) :: Word512)
  fromPersistValue x = Left $ T.pack $ "PersistField Word512: expected integer: " ++ (show x)

instance PersistFieldSql Word512 where
  sqlType _ = SqlOther $ T.pack "varchar(128)"

instance PersistField StateRoot where
  toPersistValue (StateRoot s) = PersistText . decodeUtf8 . B16.encode $ s
  fromPersistValue (PersistText s) = Right . StateRoot . LabeledError.b16Decode "PersistField<StateRoot>" . encodeUtf8 $ s
  fromPersistValue _ = Left $ "StateRoot must be persisted as PersistText"

instance PersistFieldSql StateRoot where
  sqlType _ = SqlOther $ T.pack "varchar(64)"

instance PersistField Point where
  toPersistValue p = PersistText . decodeUtf8 . B16.encode $ B.singleton 0x04 `B.append` pointToBytes p
  fromPersistValue (PersistText s) = bimap T.pack (bytesToPoint . B.tail) . B16.decode . encodeUtf8 $ s
  fromPersistValue _ = Left $ "Point must be persisted as PersistText"

instance PersistFieldSql Point where
  sqlType _ = SqlOther $ T.pack "varchar"

instance PersistField BSS.ShortByteString where
  toPersistValue = toPersistValue . BSS.fromShort
  fromPersistValue = fmap BSS.toShort . fromPersistValue

instance PersistFieldSql BSS.ShortByteString where
  sqlType _ = SqlBlob

instance PersistField Validator where
  toPersistValue (Validator v) = toPersistValue v
  fromPersistValue v = fmap Validator $ fromPersistValue v

instance PersistFieldSql Validator where
  sqlType _ = SqlOther "text"
