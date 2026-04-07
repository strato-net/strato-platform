{-# LANGUAGE OverloadedStrings #-}

module Railgun.Scan
  ( -- * Commitment scanning
    scanCommitments
  , tryDecryptNote
    -- * Balance calculation
  , calculateBalance
  , ShieldedBalance(..)
    -- * Types
  , Commitment(..)
  , DecryptedNote(..)
  ) where

import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import Data.Text (Text)

import Railgun.Crypto (sha256)
import Railgun.Types (RailgunKeys(..), TokenType(..))

-- | A scanned commitment from the merkle tree
data Commitment = Commitment
  { commitmentIndex :: Integer
  , commitmentNpk :: ByteString
  , commitmentTokenAddress :: Text
  , commitmentTokenType :: TokenType
  , commitmentTokenSubID :: Integer
  , commitmentValue :: Integer
  , commitmentEncryptedBundle :: [ByteString]
  , commitmentShieldKey :: ByteString
  } deriving (Show, Eq)

-- | A decrypted note (commitment that belongs to us)
data DecryptedNote = DecryptedNote
  { noteIndex :: Integer
  , noteTokenAddress :: Text
  , noteTokenType :: TokenType
  , noteValue :: Integer
  } deriving (Show, Eq)

-- | Shielded balance for a token
data ShieldedBalance = ShieldedBalance
  { balanceTokenAddress :: Text
  , balanceTokenType :: TokenType
  , balanceAmount :: Integer
  , balanceNoteCount :: Int
  } deriving (Show, Eq)

-- | Try to decrypt a note using our viewing key
-- Returns Just the decrypted note if it belongs to us, Nothing otherwise
tryDecryptNote :: RailgunKeys -> Commitment -> Maybe DecryptedNote
tryDecryptNote keys commitment = 
  -- Check if the npk matches our master public key
  -- In real Railgun, npk = poseidon(masterPubKey, random)
  -- For our simplified version, we check if npk is derived from our key
  if canDecrypt
    then Just DecryptedNote
      { noteIndex = commitmentIndex commitment
      , noteTokenAddress = commitmentTokenAddress commitment
      , noteTokenType = commitmentTokenType commitment
      , noteValue = commitmentValue commitment
      }
    else Nothing
  where
    -- Our master public key (derived from spending key)
    ourMasterPubKey = deriveEd25519PubKey (spendingKey keys)
    
    -- Check if this commitment's npk could be ours
    -- Simplified: check if npk matches our master pub key directly
    -- (Real Railgun uses poseidon hash with randomness)
    canDecrypt = commitmentNpk commitment == ourMasterPubKey

-- | Derive Ed25519 public key from private key (simplified)
deriveEd25519PubKey :: ByteString -> ByteString
deriveEd25519PubKey privKey = BS.take 32 $ sha256 $ privKey <> "ed25519-pub"

-- | Scan commitments from the Railgun contract storage
-- This queries the STRATO API for shield events
scanCommitments :: Text      -- ^ STRATO base URL
                -> Text      -- ^ Auth token
                -> Text      -- ^ Railgun contract address
                -> IO [Commitment]
scanCommitments _baseUrl _authToken _contractAddr = do
  -- TODO: Query STRATO API for shield events
  -- For now, return empty list
  return []

-- | Calculate total balance from decrypted notes
calculateBalance :: [DecryptedNote] -> [ShieldedBalance]
calculateBalance notes = 
  map toBalance $ groupByToken notes
  where
    groupByToken :: [DecryptedNote] -> [(Text, TokenType, [DecryptedNote])]
    groupByToken ns = 
      let tokens = [(noteTokenAddress n, noteTokenType n) | n <- ns]
          uniqueTokens = removeDuplicates tokens
      in [(addr, typ, filter (\n -> noteTokenAddress n == addr && noteTokenType n == typ) ns) 
         | (addr, typ) <- uniqueTokens]
    
    toBalance :: (Text, TokenType, [DecryptedNote]) -> ShieldedBalance
    toBalance (addr, typ, ns) = ShieldedBalance
      { balanceTokenAddress = addr
      , balanceTokenType = typ
      , balanceAmount = sum $ map noteValue ns
      , balanceNoteCount = length ns
      }
    
    removeDuplicates :: Eq a => [a] -> [a]
    removeDuplicates [] = []
    removeDuplicates (x:xs) = x : removeDuplicates (filter (/= x) xs)
