
module Blockchain.P2PUtil (
  theCurve,
  hPubKeyToPubKey,
  ecdsaSign,
  intToBytes,
  sockAddrToIP,
  add,
  DiscoverException(..)
  ) where

import           Control.Error                (note)
import           Control.Exception.Base       (Exception)

import           Data.Bits                    (shiftR)
import qualified Data.ByteString           as B
import           Data.Word                    (Word8)
import           Data.Typeable                (Typeable)

import           Blockchain.ExtendedECDSA     (ExtendedSignature,
                                               extSignMsg)


import           Crypto.PubKey.ECC.DH
import           Crypto.Types.PubKey.ECC      (getCurveByName,
                                              CurveName(SEC_p256k1),
                                              Point(..))
import qualified Crypto.Hash.SHA3          as SHA3
import qualified Network.Haskoin.Internals as H
import qualified Network.Socket            as S
import           Network.Haskoin.Crypto       (Word256)


data DiscoverException = AffineException
                       | ByteStringLengthException String
                       | IPFormatException String
                       | NoPublicKeyException
                       | MalformedUDPException String
                         deriving (Show, Typeable)

instance Exception DiscoverException

add :: B.ByteString
    -> B.ByteString
    -> Either DiscoverException B.ByteString
add acc val
  | B.length acc == 32 && B.length val == 32 = Right $ SHA3.hash 256 $ val `B.append` acc
  | otherwise = Left $ ByteStringLengthException $ "Expected length 32 summands, got " ++
      show (B.length acc, B.length val)

theCurve :: Curve
theCurve = getCurveByName SEC_p256k1

--I need to use two definitions of PubKey (internally they represent the same thing)
--The one in the Haskoin package allows me to recover signatures.
--The one in the crypto packages let me do AES encryption.
--At some point I have to convert from one PubKey to the other, this function
--lets me to that.
hPubKeyToPubKey :: H.PubKey -> Either DiscoverException Point
hPubKeyToPubKey pubKey = do
  let hPoint = H.pubKeyPoint pubKey
  x <- note AffineException $ H.getX hPoint
  y <- note AffineException $ H.getY hPoint
  return $ Point (fromIntegral x) (fromIntegral y)

ecdsaSign :: H.PrvKey -> Word256 -> H.SecretT IO ExtendedSignature
ecdsaSign prvKey' theHash = extSignMsg theHash prvKey'

intToBytes :: Integer -> [Word8]
intToBytes x = map (fromIntegral . (x `shiftR`)) [256-8, 256-16..0]

sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = show host
sockAddrToIP (S.SockAddrUnix str) = str
sockAddrToIP addr' = takeWhile (/= ':') (show addr')
