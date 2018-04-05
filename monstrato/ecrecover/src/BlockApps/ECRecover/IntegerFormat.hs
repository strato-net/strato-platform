{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE OverloadedStrings #-}
-- |
-- Use the Integer encoding of bytes with a presumption that those store 256 bits.
--
-- This function is mainly created for compatibility with the bizarre encoding of Haskoin.
module BlockApps.ECRecover.IntegerFormat
where

import qualified BlockApps.ECRecover.Foreign  as B
import qualified BlockApps.ECRecover.Pointers as A
import           BlockApps.ECRecover.Prelude


{-# INLINABLE recoverUncompressed #-}
recoverUncompressed :: Integer -> Integer -> Int32 -> Integer -> Either Text ByteString
recoverUncompressed sigR sigS recId hash =
  unsafeDupablePerformIO $
  allocaBytes 32 $ \sigRPtr ->
  allocaBytes 32 $ \sigSPtr ->
  allocaBytes 32 $ \hashPtr ->
  A.createBytesAndMap 65 $ \pubKeyPtr ->
  do
    A.pokeInteger sigRPtr 32 sigR
    A.pokeInteger sigSPtr 32 sigS
    A.pokeInteger hashPtr 32 hash
    status <- B.recoverUncompressed (castPtr sigRPtr) (castPtr sigSPtr) (CInt recId) (castPtr hashPtr) (castPtr pubKeyPtr)
    case status of
      0 -> return Right
      1 -> return (const (Left "\"secp256k1_ecdsa_sig_recover\" failure"))
      2 -> return (const (Left "\"secp256k1_eckey_pubkey_serialize\" failure: size is not 65"))
      _ -> return (const (Left "Unknown error"))

{-# INLINABLE recoverCompressed #-}
recoverCompressed :: Integer -> Integer -> Int32 -> Integer -> Either Text ByteString
recoverCompressed sigR sigS recId hash =
  unsafeDupablePerformIO $
  allocaBytes 32 $ \sigRPtr ->
  allocaBytes 32 $ \sigSPtr ->
  allocaBytes 32 $ \hashPtr ->
  A.createBytesAndMap 33 $ \pubKeyPtr ->
  do
    A.pokeInteger sigRPtr 32 sigR
    A.pokeInteger sigSPtr 32 sigS
    A.pokeInteger hashPtr 32 hash
    status <- B.recoverCompressed (castPtr sigRPtr) (castPtr sigSPtr) (CInt recId) (castPtr hashPtr) (castPtr pubKeyPtr)
    case status of
      0 -> return Right
      1 -> return (const (Left "\"secp256k1_ecdsa_sig_recover\" failure"))
      2 -> return (const (Left "\"secp256k1_eckey_pubkey_serialize\" failure: size is not 65"))
      _ -> return (const (Left "Unknown error"))
