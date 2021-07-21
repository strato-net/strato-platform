{-# OPTIONS_GHC -fno-cse -fno-full-laziness #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}

{-|
  Network specific constants
-}
module Network.Haskoin.Constants
( -- ** Data
--  Network(..)
  -- ** Functions
--   addrPrefix
-- , scriptPrefix
-- , secretPrefix
-- , extPubKeyPrefix
-- , extSecretPrefix
-- , networkMagic
-- , maxBlockSize
   haskoinUserAgent
) where

import Data.Bits (shiftR)
import Data.IORef (IORef, newIORef, readIORef)
import Data.Word (Word8, Word32, Word64)
import Network.Haskoin.Crypto.BigWord
import Network.Haskoin.Block.Types
import System.IO.Unsafe (unsafePerformIO)

data Network = Network
    { getNetworkName                :: !String
    , getAddrPrefix                 :: !Word8
    , getScriptPrefix               :: !Word8
    , getSecretPrefix               :: !Word8
    , getExtPubKeyPrefix            :: !Word32
    , getExtSecretPrefix            :: !Word32
    , getNetworkMagic               :: !Word32
    , getGenesisHeader              :: !BlockHeader
    , getMaxBlockSize               :: !Int
    , getMaxSatoshi                 :: !Word64
    , getHaskoinUserAgent           :: !String
    , getDefaultPort                :: !Int
    , getAllowMinDifficultyBlocks   :: !Bool
    , getPowLimit                   :: !Integer
    , getTargetTimespan             :: !Word32
    , getTargetSpacing              :: !Word32
    , getCheckpoints                :: ![(Int, BlockHash)]
    } deriving (Eq, Show, Read)

{-# NOINLINE networkRef #-}
-- | Use this if you want to change constants to something other than Testnet3.
networkRef :: IORef Network
networkRef = unsafePerformIO $ newIORef prodnet

{-# NOINLINE getNetwork #-}
-- | Read current network constants record
getNetwork :: Network
getNetwork = unsafePerformIO $ readIORef networkRef

-- | User agent string
haskoinUserAgent :: String
haskoinUserAgent = getHaskoinUserAgent getNetwork

prodnet :: Network
prodnet = Network
    { getNetworkName = "prodnet"
    , getAddrPrefix = 0
    , getScriptPrefix = 5
    , getSecretPrefix = 128
    , getExtPubKeyPrefix = 0x0488b21e
    , getExtSecretPrefix = 0x0488ade4
    , getNetworkMagic = 0xf9beb4d9
    , getGenesisHeader = BlockHeader
        -- Hash 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f
        { blockVersion   = 0x01
        , prevBlock      = 0x00
        , merkleRoot     =
            0x3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a
        , blockTimestamp = 1231006505
        , blockBits      = 486604799
        , bhNonce        = 2083236893
        }
    , getMaxBlockSize = 1000000
    , getMaxSatoshi = 2100000000000000
    , getHaskoinUserAgent = "/haskoin:0.2.0/"
    , getDefaultPort = 8333
    , getAllowMinDifficultyBlocks = False
    , getPowLimit = fromIntegral (maxBound `shiftR` 32 :: Word256)
    , getTargetTimespan = 14 * 24 * 60 * 60
    , getTargetSpacing = 10 * 60
    , getCheckpoints =
        -- These are in little endian notation!
        [ ( 11111
          , 0x0000000069e244f73d78e8fd29ba2fd2ed618bd6fa2ee92559f542fdb26e7c1d
          )
        , ( 33333
          , 0x000000002dd5588a74784eaa7ab0507a18ad16a236e7b1ce69f00d7ddfb5d0a6
          )
        , ( 74000
          , 0x0000000000573993a3c9e41ce34471c079dcf5f52a0e824a81e7f953b8661a20
          )
        , ( 105000
          , 0x00000000000291ce28027faea320c8d2b054b2e0fe44a773f3eefb151d6bdc97
          )
        , ( 134444
          , 0x00000000000005b12ffd4cd315cd34ffd4a594f430ac814c91184a0d42d2b0fe
          )
        , ( 168000
          , 0x000000000000099e61ea72015e79632f216fe6cb33d7899acb35b75c8303b763
          )
        , ( 193000
          , 0x000000000000059f452a5f7340de6682a977387c17010ff6e6c3bd83ca8b1317
          )
        , ( 210000
          , 0x000000000000048b95347e83192f69cf0366076336c639f9b7228e9ba171342e
          )
        , ( 216116
          , 0x00000000000001b4f4b433e81ee46494af945cf96014816a4e2370f11b23df4e
          )
        , ( 225430
          , 0x00000000000001c108384350f74090433e7fcf79a606b8e797f065b130575932
          )
        , ( 250000
          , 0x000000000000003887df1f29024b06fc2200b55f8af8f35453d7be294df2d214
          )
        , ( 279000
          , 0x0000000000000001ae8c72a0b0c301f67e3afca10e819efa9041e458e9bd7e40
          )
        ]
    }

