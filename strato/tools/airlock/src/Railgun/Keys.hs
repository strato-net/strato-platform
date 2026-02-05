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
  ) where

import qualified Crypto.PubKey.Ed25519 as Ed25519
import Crypto.Error (CryptoFailable(..))

import Data.ByteArray (convert)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE

import Railgun.Crypto (mnemonicToSeed, sha256)
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
    
    -- Derive nullifier key from spending key
    nullKey = BS.take 32 $ sha256 $ spendKey <> "railgun-nullifier"
    
    -- Derive master public key (must be < SNARK_SCALAR_FIELD)
    masterPubKeyBytes = deriveEd25519PublicKey spendKey
    mpk = bytesToInteger masterPubKeyBytes `mod` snarkScalarField

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
-- Format: "0zk" prefix + bech32 encoded (masterPubKey || viewingPubKey)
railgunAddress :: RailgunKeys -> RailgunAddress
railgunAddress keys = RailgunAddress $ "0zk" <> hexEncoded
  where
    -- Railgun address contains master public key and viewing public key
    -- For now, we derive master public key from spending key
    masterPubKey = deriveEd25519PublicKey (spendingKey keys)
    combined = masterPubKey <> viewingPublicKey keys
    hexEncoded = TE.decodeUtf8 $ B16.encode combined

-- | Decode a Railgun address to extract public keys
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

-- | SNARK scalar field - NPK must be less than this
snarkScalarField :: Integer
snarkScalarField = 21888242871839275222246405745257275088548364400416034343698204186575808495617

-- | Convert bytes to integer (big-endian)
bytesToInteger :: ByteString -> Integer
bytesToInteger = BS.foldl' (\acc b -> acc * 256 + fromIntegral b) 0

-- | Get the viewing key pair
getViewingKeyPair :: RailgunKeys -> (ByteString, ByteString)
getViewingKeyPair keys = (viewingPrivateKey keys, viewingPublicKey keys)

-- | Get the nullifier private key
getNullifierPrivateKey :: RailgunKeys -> ByteString
getNullifierPrivateKey = nullifierKey
