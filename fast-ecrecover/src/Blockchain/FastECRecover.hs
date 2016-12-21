module Blockchain.FastECRecover
(
  getPubKeyFromSignature_fast
)
where

import qualified Data.Binary as A
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as G
import qualified Network.Haskoin.Internals as C
import qualified Blockchain.ExtendedECDSA as D
import qualified Blockchain.ExtWord as E
import qualified BlockApps.ECRecover.IntegerFormat as F


{-# INLINE getPubKeyFromSignature_fast #-}
getPubKeyFromSignature_fast :: D.ExtendedSignature -> E.Word256 -> Maybe C.PubKey
getPubKeyFromSignature_fast (D.ExtendedSignature sig yIsOdd) hashWord =
  do
    pubKeyBytes <- liftEither (F.recoverUncompressed sigR sigS recId hash)
    (_, _, result) <- liftEither (A.decodeOrFail (G.fromStrict pubKeyBytes))
    return result
  where
    liftEither =
      either (const Nothing) Just
    sigR =
      C.getBigWordInteger (C.sigR sig)
    sigS =
      C.getBigWordInteger (C.sigS sig)
    recId =
      bool 0 1 yIsOdd
    hash =
      C.getBigWordInteger hashWord
