
module Blockchain.P2PUtil (
  theCurve,
  hPubKeyToPubKey,
  ecdsaSign,
  intToBytes,
  sockAddrToIP,
  add
  ) where

import qualified Network.Socket as S
import           Network.Haskoin.Crypto 

import           Data.Bits
import qualified Data.ByteString as B
import           Data.Word

import           Blockchain.ExtendedECDSA

import           Data.Maybe
import           Prelude 

import           Crypto.PubKey.ECC.DH
import           Crypto.Types.PubKey.ECC
import qualified Crypto.Hash.SHA3 as SHA3
import qualified Network.Haskoin.Internals as H

add :: B.ByteString
    -> B.ByteString
    -> B.ByteString
add acc val | B.length acc ==32 && B.length val == 32 = SHA3.hash 256 $ val `B.append` acc
add _ _ = error "add called with ByteString of length not 32"
                                     
theCurve :: Curve
theCurve = getCurveByName SEC_p256k1

hPubKeyToPubKey::H.PubKey->Point
hPubKeyToPubKey pubKey = Point (fromIntegral x) (fromIntegral y)
  where
     x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX hPoint
     y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY hPoint
     hPoint = H.pubKeyPoint pubKey

ecdsaSign::H.PrvKey->Word256->H.SecretT IO ExtendedSignature
ecdsaSign prvKey' theHash = do
    extSignMsg theHash prvKey'    

intToBytes::Integer->[Word8]
intToBytes x = map (fromIntegral . (x `shiftR`)) [256-8, 256-16..0]

sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = show host
sockAddrToIP (S.SockAddrUnix str) = str
sockAddrToIP addr' = takeWhile (\t -> t /= ':') (show addr')


  
