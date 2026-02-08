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

import Railgun.Crypto (getSharedSymmetricKey, aesEncryptCTR, sha256, randomBytes)
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
encryptNoteForRecipient 
  :: ByteString      -- ^ Sender's viewing private key
  -> ByteString      -- ^ Sender's viewing public key  
  -> TransferNote    -- ^ The note to encrypt
  -> IO (Either Text CommitmentCiphertext)
encryptNoteForRecipient senderViewPriv senderViewPub note = do
  -- Generate ephemeral random for key blinding
  ephemeralRandom <- randomBytes 32
  
  -- Compute shared secret with recipient using ECDH
  case getSharedSymmetricKey senderViewPriv (tnRecipientViewingKey note) of
    Nothing -> return $ Left "Failed to compute shared secret with recipient"
    Just sharedSecret -> do
      -- Encrypt the note data: (npk, token, value, random)
      -- Pack note data as 4 x 32-byte chunks
      let npkBytes = integerToBytes32 (tnRecipientNpk note)
          tokenBytes = integerToBytes32 (hexToInteger $ tnTokenAddress note)
          valueBytes = integerToBytes32 (tnValue note)
          randomPadded = BS.take 32 (tnRandom note <> BS.replicate 32 0)
          plaintext = npkBytes <> tokenBytes <> valueBytes <> randomPadded
      
      -- Encrypt with AES-CTR using shared secret
      (_iv, ciphertext) <- aesEncryptCTR sharedSecret plaintext
      
      -- Split ciphertext into 4 x 32-byte chunks for the ciphertext field
      let chunk0 = BS.take 32 ciphertext
          chunk1 = BS.take 32 $ BS.drop 32 ciphertext
          chunk2 = BS.take 32 $ BS.drop 64 ciphertext
          chunk3 = BS.take 32 $ BS.drop 96 ciphertext
      
      -- Create blinded keys
      -- In production, these would be the viewing keys multiplied by a random scalar
      -- For simplicity, we use a hash-based approach
      let blindedSender = sha256 (senderViewPub <> ephemeralRandom)
          blindedReceiver = sha256 (tnRecipientViewingKey note <> ephemeralRandom)
      
      return $ Right CommitmentCiphertext
        { ccCiphertext = [chunk0, chunk1, chunk2, chunk3]
        , ccBlindedSenderViewingKey = blindedSender
        , ccBlindedReceiverViewingKey = blindedReceiver
        , ccAnnotationData = BS.empty
        , ccMemo = BS.empty
        }

-- | Create commitment ciphertext for a change note (going back to sender)
createCommitmentCiphertext 
  :: ByteString      -- ^ Sender's viewing private key
  -> ByteString      -- ^ Sender's viewing public key
  -> Integer         -- ^ NPK for the change note
  -> Text            -- ^ Token address
  -> Integer         -- ^ Change value
  -> ByteString      -- ^ Random for the change note
  -> IO CommitmentCiphertext
createCommitmentCiphertext senderViewPriv senderViewPub npk tokenAddr value random = do
  ephemeralRandom <- randomBytes 32
  
  -- For change notes, we encrypt to ourselves
  let sharedSecret = sha256 (senderViewPriv <> senderViewPub)
      npkBytes = integerToBytes32 npk
      tokenBytes = integerToBytes32 (hexToInteger tokenAddr)
      valueBytes = integerToBytes32 value
      randomPadded = BS.take 32 (random <> BS.replicate 32 0)
      plaintext = npkBytes <> tokenBytes <> valueBytes <> randomPadded
  
  (_, ciphertext) <- aesEncryptCTR sharedSecret plaintext
  
  let chunk0 = BS.take 32 ciphertext
      chunk1 = BS.take 32 $ BS.drop 32 ciphertext
      chunk2 = BS.take 32 $ BS.drop 64 ciphertext
      chunk3 = BS.take 32 $ BS.drop 96 ciphertext
      blindedSender = sha256 (senderViewPub <> ephemeralRandom)
      blindedReceiver = sha256 (senderViewPub <> ephemeralRandom)  -- Same as sender for change
  
  return CommitmentCiphertext
    { ccCiphertext = [chunk0, chunk1, chunk2, chunk3]
    , ccBlindedSenderViewingKey = blindedSender
    , ccBlindedReceiverViewingKey = blindedReceiver
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
