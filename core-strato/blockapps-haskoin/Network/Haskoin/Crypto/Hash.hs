
-- {-# OPTIONS -fno-warn-unused-top-binds #-}

-- | Hashing functions and HMAC DRBG definition
module Network.Haskoin.Crypto.Hash
( hash160
, hash256BS
, hmacDRBGNew
, hmacDRBGRsd
, hmacDRBGGen
, WorkingState
) where

import Crypto.Hash
    ( Digest
    , SHA256
    , RIPEMD160
    , hash
    )
import Crypto.MAC.HMAC (hmac)

import Data.Word (Word16)
import Data.Byteable (toBytes)
import Data.Binary (get)

import qualified Data.ByteString as BS
    ( ByteString
    , null
    , append
    , cons
    , concat
    , take
    , empty
    , length
    , replicate
    )

import Network.Haskoin.Util
import Network.Haskoin.Crypto.BigWord

run256 :: BS.ByteString -> BS.ByteString
run256 = (toBytes :: Digest SHA256 -> BS.ByteString) . hash

run160 :: BS.ByteString -> BS.ByteString
run160 = (toBytes :: Digest RIPEMD160 -> BS.ByteString) . hash

-- | Computes SHA-256 and returns the result as a bytestring.
hash256BS :: BS.ByteString -> BS.ByteString
hash256BS bs = run256 bs

-- | Computes RIPEMD-160.
hash160 :: BS.ByteString -> Word160
hash160 bs = runGet' get (run160 bs)


{- HMAC -}

-- | Computes HMAC over SHA-256 and return the result as a bytestring.
hmac256BS :: BS.ByteString -> BS.ByteString -> BS.ByteString
hmac256BS key msg = hmac hash256BS 64 key msg

{- 10.1.2 HMAC_DRBG with HMAC-SHA256
   http://csrc.nist.gov/publications/nistpubs/800-90A/SP800-90A.pdf
   Constants are based on recommentations in Appendix D section 2 (D.2)
-}

type WorkingState    = (BS.ByteString, BS.ByteString, Word16)
type AdditionalInput = BS.ByteString
type ProvidedData    = BS.ByteString
type EntropyInput    = BS.ByteString
type Nonce           = BS.ByteString
type PersString      = BS.ByteString

-- 10.1.2.2 HMAC DRBG Update FUnction
hmacDRBGUpd :: ProvidedData -> BS.ByteString -> BS.ByteString
            -> (BS.ByteString, BS.ByteString)
hmacDRBGUpd info k0 v0
    | BS.null info = (k1,v1) -- 10.1.2.2.3
    | otherwise    = (k2,v2) -- 10.1.2.2.6
  where
    k1 = hmac256BS k0 $ v0 `BS.append` (0 `BS.cons` info) -- 10.1.2.2.1
    v1 = hmac256BS k1 v0                                  -- 10.1.2.2.2
    k2 = hmac256BS k1 $ v1 `BS.append` (1 `BS.cons` info) -- 10.1.2.2.4
    v2 = hmac256BS k2 v1                                  -- 10.1.2.2.5

-- 10.1.2.3 HMAC DRBG Instantiation
hmacDRBGNew :: EntropyInput -> Nonce -> PersString -> WorkingState
hmacDRBGNew seed nonce info
    | (BS.length seed + BS.length nonce) * 8 < 384  = error $
        "Entropy + nonce input length must be at least 384 bit"
    | (BS.length seed + BS.length nonce) * 8 > 1000 = error $
        "Entropy + nonce input length can not be greater than 1000 bit"
    | BS.length info * 8 > 256  = error $
        "Maximum personalization string length is 256 bit"
    | otherwise                = (k1,v1,1)         -- 10.1.2.3.6
  where
    s        = BS.concat [seed, nonce, info] -- 10.1.2.3.1
    k0       = BS.replicate 32 0             -- 10.1.2.3.2
    v0       = BS.replicate 32 1             -- 10.1.2.3.3
    (k1,v1)  = hmacDRBGUpd s k0 v0           -- 10.1.2.3.4

-- 10.1.2.4 HMAC DRBG Reseeding
hmacDRBGRsd :: WorkingState -> EntropyInput -> AdditionalInput -> WorkingState
hmacDRBGRsd (k,v,_) seed info
    | BS.length seed * 8 < 256 = error $
        "Entropy input length must be at least 256 bit"
    | BS.length seed * 8 > 1000 = error $
        "Entropy input length can not be greater than 1000 bit"
    | otherwise   = (k0,v0,1)             -- 10.1.2.4.4
  where
    s       = seed `BS.append` info -- 10.1.2.4.1
    (k0,v0) = hmacDRBGUpd s k v     -- 10.1.2.4.2

-- 10.1.2.5 HMAC DRBG Generation
hmacDRBGGen :: WorkingState -> Word16 -> AdditionalInput
            -> (WorkingState, Maybe BS.ByteString)
hmacDRBGGen (k0,v0,c0) bytes info
    | bytes * 8 > 7500 = error "Maximum bits per request is 7500"
    | c0 > 10000       = ((k0,v0,c0), Nothing)  -- 10.1.2.5.1
    | otherwise        = ((k2,v3,c1), Just res) -- 10.1.2.5.8
  where
    (k1,v1) | BS.null info = (k0,v0)
            | otherwise    = hmacDRBGUpd info k0 v0   -- 10.1.2.5.2
    (tmp,v2) = go (fromIntegral bytes) k1 v1 BS.empty -- 10.1.2.5.3/4
    res      = BS.take (fromIntegral bytes) tmp       -- 10.1.2.5.5
    (k2,v3)  = hmacDRBGUpd info k1 v2                 -- 10.1.2.5.6
    c1       = c0 + 1                                 -- 10.1.2.5.7
    go l k v acc | BS.length acc >= l = (acc,v)
                 | otherwise = let vn = hmac256BS k v
                                   in go l k vn (acc `BS.append` vn)

