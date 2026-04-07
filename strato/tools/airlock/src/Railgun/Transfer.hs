{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Railgun.Transfer
  ( -- * Types
    TransferRequest(..)
  , TransferNote(..)
    -- * Construction  
  , createTransferRequest
  , encryptNoteForRecipient
  , createCommitmentCiphertext
    -- * Recipient address parsing
  , parseRecipientAddress
  ) where

import Data.Bits ((.&.), shiftR)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE

import Railgun.Crypto (getSharedSymmetricKey, aesEncryptCTR, randomBytes, getEd25519PublicKey)
import Railgun.Keys (decodeRailgunAddress)
import Railgun.Types (TokenData(..), TokenType(..), CommitmentPreimage(..), RailgunAddress(..))
import Railgun.Unshield (SnarkProof, BoundParams(..), UnshieldType(..), CommitmentCiphertext(..), Transaction(..))

-- | A note to be created for the transfer recipient
data TransferNote = TransferNote
  { tnRecipientNpk :: Integer       -- ^ Recipient's note public key (master public key)
  , tnRecipientViewingKey :: ByteString  -- ^ Recipient's viewing public key (for encryption)
  , tnTokenAddress :: Text          -- ^ Token address
  , tnValue :: Integer              -- ^ Amount to transfer
  , tnRandom :: ByteString          -- ^ Random value for the note (16 bytes)
  } deriving (Show, Eq)

-- | Full transfer request (wraps UnshieldRequest since the structure is similar)
data TransferRequest = TransferRequest
  { trTransactions :: [Transaction]
  } deriving (Show, Eq)

-- | Parse a recipient's Railgun address to extract their public keys
-- Returns (masterPublicKey, viewingPublicKey)
parseRecipientAddress :: Text -> Either Text (ByteString, ByteString)
parseRecipientAddress addr = decodeRailgunAddress (RailgunAddress addr)


-- | Encrypt note data for the recipient
-- Returns the CommitmentCiphertext that allows the recipient to decrypt their note
-- Uses ECDH with ephemeral keypairs for proper decryptability
--
-- Ciphertext format:
--   chunk0 = IV (16 bytes) || first 16 bytes of encrypted data
--   chunk1 = next 32 bytes of encrypted data  
--   chunk2 = next 32 bytes of encrypted data
--   chunk3 = last 16 bytes of encrypted data || 16 zero padding
--
-- Plaintext layout (96 bytes encrypted):
--   npk (32 bytes) || token (32 bytes) || value (16 bytes) || random (16 bytes)
encryptNoteForRecipient 
  :: ByteString      -- ^ Sender's viewing private key
  -> ByteString      -- ^ Sender's viewing public key  
  -> TransferNote    -- ^ The note to encrypt
  -> IO (Either Text CommitmentCiphertext)
encryptNoteForRecipient _senderViewPriv _senderViewPub note = do
  -- Generate ephemeral keypair for recipient encryption
  -- The recipient will use their viewing private key with this ephemeral public key
  ephemeralPriv <- randomBytes 32
  let ephemeralPub = getEd25519PublicKey ephemeralPriv
  
  -- Compute shared secret: ECDH(ephemeralPriv, recipientViewingPub)
  -- Recipient can compute same secret as: ECDH(recipientViewingPriv, ephemeralPub)
  case getSharedSymmetricKey ephemeralPriv (tnRecipientViewingKey note) of
    Nothing -> return $ Left "Failed to compute shared secret with recipient"
    Just sharedSecret -> do
      -- Pack note data: npk || token || value (16 bytes) || random (16 bytes) = 96 bytes
      let npkBytes = integerToBytes32 (tnRecipientNpk note)
          tokenBytes = integerToBytes32 (hexToInteger $ tnTokenAddress note)
          valueBytes = integerToBytes16 (tnValue note)
          randomBytes16 = BS.take 16 (tnRandom note <> BS.replicate 16 0)
          plaintext = npkBytes <> tokenBytes <> valueBytes <> randomBytes16  -- 96 bytes
      
      -- Encrypt with AES-CTR using shared secret
      (iv, ciphertext) <- aesEncryptCTR sharedSecret plaintext
      
      -- Pack into 4 x 32-byte chunks with IV in chunk0
      let chunk0 = iv <> BS.take 16 ciphertext                    -- IV (16) + enc[0:16]
          chunk1 = BS.take 32 $ BS.drop 16 ciphertext             -- enc[16:48]
          chunk2 = BS.take 32 $ BS.drop 48 ciphertext             -- enc[48:80]
          chunk3 = BS.take 16 (BS.drop 80 ciphertext) <> BS.replicate 16 0  -- enc[80:96] + padding
      
      return $ Right CommitmentCiphertext
        { ccCiphertext = [chunk0, chunk1, chunk2, chunk3]
        , ccBlindedSenderViewingKey = BS.replicate 32 0   -- Not used for incoming notes
        , ccBlindedReceiverViewingKey = ephemeralPub      -- Recipient uses this for ECDH
        , ccAnnotationData = BS.empty
        , ccMemo = BS.empty
        }

-- | Convert Integer to 16-byte ByteString (big-endian)
integerToBytes16 :: Integer -> ByteString
integerToBytes16 n = BS.pack $ reverse $ take 16 $ 
  map (\i -> fromIntegral $ (n `shiftR` (i * 8)) .&. 0xff) [0..15]

-- | Create commitment ciphertext for a change note (going back to sender)
-- Uses ephemeral ECDH so sender can decrypt their own change notes
--
-- Same format as encryptNoteForRecipient, but encrypted to sender's viewing key
createCommitmentCiphertext 
  :: ByteString      -- ^ Sender's viewing private key (unused but kept for API consistency)
  -> ByteString      -- ^ Sender's viewing public key
  -> Integer         -- ^ NPK for the change note
  -> Text            -- ^ Token address
  -> Integer         -- ^ Change value
  -> ByteString      -- ^ Random for the change note (16 bytes)
  -> IO CommitmentCiphertext
createCommitmentCiphertext _senderViewPriv senderViewPub npk tokenAddr value random = do
  -- Generate ephemeral keypair for encryption
  ephemeralPriv <- randomBytes 32
  let ephemeralPub = getEd25519PublicKey ephemeralPriv
  
  -- For change notes, we encrypt to sender's viewing key
  -- Sender can decrypt with: ECDH(senderViewPriv, ephemeralPub)
  case getSharedSymmetricKey ephemeralPriv senderViewPub of
    Nothing -> error "Failed to compute shared secret for change note"
    Just sharedSecret -> do
      -- Pack note data: npk || token || value (16 bytes) || random (16 bytes) = 96 bytes
      let npkBytes = integerToBytes32 npk
          tokenBytes = integerToBytes32 (hexToInteger tokenAddr)
          valueBytes = integerToBytes16 value
          randomBytes16 = BS.take 16 (random <> BS.replicate 16 0)
          plaintext = npkBytes <> tokenBytes <> valueBytes <> randomBytes16  -- 96 bytes
      
      (iv, ciphertext) <- aesEncryptCTR sharedSecret plaintext
      
      -- Pack into 4 x 32-byte chunks with IV in chunk0
      let chunk0 = iv <> BS.take 16 ciphertext                    -- IV (16) + enc[0:16]
          chunk1 = BS.take 32 $ BS.drop 16 ciphertext             -- enc[16:48]
          chunk2 = BS.take 32 $ BS.drop 48 ciphertext             -- enc[48:80]
          chunk3 = BS.take 16 (BS.drop 80 ciphertext) <> BS.replicate 16 0  -- enc[80:96] + padding
      
      -- Sender uses blindedSenderViewingKey for ECDH decryption
      return CommitmentCiphertext
        { ccCiphertext = [chunk0, chunk1, chunk2, chunk3]
        , ccBlindedSenderViewingKey = ephemeralPub     -- Sender uses this for ECDH
        , ccBlindedReceiverViewingKey = ephemeralPub   -- Same since change goes to sender
        , ccAnnotationData = BS.empty
        , ccMemo = BS.empty
        }

-- | Create a transfer request
createTransferRequest
  :: SnarkProof        -- ^ The generated SNARK proof
  -> ByteString        -- ^ Merkle root (32 bytes)
  -> Integer           -- ^ Nullifier
  -> [Integer]         -- ^ Output commitments
  -> [CommitmentCiphertext]  -- ^ Ciphertexts for the output notes
  -> Text              -- ^ Token address
  -> Integer           -- ^ Chain ID
  -> Int               -- ^ Tree number
  -> TransferRequest
createTransferRequest proof merkleRoot nullifier commitments ciphertexts tokenAddr chainId treeNum =
  let
    nullifierBytes = integerToBytes32 nullifier
    commitmentBytes = map integerToBytes32 commitments
    
    -- For transfer (not unshield), the unshield preimage has value 0
    -- The actual transfer happens through the encrypted commitments
    tokenData = TokenData
      { tokenType = ERC20
      , tokenAddress = tokenAddr
      , tokenSubID = 0
      }
    
    -- Dummy unshield preimage (no actual unshield happening)
    dummyUnshieldPreimage = CommitmentPreimage
      { cpNpk = 0
      , cpToken = tokenData
      , cpValue = 0  -- No unshield
      }
    
    boundParams = BoundParams
      { bpTreeNumber = treeNum
      , bpMinGasPrice = 0
      , bpUnshield = UnshieldNone  -- No unshield for pure transfer
      , bpChainID = chainId
      , bpAdaptContract = "0x0000000000000000000000000000000000000000"
      , bpAdaptParams = BS.replicate 32 0
      , bpCommitmentCiphertext = ciphertexts
      }
    
    tx = Transaction
      { txProof = proof
      , txMerkleRoot = merkleRoot
      , txNullifiers = [nullifierBytes]
      , txCommitments = commitmentBytes
      , txBoundParams = boundParams
      , txUnshieldPreimage = dummyUnshieldPreimage
      }
    
  in TransferRequest { trTransactions = [tx] }

-- | Convert hex text to Integer
hexToInteger :: Text -> Integer
hexToInteger t =
  let cleanHex = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 t else t
  in case B16.decode (TE.encodeUtf8 cleanHex) of
       Right bs -> bytesToInteger bs
       Left _ -> 0
  where
    bytesToInteger = BS.foldl' (\acc b -> acc * 256 + fromIntegral b) 0

-- | Convert Integer to 32-byte ByteString (big-endian)
integerToBytes32 :: Integer -> ByteString
integerToBytes32 n = BS.pack $ reverse $ take 32 $ 
  map (\i -> fromIntegral $ (n `shiftR` (i * 8)) .&. 0xff) [0..31]
