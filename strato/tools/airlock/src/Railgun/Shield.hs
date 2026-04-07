{-# LANGUAGE OverloadedStrings #-}

module Railgun.Shield
  ( -- * Note construction
    createNote
  , createERC20Note
    -- * Shield request construction
  , createShieldRequest
  , createERC20ShieldRequest
    -- * Serialization
  , serializeShieldRequest
  ) where

import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE

import Railgun.Crypto 
  ( poseidonHash
  , randomBytes
  , getSharedSymmetricKey
  , encryptRandom
  , encryptWithCTR
  , deriveEd25519PubKey
  )
import Railgun.Keys (getViewingKeyPair)
import Railgun.Types

-- | Create a Note for an ERC20 token
createERC20Note :: MasterPublicKey  -- ^ Recipient's master public key
                -> ByteString       -- ^ Random value (16 bytes)
                -> Integer          -- ^ Amount to shield
                -> Text             -- ^ Token contract address (hex)
                -> Note
createERC20Note mpk random amount tokenAddr = Note
  { noteMasterPublicKey = mpk
  , noteRandom = random
  , noteValue = amount
  , noteTokenData = TokenData
      { tokenType = ERC20
      , tokenAddress = normalizeAddress tokenAddr
      , tokenSubID = 0
      }
  }

-- | Create a Note for any token type
createNote :: MasterPublicKey -> ByteString -> Integer -> TokenData -> Note
createNote mpk random amount tokData = Note
  { noteMasterPublicKey = mpk
  , noteRandom = random
  , noteValue = amount
  , noteTokenData = tokData
  }

-- | Compute the note public key: poseidon(masterPublicKey, random)
computeNotePublicKey :: Note -> NotePublicKey
computeNotePublicKey note = 
  poseidonHash [noteMasterPublicKey note, bytesToInteger (noteRandom note)]
  where
    bytesToInteger = BS.foldl' (\acc b -> acc * 256 + fromIntegral b) 0

-- | Create a shield request for an ERC20 token
createERC20ShieldRequest :: RailgunKeys  -- ^ Recipient's Railgun keys
                         -> Text         -- ^ Token contract address (hex)
                         -> Integer      -- ^ Amount to shield
                         -> IO ShieldRequest
createERC20ShieldRequest keys tokenAddr amount = do
  random <- randomBytes 16
  let note = createERC20Note (masterPublicKey keys) random amount tokenAddr
  createShieldRequestFromNote keys note

-- | Create a shield request from a Note
createShieldRequestFromNote :: RailgunKeys -> Note -> IO ShieldRequest
createShieldRequestFromNote keys note = do
  let (_viewingPrivKey, viewingPubKey) = getViewingKeyPair keys
  
  -- Compute the note public key (NPK)
  let npk = computeNotePublicKey note
  
  -- Create the commitment preimage (public data)
  let preimg = CommitmentPreimage
        { cpNpk = npk
        , cpToken = noteTokenData note
        , cpValue = noteValue note
        }
  
  -- Generate a "shield private key" for encryption
  -- In real Railgun, this comes from signing a message with the user's wallet
  -- For testing, we generate a random one
  shieldPrivKey <- randomBytes 32
  let shieldPubKey = deriveEd25519PubKey shieldPrivKey
  
  -- Derive shared key: Ed25519 point multiplication + SHA256
  sharedKey <- case getSharedSymmetricKey shieldPrivKey viewingPubKey of
    Just k  -> return k
    Nothing -> error "Failed to derive shared symmetric key - invalid public key"
  
  -- Encrypt the random value with AES-GCM using shared key
  (ivAndTag, encryptedRandom) <- encryptRandom sharedKey (noteRandom note)
  
  -- Encrypt the receiver's viewing public key with AES-CTR using shieldPrivKey
  (ctrIv, encryptedReceiver) <- encryptWithCTR shieldPrivKey viewingPubKey
  
  -- Construct the encrypted bundle:
  --   [0]: iv (16) || tag (16) = 32 bytes
  --   [1]: encryptedRandom (16) || ctrIv (16) = 32 bytes  
  --   [2]: encryptedReceiver (32) = 32 bytes
  let encBundle = EncryptedBundle
        { ebIvAndTag = ivAndTag
        , ebEncryptedRandom = encryptedRandom <> ctrIv
        , ebEncryptedReceiver = encryptedReceiver
        }
  
  let cipher = ShieldCiphertext
        { scEncryptedBundle = encBundle
        , scShieldKey = shieldPubKey
        }
  
  return ShieldRequest
    { srPreimage = preimg
    , srCiphertext = cipher
    }

-- | Create a shield request (legacy interface)
createShieldRequest :: RailgunKeys -> TokenData -> Integer -> IO ShieldRequest
createShieldRequest keys tokData amount = do
  random <- randomBytes 16
  let note = createNote (masterPublicKey keys) random amount tokData
  createShieldRequestFromNote keys note

-- Helper functions

-- | Strip "0x" prefix if present
stripHexPrefix :: Text -> Text
stripHexPrefix t
  | "0x" `T.isPrefixOf` t = T.drop 2 t
  | "0X" `T.isPrefixOf` t = T.drop 2 t
  | otherwise = t

-- | Normalize an address (lowercase, no 0x prefix)
normalizeAddress :: Text -> Text
normalizeAddress = T.toLower . stripHexPrefix

-- | Serialize a ShieldRequest for debugging/display
serializeShieldRequest :: ShieldRequest -> Text
serializeShieldRequest req = T.unlines
  [ "ShieldRequest {"
  , "  preimage: {"
  , "    npk: " <> integerToHex32 (cpNpk $ srPreimage req)
  , "    token: {"
  , "      tokenType: " <> T.pack (show $ tokenType $ cpToken $ srPreimage req)
  , "      tokenAddress: " <> tokenAddress (cpToken $ srPreimage req)
  , "      tokenSubID: " <> T.pack (show $ tokenSubID $ cpToken $ srPreimage req)
  , "    }"
  , "    value: " <> T.pack (show $ cpValue $ srPreimage req)
  , "  }"
  , "  ciphertext: {"
  , "    encryptedBundle: [" <> bundleText <> "]"
  , "    shieldKey: " <> bytesToHex (scShieldKey $ srCiphertext req)
  , "  }"
  , "}"
  ]
  where
    bundle = scEncryptedBundle $ srCiphertext req
    bundleText = T.intercalate ", " 
      [ bytesToHex (ebIvAndTag bundle)
      , bytesToHex (ebEncryptedRandom bundle)
      , bytesToHex (ebEncryptedReceiver bundle)
      ]
    bytesToHex = TE.decodeUtf8 . B16.encode
