{-# LANGUAGE ForeignFunctionInterface #-}
{-# LANGUAGE NoImplicitPrelude        #-}
module BlockApps.ECRecover.Foreign
where

import           BlockApps.ECRecover.Prelude


-- |
--
-- >int recover_uncompressed(unsigned char *sigR, unsigned char *sigS, int recid,
-- >                         unsigned char *message_hash_bytes, unsigned char *pubkey_bytes)
foreign import ccall unsafe "recover_uncompressed"
  recoverUncompressed :: Ptr CUChar -> Ptr CUChar -> CInt -> Ptr CUChar -> Ptr CUChar -> IO CInt

-- |
--
-- >int recover_compressed(unsigned char *sigR, unsigned char *sigS, int recid,
-- >                       unsigned char *message_hash_bytes, unsigned char *pubkey_bytes)
foreign import ccall unsafe "recover_compressed"
  recoverCompressed :: Ptr CUChar -> Ptr CUChar -> CInt -> Ptr CUChar -> Ptr CUChar -> IO CInt
