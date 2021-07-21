{-# LANGUAGE DeriveDataTypeable #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
--{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
-- | ECDSA Signatures
module Network.Haskoin.Crypto.ECDSA
( SecretT
, Signature(..)
, withSource
, devURandom
--, devRandom
--, signMsg
--, detSignMsg
--, unsafeSignMsg
, verifySig
, genPrvKey
--, isCanonicalHalfOrder
) where

import System.IO

import Control.DeepSeq (NFData, rnf)
import Control.Monad (liftM, liftM2, unless)
import Control.Monad.Trans (lift)
import qualified Control.Monad.State as S
    ( StateT
    , evalStateT
    , get, put
    )

import Data.Maybe (fromJust)
import Data.Binary (Binary, get, put)
import Data.Binary.Put (putWord8, putByteString)
import Data.Binary.Get (getWord8)
import Data.ByteString.Arbitrary (slowRandBs)
import Data.Data

import qualified Data.ByteString as BS
    ( ByteString
    , length
    , hGet
    )

import Test.QuickCheck (Arbitrary(..))

import Network.Haskoin.Util
import Network.Haskoin.Constants
import Network.Haskoin.Crypto.Hash
import Network.Haskoin.Crypto.Keys
import Network.Haskoin.Crypto.Point
import Network.Haskoin.Crypto.BigWord

-- | Internal state of the 'SecretT' monad
type SecretState m = (WorkingState, (Int -> m BS.ByteString))

-- | StateT monad stack tracking the internal state of HMAC DRBG
-- pseudo random number generator using SHA-256. The 'SecretT' monad is
-- run with the 'withSource' function by providing it a source of entropy.
type SecretT m = S.StateT (SecretState m) m

-- | Run a 'SecretT' monad by providing it a source of entropy. You can
-- use 'devURandom', 'devRandom' or provide your own entropy source function.
withSource :: Monad m => (Int -> m BS.ByteString) -> SecretT m a -> m a
withSource f m = do
    seed  <- f 32 -- Read 256 bits from the random source
    nonce <- f 16 -- Read 128 bits from the random source
    let ws = hmacDRBGNew seed nonce (stringToBS haskoinUserAgent)
    S.evalStateT m (ws,f)

-- | \/dev\/urandom entropy source. This is only available on machines
-- supporting it. This function is meant to be used together with 'withSource'.
devURandom :: Int -> IO BS.ByteString
devURandom i = withBinaryFile "/dev/urandom" ReadMode $ flip BS.hGet i

-- | Generate a new random 'FieldN' value from the 'SecretT' monad. This will
-- invoke the HMAC DRBG routine. Of the internal entropy pool of the HMAC DRBG
-- was stretched too much, this function will reseed it.
nextSecret :: Monad m => SecretT m FieldN
nextSecret = do
    (ws,f) <- S.get
    let (ws',randM) = hmacDRBGGen ws 32 (stringToBS haskoinUserAgent)
    case randM of
        (Just rand) -> do
            S.put (ws',f)
            let randI = bsToInteger rand
            if isIntegerValidKey randI
                then return $ fromInteger randI
                else nextSecret
        Nothing -> do
            seed <- lift $ f 32 -- Read 256 bits to re-seed the PRNG
            let ws0 = hmacDRBGRsd ws' seed (stringToBS haskoinUserAgent)
            S.put (ws0,f)
            nextSecret

-- | Produce a new 'PrvKey' randomly from the 'SecretT' monad.
genPrvKey :: Monad m => SecretT m PrvKey
genPrvKey = liftM (fromJust . makePrvKey . toInteger) nextSecret

instance Arbitrary PrvKey where
  arbitrary = withSource slowRandBs genPrvKey

-- | Data type representing an ECDSA signature.
data Signature =
    Signature { sigR :: !FieldN
              , sigS :: !FieldN
              }
    deriving (Read, Show, Eq, Data)

instance NFData Signature where
    rnf (Signature r s) = rnf r `seq` rnf s

instance Arbitrary Signature where
  arbitrary = liftM2 Signature arbitrary arbitrary

-- Section 4.1.4 http://www.secg.org/download/aid-780/sec1-v2.pdf
-- | Verify an ECDSA signature
verifySig :: Word256 -> Signature -> PubKey -> Bool
-- 4.1.4.1 (r and s can not be zero)
verifySig _ (Signature 0 _) _ = False
verifySig _ (Signature _ 0) _ = False
verifySig h (Signature r s) q = case getAffine p of
    Nothing      -> False
    -- 4.1.4.7 / 4.1.4.8
    (Just (x,_)) -> (fromIntegral x :: FieldN) == r
  where
    -- 4.1.4.2 / 4.1.4.3
    e  = (fromIntegral h :: FieldN)
    -- 4.1.4.4
    s' = inverseN s
    u1 = e*s'
    u2 = r*s'
    -- 4.1.4.5 (u1*G + u2*q)
    p  = shamirsTrick u1 curveG u2 (pubKeyPoint q)

instance Binary Signature where
    get = do
        t <- getWord8
        -- 0x30 is DER sequence type
        unless (t == 0x30) (fail $
            "Bad DER identifier byte " ++ (show t) ++ ". Expecting 0x30")
        l <- getWord8
        -- Length = (33 + 1 identifier byte + 1 length byte) * 2
        isolate (fromIntegral l) $ do
            Signature <$> get <*> get

    put (Signature 0 _) = error "0 is an invalid r value in a Signature"
    put (Signature _ 0) = error "0 is an invalid s value in a Signature"
    put (Signature r s) = do
        putWord8 0x30
        let c = runPut' $ put r >> put s
        putWord8 (fromIntegral $ BS.length c)
        putByteString c


