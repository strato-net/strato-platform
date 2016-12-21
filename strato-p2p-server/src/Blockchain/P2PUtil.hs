
module Blockchain.P2PUtil (
  hPubKeyToPubKey,
  ecdsaSign,
  sockAddrToIP
  ) where

import qualified Network.Socket as S
import           Network.Haskoin.Crypto 

import           Blockchain.ExtendedECDSA

import           Data.Maybe
import           Prelude 

import           Crypto.Types.PubKey.ECC
import qualified Network.Haskoin.Internals as H

hPubKeyToPubKey::H.PubKey->Point
hPubKeyToPubKey pubKey = Point (fromIntegral x) (fromIntegral y)
  where
     x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX hPoint
     y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY hPoint
     hPoint = H.pubKeyPoint pubKey

ecdsaSign::H.PrvKey->Word256->H.SecretT IO ExtendedSignature
ecdsaSign prvKey' theHash = do
    extSignMsg theHash prvKey'    

sockAddrToIP :: S.SockAddr -> String
sockAddrToIP (S.SockAddrInet6 _ _ host _) = show host
sockAddrToIP (S.SockAddrUnix str) = str
sockAddrToIP addr' = takeWhile (\t -> t /= ':') (show addr')


  
