{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE OverloadedStrings #-}
module BlockApps.ECRecover.BytesFormat
where

import qualified BlockApps.ECRecover.Foreign  as B
import qualified BlockApps.ECRecover.Pointers as A
import           BlockApps.ECRecover.Prelude


{-# INLINABLE recoverUncompressed #-}
recoverUncompressed :: ByteString -> ByteString -> Int32 -> ByteString -> Either Text ByteString
recoverUncompressed sigRBytes sigSBytes recIdInt hashBytes =
  unsafeDupablePerformIO $
  A.withModifyingPtrOfBytes sigRBytes $ \sigRPtr ->
  A.withModifyingPtrOfBytes sigSBytes $ \sigSPtr ->
  A.withModifyingPtrOfBytes hashBytes $ \hashPtr ->
  A.createBytesAndMap 65 $ \pubKeyPtr ->
  fmap interpretStatus $
  B.recoverUncompressed (castPtr sigRPtr) (castPtr sigSPtr) (CInt recIdInt) (castPtr hashPtr) (castPtr pubKeyPtr)
  where
    interpretStatus =
      \case
        0 -> Right
        1 -> const (Left "\"secp256k1_ecdsa_sig_recover\" failure")
        2 -> const (Left "\"secp256k1_eckey_pubkey_serialize\" failure: size is not 65")
        _ -> const (Left "Unknown error")

{-# INLINABLE recoverCompressed #-}
recoverCompressed :: ByteString -> ByteString -> Int32 -> ByteString -> Either Text ByteString
recoverCompressed sigRBytes sigSBytes recIdInt hashBytes =
  unsafeDupablePerformIO $
  A.withModifyingPtrOfBytes sigRBytes $ \sigRPtr ->
  A.withModifyingPtrOfBytes sigSBytes $ \sigSPtr ->
  A.withModifyingPtrOfBytes hashBytes $ \hashPtr ->
  A.createBytesAndMap 33 $ \pubKeyPtr ->
  fmap interpretStatus $
  B.recoverCompressed (castPtr sigRPtr) (castPtr sigSPtr) (CInt recIdInt) (castPtr hashPtr) (castPtr pubKeyPtr)
  where
    interpretStatus =
      \case
        0 -> Right
        1 -> const (Left "\"secp256k1_ecdsa_sig_recover\" failure")
        2 -> const (Left "\"secp256k1_eckey_pubkey_serialize\" failure: size is not 65")
        _ -> const (Left "Unknown error")
