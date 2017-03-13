{-# LANGUAGE
    LambdaCase
#-}

module BlockApps.Solidity.Storage where

import Data.Binary (Binary)
import Data.Bool
import Data.ByteString (ByteString)

import qualified Data.Binary as Binary
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Lazy as Lazy.ByteString
import qualified Data.Text.Encoding as Text

import BlockApps.Ethereum
import BlockApps.Solidity.Value

simpleToStorage :: SimpleValue -> ByteString
simpleToStorage =  \case
  ValueBool v -> pad32 $ ByteString.singleton $ bool 0 1 v
  ValueUInt8 v -> pad32 $ encodeStrict v
  ValueUInt16 v -> pad32 $ encodeStrict v
  ValueUInt24 v -> pad32 $ encodeStrict v
  ValueUInt32 v -> pad32 $ encodeStrict v
  ValueUInt40 v -> pad32 $ encodeStrict v
  ValueUInt48 v -> pad32 $ encodeStrict v
  ValueUInt56 v -> pad32 $ encodeStrict v
  ValueUInt64 v -> pad32 $ encodeStrict v
  ValueUInt72 v -> pad32 $ encodeStrict v
  ValueUInt80 v -> pad32 $ encodeStrict v
  ValueUInt88 v -> pad32 $ encodeStrict v
  ValueUInt96 v -> pad32 $ encodeStrict v
  ValueUInt104 v -> pad32 $ encodeStrict v
  ValueUInt112 v -> pad32 $ encodeStrict v
  ValueUInt120 v -> pad32 $ encodeStrict v
  ValueUInt128 v -> pad32 $ encodeStrict v
  ValueUInt136 v -> pad32 $ encodeStrict v
  ValueUInt144 v -> pad32 $ encodeStrict v
  ValueUInt152 v -> pad32 $ encodeStrict v
  ValueUInt160 v -> pad32 $ encodeStrict v
  ValueUInt168 v -> pad32 $ encodeStrict v
  ValueUInt176 v -> pad32 $ encodeStrict v
  ValueUInt184 v -> pad32 $ encodeStrict v
  ValueUInt192 v -> pad32 $ encodeStrict v
  ValueUInt200 v -> pad32 $ encodeStrict v
  ValueUInt208 v -> pad32 $ encodeStrict v
  ValueUInt216 v -> pad32 $ encodeStrict v
  ValueUInt224 v -> pad32 $ encodeStrict v
  ValueUInt232 v -> pad32 $ encodeStrict v
  ValueUInt240 v -> pad32 $ encodeStrict v
  ValueUInt248 v -> pad32 $ encodeStrict v
  ValueUInt256 v -> pad32 $ encodeStrict v
  ValueUInt v -> pad32 $ encodeStrict v
  ValueInt8 v -> pad32Signed v $ encodeStrict v
  ValueInt16 v -> pad32Signed v $ encodeStrict v
  ValueInt24 v -> pad32Signed v $ encodeStrict v
  ValueInt32 v -> pad32Signed v $ encodeStrict v
  ValueInt40 v -> pad32Signed v $ encodeStrict v
  ValueInt48 v -> pad32Signed v $ encodeStrict v
  ValueInt56 v -> pad32Signed v $ encodeStrict v
  ValueInt64 v -> pad32Signed v $ encodeStrict v
  ValueInt72 v -> pad32Signed v $ encodeStrict v
  ValueInt80 v -> pad32Signed v $ encodeStrict v
  ValueInt88 v -> pad32Signed v $ encodeStrict v
  ValueInt96 v -> pad32Signed v $ encodeStrict v
  ValueInt104 v -> pad32Signed v $ encodeStrict v
  ValueInt112 v -> pad32Signed v $ encodeStrict v
  ValueInt120 v -> pad32Signed v $ encodeStrict v
  ValueInt128 v -> pad32Signed v $ encodeStrict v
  ValueInt136 v -> pad32Signed v $ encodeStrict v
  ValueInt144 v -> pad32Signed v $ encodeStrict v
  ValueInt152 v -> pad32Signed v $ encodeStrict v
  ValueInt160 v -> pad32Signed v $ encodeStrict v
  ValueInt168 v -> pad32Signed v $ encodeStrict v
  ValueInt176 v -> pad32Signed v $ encodeStrict v
  ValueInt184 v -> pad32Signed v $ encodeStrict v
  ValueInt192 v -> pad32Signed v $ encodeStrict v
  ValueInt200 v -> pad32Signed v $ encodeStrict v
  ValueInt208 v -> pad32Signed v $ encodeStrict v
  ValueInt216 v -> pad32Signed v $ encodeStrict v
  ValueInt224 v -> pad32Signed v $ encodeStrict v
  ValueInt232 v -> pad32Signed v $ encodeStrict v
  ValueInt240 v -> pad32Signed v $ encodeStrict v
  ValueInt248 v -> pad32Signed v $ encodeStrict v
  ValueInt256 v -> pad32Signed v $ encodeStrict v
  ValueInt v -> encodeStrict v
  ValueAddress v -> simpleToStorage . ValueUInt160 $ unAddress v
  ValueBytes1 v -> pad32 $ ByteString.singleton v
  ValueBytes2 v -> pad32 v
  ValueBytes3 v -> pad32 v
  ValueBytes4 v -> pad32 v
  ValueBytes5 v -> pad32 v
  ValueBytes6 v -> pad32 v
  ValueBytes7 v -> pad32 v
  ValueBytes8 v -> pad32 v
  ValueBytes9 v -> pad32 v
  ValueBytes10 v -> pad32 v
  ValueBytes11 v -> pad32 v
  ValueBytes12 v -> pad32 v
  ValueBytes13 v -> pad32 v
  ValueBytes14 v -> pad32 v
  ValueBytes15 v -> pad32 v
  ValueBytes16 v -> pad32 v
  ValueBytes17 v -> pad32 v
  ValueBytes18 v -> pad32 v
  ValueBytes19 v -> pad32 v
  ValueBytes20 v -> pad32 v
  ValueBytes21 v -> pad32 v
  ValueBytes22 v -> pad32 v
  ValueBytes23 v -> pad32 v
  ValueBytes24 v -> pad32 v
  ValueBytes25 v -> pad32 v
  ValueBytes26 v -> pad32 v
  ValueBytes27 v -> pad32 v
  ValueBytes28 v -> pad32 v
  ValueBytes29 v -> pad32 v
  ValueBytes30 v -> pad32 v
  ValueBytes31 v -> pad32 v
  ValueBytes32 v -> pad32 v
  ValueBytes _v -> undefined
  ValueString v -> simpleToStorage . ValueBytes $ Text.encodeUtf8 v
  where
    encodeStrict :: Binary x => x -> ByteString
    encodeStrict = Lazy.ByteString.toStrict . Binary.encode
    pad32 bs =
      let
        len = ByteString.length bs
        lenMod32 = len `mod` 32
        padding = 32 - lenMod32
      in
        ByteString.replicate padding 0 `ByteString.append` bs
    pad32Signed v bs =
      let
        len = ByteString.length bs
        lenMod32 = len `mod` 32
        padding = 32 - lenMod32
        padChar = bool 0xff 0 (signum v /= (-1))
      in
        ByteString.replicate padding padChar `ByteString.append` bs
