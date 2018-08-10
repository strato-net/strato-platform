module Main where

import qualified Blockchain.ExtendedECDSA  as F
import qualified Blockchain.ExtWord        as K
import qualified Blockchain.FastECRecover  as N
import qualified Blockchain.SHA            as J
import           Criterion.Main
import qualified Data.ByteString           as M
import           Data.Maybe                (fromJust)
import qualified Network.Haskoin.Crypto    as A
import qualified Network.Haskoin.Internals as G

main =
  defaultMain $
  [
    bench "" $ nf (uncurry N.getPubKeyFromSignature_fast) transaction
  ]

prvKey :: A.PrvKey
prvKey =
  fromJust (A.makePrvKey 0xeede3a2ed7d98cfee7ee7f49fede3f5aa6ab0bc9dc9f2bd7198900e3c7105c9c)

pubKey :: A.PubKey
pubKey =
  A.derivePubKey prvKey

transaction :: (F.ExtendedSignature, G.Word256)
transaction =
  (es, hash)
  where
    !es =
      F.ExtendedSignature signature True
      where
        !signature =
          G.Signature sigR sigS
          where
            !sigR =
              53009061921330807819223009173068573399970314146107959232891770474150029121003
            !sigS =
              29809615627007940951178093867324997952009474722137805650637399147083218099518
    !hash =
      35850334881260372387669542451037370183239639056352960888504548051174843619081
