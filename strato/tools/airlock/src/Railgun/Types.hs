{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Railgun.Types 
  ( -- * Token Types
    TokenType(..)
  , TokenData(..)
  , tokenTypeToInt
  , intToTokenType
    -- * Note Types
  , Note(..)
  , NotePublicKey
  , MasterPublicKey
  , Random
    -- * Commitment Types
  , CommitmentPreimage(..)
  , ShieldCiphertext(..)
  , EncryptedBundle(..)
  , ShieldRequest(..)
    -- * Key Types
  , RailgunKeys(..)
  , RailgunAddress(..)
    -- * Serialization
  , serializeTokenData
  , serializeNote
  , integerToHex32
  , integerToBytes32
  , encryptedBundleToHexList
  ) where

import Data.Aeson
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import Data.Text (Text)
import qualified Data.Text.Encoding as TE
import qualified Data.ByteString.Base16 as B16
import GHC.Generics (Generic)

-- | Token types supported by Railgun
data TokenType = ERC20 | ERC721 | ERC1155
  deriving (Show, Eq, Generic, Enum, Bounded)

tokenTypeToInt :: TokenType -> Int
tokenTypeToInt ERC20 = 0
tokenTypeToInt ERC721 = 1
tokenTypeToInt ERC1155 = 2

intToTokenType :: Int -> Maybe TokenType
intToTokenType 0 = Just ERC20
intToTokenType 1 = Just ERC721
intToTokenType 2 = Just ERC1155
intToTokenType _ = Nothing

instance ToJSON TokenType where
  toJSON ERC20 = String "ERC20"
  toJSON ERC721 = String "ERC721"
  toJSON ERC1155 = String "ERC1155"

-- | Token data for a shield request
data TokenData = TokenData
  { tokenType :: TokenType
  , tokenAddress :: Text      -- ^ 20-byte address as hex
  , tokenSubID :: Integer     -- ^ 0 for ERC20, token ID for NFTs
  } deriving (Show, Eq, Generic)

instance ToJSON TokenData where
  toJSON td = object
    [ "tokenType" .= tokenType td  -- Uses TokenType's ToJSON which outputs "ERC20" etc.
    , "tokenAddress" .= tokenAddress td  -- Already normalized (no 0x prefix)
    , "tokenSubID" .= tokenSubID td
    ]

-- | Serialize TokenData to bytes for hashing
-- Format: tokenType (1 byte) + tokenAddress (20 bytes) + tokenSubID (32 bytes)
serializeTokenData :: TokenData -> ByteString
serializeTokenData td = BS.concat
  [ BS.singleton (fromIntegral $ tokenTypeToInt $ tokenType td)
  , hexToBS $ tokenAddress td
  , integerToBytes32 $ tokenSubID td
  ]
  where
    hexToBS :: Text -> ByteString
    hexToBS t = case B16.decode (TE.encodeUtf8 t) of
      Right bs -> bs
      Left _ -> BS.replicate 20 0

-- | Type aliases for clarity
type NotePublicKey = Integer    -- ^ Poseidon hash of (masterPublicKey, random)
type MasterPublicKey = Integer  -- ^ Derived from spending key
type Random = ByteString        -- ^ 16 bytes of randomness

-- | A Railgun note (the core private transaction unit)
data Note = Note
  { noteMasterPublicKey :: MasterPublicKey  -- ^ Owner's master public key
  , noteRandom :: Random                     -- ^ 16 bytes of randomness
  , noteValue :: Integer                     -- ^ Amount (ERC20) or 1 (ERC721)
  , noteTokenData :: TokenData               -- ^ Token information
  } deriving (Show, Eq)

-- | Serialize a Note to bytes
-- Format matches Railgun's note serialization for encryption
serializeNote :: Note -> ByteString
serializeNote note = BS.concat
  [ integerToBytes32 $ noteMasterPublicKey note
  , noteRandom note  -- 16 bytes
  , integerToBytes32 $ noteValue note
  , serializeTokenData $ noteTokenData note
  ]

-- | Encrypted bundle containing:
--   [0]: AES-GCM IV (16 bytes) + tag (16 bytes)
--   [1]: Encrypted random (16 bytes) + AES-CTR IV (16 bytes)
--   [2]: Encrypted receiver viewing pubkey (32 bytes)
data EncryptedBundle = EncryptedBundle
  { ebIvAndTag :: ByteString      -- ^ 32 bytes: GCM IV || GCM tag
  , ebEncryptedRandom :: ByteString  -- ^ 32 bytes: encrypted random || CTR IV
  , ebEncryptedReceiver :: ByteString -- ^ 32 bytes: encrypted receiver pubkey
  } deriving (Show, Eq)

-- | Convert EncryptedBundle to list of hex strings for JSON
encryptedBundleToHexList :: EncryptedBundle -> [Text]
encryptedBundleToHexList eb =
  [ TE.decodeUtf8 $ B16.encode $ ebIvAndTag eb
  , TE.decodeUtf8 $ B16.encode $ ebEncryptedRandom eb
  , TE.decodeUtf8 $ B16.encode $ ebEncryptedReceiver eb
  ]

-- | Commitment preimage - the plaintext data submitted to the contract
data CommitmentPreimage = CommitmentPreimage
  { cpNpk :: NotePublicKey    -- ^ Note public key (Poseidon hash)
  , cpToken :: TokenData      -- ^ Token information
  , cpValue :: Integer        -- ^ Amount
  } deriving (Show, Eq, Generic)

instance ToJSON CommitmentPreimage where
  toJSON cp = object
    [ "npk" .= integerToHex32 (cpNpk cp)
    , "token" .= cpToken cp
    , "value" .= cpValue cp
    ]

-- | Shield ciphertext - encrypted note data for recipient discovery
data ShieldCiphertext = ShieldCiphertext
  { scEncryptedBundle :: EncryptedBundle  -- ^ 3 x 32 bytes encrypted data
  , scShieldKey :: ByteString             -- ^ 32 bytes: sender's ephemeral pubkey
  } deriving (Show, Eq)

instance ToJSON ShieldCiphertext where
  toJSON sc = object
    [ "encryptedBundle" .= encryptedBundleToHexList (scEncryptedBundle sc)
    , "shieldKey" .= (TE.decodeUtf8 $ B16.encode $ scShieldKey sc)
    ]

-- | A complete shield request to submit to the contract
data ShieldRequest = ShieldRequest
  { srPreimage :: CommitmentPreimage
  , srCiphertext :: ShieldCiphertext
  } deriving (Show, Eq)

instance ToJSON ShieldRequest where
  toJSON sr = object
    [ "preimage" .= srPreimage sr
    , "ciphertext" .= srCiphertext sr
    ]

-- | Railgun key hierarchy derived from mnemonic
data RailgunKeys = RailgunKeys
  { spendingKey :: ByteString       -- ^ 32 bytes - master spending key
  , viewingPrivateKey :: ByteString -- ^ 32 bytes - Ed25519 private key
  , viewingPublicKey :: ByteString  -- ^ 32 bytes - Ed25519 public key
  , nullifierKey :: ByteString      -- ^ 32 bytes - for generating nullifiers
  , masterPublicKey :: MasterPublicKey  -- ^ Derived from spending key
  } deriving (Show, Eq)

-- | Railgun address (0zk prefix + hex encoded keys)
newtype RailgunAddress = RailgunAddress { unRailgunAddress :: Text }
  deriving (Show, Eq)

-- Helper functions

-- | Convert Integer to 32-byte big-endian ByteString
integerToBytes32 :: Integer -> ByteString
integerToBytes32 n = BS.pack $ reverse $ take 32 $ go n ++ repeat 0
  where
    go 0 = []
    go x = fromIntegral (x `mod` 256) : go (x `div` 256)

-- | Convert Integer to 32-byte hex string
integerToHex32 :: Integer -> Text
integerToHex32 = TE.decodeUtf8 . B16.encode . integerToBytes32
