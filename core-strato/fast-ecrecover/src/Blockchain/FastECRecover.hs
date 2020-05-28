module Blockchain.FastECRecover
(
    getPubKeyFromSignature_libsecp256k1
)
where

import qualified Blockchain.ExtendedECDSA          as D
import qualified Blockchain.ExtWord                as E
import qualified Data.Binary                       as A
import qualified Data.ByteString.Lazy              as G
import qualified Data.ByteString.Short             as BSh
import qualified Network.Haskoin.Internals         as C


import qualified Crypto.Secp256k1                  as S
import           Blockchain.Strato.Model.ExtendedWord
import           Data.Maybe


getPubKeyFromSignature_libsecp256k1 :: D.ExtendedSignature -> E.Word256 -> Maybe C.PubKey
getPubKeyFromSignature_libsecp256k1 (D.ExtendedSignature sig yIsOdd) hashWord = do
  -- yes, R and S are flipped in secp256k1-haskell
  let sigR = BSh.toShort $ word256ToBytes $ fromIntegral $ C.getBigWordInteger (C.sigS sig)
      sigS = BSh.toShort $ word256ToBytes $ fromIntegral $ C.getBigWordInteger (C.sigR sig) 
      sigV = if yIsOdd then 1 else 0
      newSig = S.CompactRecSig sigR sigS (fromInteger sigV)
      cRecSig = fromMaybe (error "could not get rec sig") (S.importCompactRecSig newSig)
      mesg = fromMaybe (error "could not get message hash") (S.msg $ word256ToBytes hashWord)
      pk = fromMaybe (error "could not recover public key") (S.recover cRecSig mesg)
      pkBS = S.exportPubKey False pk
  (_, _, result) <- either (const Nothing) (Just) (A.decodeOrFail $ G.fromStrict pkBS)
  return result


