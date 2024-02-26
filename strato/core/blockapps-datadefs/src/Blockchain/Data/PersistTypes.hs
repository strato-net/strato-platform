{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.PersistTypes where

import BlockApps.Solidity.Xabi
import Blockchain.Data.PubKey
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.StateRoot
import Crypto.Types.PubKey.ECC
import Data.Bifunctor (bimap)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Short as BSS
import qualified Data.Text as T
import Data.Text.Encoding
import Database.Persist
import Database.Persist.Sql
import Database.Persist.TH
import qualified LabeledError
import Numeric

derivePersistField "Integer"
-- derivePersistField "Point"
derivePersistFieldJSON "Xabi"

integerCap :: Integer
integerCap = 1000

showHexFixed :: (Integral a) => Int -> a -> String
showHexFixed len val = pad $ showHex val ""
  where
    pad s = if length s >= len then s else pad ('0' : s)

{-
instance PersistField Integer where
  toPersistValue i = PersistText . T.pack $ show i
  fromPersistValue (PersistText s) = Right $ read $ T.unpack s --
  fromPersistValue x = Left $ T.pack $ "PersistField Integer: expected PersistText: " ++ (show x)

instance PersistFieldSql Integer where
  sqlType _ = SqlNumeric integerCap 0
-}

instance PersistField CodeKind where
  toPersistValue = PersistText . T.pack . show
  fromPersistValue (PersistText t) = Right . LabeledError.read "PersistField/CodeKind" . T.unpack $ t
  fromPersistValue x = Left . T.pack $ "PersistField CodeKind: expected int: " ++ show x

instance PersistFieldSql CodeKind where
  sqlType _ = SqlString

instance PersistField HexStorage where
  toPersistValue (HexStorage hs) = PersistText . decodeUtf8 . B16.encode $ hs
  fromPersistValue (PersistText t) = case B16.decode (encodeUtf8 t) of
    Right h -> Right $ HexStorage h
    _ -> Left $ T.pack $ "Invalid hex text: " ++ show t
  fromPersistValue x = Left $ T.pack $ "PersistField HexStorage: expected varchar: " ++ (show x)

instance PersistFieldSql HexStorage where
  sqlType _ = SqlString

instance PersistField Word256 where
  toPersistValue i = PersistText . T.pack $ showHexFixed 64 (fromIntegral i :: Integer)
  fromPersistValue (PersistText s) = Right $ (fromIntegral $ ((fst . head . readHex $ T.unpack s) :: Integer) :: Word256)
  fromPersistValue x = Left $ T.pack $ "PersistField Word256: expected integer: " ++ (show x)

instance PersistFieldSql Word256 where
  sqlType _ = SqlOther $ T.pack "varchar(64)"

instance PersistField Word512 where
  toPersistValue i = PersistText . T.pack $ showHexFixed 128 (fromIntegral i :: Integer)
  fromPersistValue (PersistText s) = Right $ (fromIntegral $ ((fst . head . readHex $ T.unpack s) :: Integer) :: Word512)
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
