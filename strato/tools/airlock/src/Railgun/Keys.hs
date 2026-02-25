{-# LANGUAGE OverloadedStrings #-}

module Railgun.Keys
  ( -- * Key derivation
    deriveRailgunKeys
  , deriveFromMnemonic
    -- * Address generation
  , railgunAddress
  , decodeRailgunAddress
    -- * Key accessors
  , getViewingKeyPair
  , getNullifierPrivateKey
    -- * Baby JubJub public key
  , getMasterPublicKeyPoint
  ) where

import qualified Crypto.PubKey.Ed25519 as Ed25519
import Crypto.Error (CryptoFailable(..))
import qualified Crypto.Curve.BabyJubJub as BJJ

import Data.ByteArray (convert)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE

import Railgun.Crypto (mnemonicToSeed, sha256, bytesToIntegerLE, poseidonHash)
import Railgun.Types (RailgunKeys(..), RailgunAddress(..))

-- | Railgun key derivation path indices
-- Based on BIP32/BIP44 style derivation
-- m/44'/railgun_coin_type'/account'/change/index
-- 
-- Railgun uses a custom derivation scheme:
--   1. BIP39 mnemonic -> 64 byte seed
--   2. Seed -> spending key (via HKDF or similar)
--   3. Spending key -> viewing key (Ed25519)
--   4. Spending key -> nullifier key

-- | Derive all Railgun keys from a BIP39 seed
deriveRailgunKeys :: ByteString  -- ^ 64-byte BIP39 seed
                  -> Int         -- ^ Derivation index (0 for first wallet)
                  -> RailgunKeys
deriveRailgunKeys seed index = RailgunKeys
  { spendingKey = spendKey
  , viewingPrivateKey = viewPrivKey
  , viewingPublicKey = viewPubKey
  , nullifierKey = nullKey
  , masterPublicKey = mpk
  }
  where
    -- Derive spending key from seed
    indexBytes = BS.pack [fromIntegral index]
    spendKey = BS.take 32 $ sha256 $ seed <> "railgun-spending" <> indexBytes
    
    -- Derive viewing key from spending key
    -- Use Ed25519 keys (converted to X25519 during ECDH, compatible with noble-ed25519)
    viewPrivKey = BS.take 32 $ sha256 $ spendKey <> "railgun-viewing"
    viewPubKey = deriveEd25519PublicKey viewPrivKey
    
    -- Derive nullifying key using Railgun SDK formula:
    -- nullifyingKey = poseidon([viewingPrivateKeyAsBigInt])
    -- Note: We store the hash result as bytes for compatibility, but the actual
    -- nullifying key INTEGER is viewPrivKeyInt poseidon-hashed
    viewPrivKeyInt = bytesToIntegerLE viewPrivKey
    nullifyingKeyInt = poseidonHash [viewPrivKeyInt]
    -- Store as bytes (32 bytes, big-endian for consistency)
    nullKey = integerToBytes32BE nullifyingKeyInt
    
    -- Derive master public key using Railgun SDK formula:
    -- masterPublicKey = poseidon(spendingPublicKey.x, spendingPublicKey.y, nullifyingKey)
    -- First get the Baby JubJub public key from spending key scalar
    spendScalar = bytesToIntegerLE spendKey `mod` BJJ.subgroupOrder
    (pkX, pkY) = case BJJ.scalarMultBase spendScalar of
      BJJ.Point x y -> (x, y)
      BJJ.Infinity -> (0, 1)
    -- Master public key is poseidon hash of spending public key + nullifying key
    mpk = poseidonHash [pkX, pkY, nullifyingKeyInt]
    
    -- Helper to convert integer to 32 bytes big-endian
    integerToBytes32BE :: Integer -> ByteString
    integerToBytes32BE n = BS.pack $ map fromIntegral $ 
      reverse $ take 32 $ go n ++ repeat 0
      where go 0 = []
            go x = (x `mod` 256) : go (x `div` 256)

-- | Derive Ed25519 public key from private key bytes
deriveEd25519PublicKey :: ByteString -> ByteString
deriveEd25519PublicKey privKeyBytes = 
  case Ed25519.secretKey privKeyBytes of
    CryptoPassed sk -> convert $ Ed25519.toPublic sk
    CryptoFailed _ -> BS.replicate 32 0  -- fallback, should not happen

-- | Convenience function: mnemonic -> keys
deriveFromMnemonic :: Text    -- ^ BIP39 mnemonic phrase
                   -> Text    -- ^ Passphrase (empty string for no passphrase)
                   -> Int     -- ^ Derivation index
                   -> Either Text RailgunKeys
deriveFromMnemonic mnemonic passphrase index = do
  -- Validate mnemonic
  let wordCount = length $ T.words mnemonic
  if wordCount `notElem` [12, 15, 18, 21, 24]
    then Left $ "Invalid mnemonic word count: " <> T.pack (show wordCount)
    else Right $ deriveRailgunKeys seed index
  where
    seed = mnemonicToSeed mnemonic passphrase

-- | Generate a Railgun address from keys
-- Format: "0zk" prefix + hex encoded (masterPublicKey as 32 bytes || viewingPubKey)
-- The masterPublicKey is the poseidon hash used in circuit commitments
railgunAddress :: RailgunKeys -> RailgunAddress
railgunAddress keys = RailgunAddress $ "0zk" <> hexEncoded
  where
    -- Encode master public key (Integer) as 32 bytes big-endian
    mpkBytes = integerToBytes32BE (masterPublicKey keys)
    combined = mpkBytes <> viewingPublicKey keys
    hexEncoded = TE.decodeUtf8 $ B16.encode combined
    
    integerToBytes32BE :: Integer -> ByteString
    integerToBytes32BE n = BS.pack $ map fromIntegral $ 
      reverse $ take 32 $ go n ++ repeat 0
      where go 0 = []
            go x = (x `mod` 256) : go (x `div` 256)

-- | Decode a Railgun address to extract public keys
-- Returns (masterPublicKey as bytes, viewingPublicKey as bytes)
decodeRailgunAddress :: RailgunAddress -> Either Text (ByteString, ByteString)
decodeRailgunAddress (RailgunAddress addr)
  | not ("0zk" `T.isPrefixOf` addr) = Left "Invalid Railgun address: must start with 0zk"
  | otherwise = do
      let hexPart = T.drop 3 addr  -- remove "0zk" prefix
      case B16.decode (TE.encodeUtf8 hexPart) of
        Left err -> Left $ "Invalid hex encoding: " <> T.pack err
        Right decoded 
          | BS.length decoded /= 64 -> Left "Invalid address length"
          | otherwise -> Right (BS.take 32 decoded, BS.drop 32 decoded)

-- | Get the viewing key pair
getViewingKeyPair :: RailgunKeys -> (ByteString, ByteString)
getViewingKeyPair keys = (viewingPrivateKey keys, viewingPublicKey keys)

-- | Get the nullifier private key
getNullifierPrivateKey :: RailgunKeys -> ByteString
getNullifierPrivateKey = nullifierKey

-- | Get the Baby JubJub public key point (x, y) for circuit input
-- This recomputes the point from the spending key
getMasterPublicKeyPoint :: RailgunKeys -> (Integer, Integer)
getMasterPublicKeyPoint keys =
  let spendScalar = bytesToIntegerLE (spendingKey keys) `mod` BJJ.subgroupOrder
  in case BJJ.scalarMultBase spendScalar of
       BJJ.Point x y -> (x, y)
       BJJ.Infinity -> (0, 1)
