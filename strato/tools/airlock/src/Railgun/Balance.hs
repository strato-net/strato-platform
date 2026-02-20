{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Railgun.Balance
  ( -- * Balance scanning
    scanShieldedBalance
  , ShieldedNote(..)
  , TokenBalance(..)
    -- * Event fetching
  , fetchShieldEvents
  , ShieldEvent(..)
  ) where

import Control.Exception (try, SomeException)
import Data.Aeson
import Data.Aeson.Types (parseMaybe, Parser)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as LBS
import qualified Data.ByteString.Base16 as B16
import Data.List (foldl')
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe (mapMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import GHC.Generics (Generic)
import Network.HTTP.Client
import Network.HTTP.Types.Status (statusCode)
import Text.Read (readMaybe)
import Text.Printf (printf)

import Railgun.Crypto (getSharedSymmetricKey, decryptRandom, poseidonHash, computeNullifier, aesDecryptCTR)
import Railgun.Types (RailgunKeys(..), TokenType(..))
import Railgun.API (readContractAddress, defaultHost, defaultPort)
import Strato.Auth (authRequest)
import qualified Data.Set as Set

-- | A Shield event from Cirrus
data ShieldEvent = ShieldEvent
  { seBlockNumber :: Text
  , seBlockTimestamp :: Text
  , seTransactionSender :: Text
  , seTreeNumber :: Integer
  , seStartPosition :: Integer
  , seCommitments :: [CommitmentData]
  , seCiphertexts :: [CiphertextData]
  , seFees :: [Integer]
  } deriving (Show, Eq, Generic)

-- | Commitment data from a Shield event
data CommitmentData = CommitmentData
  { cdNpk :: Text            -- ^ Note public key (hex)
  , cdTokenAddress :: Text   -- ^ Token contract address
  , cdTokenType :: Int       -- ^ 0=ERC20, 1=ERC721, 2=ERC1155
  , cdTokenSubID :: Integer  -- ^ 0 for ERC20
  , cdValue :: Integer       -- ^ Amount in wei
  } deriving (Show, Eq, Generic)

-- | Ciphertext data from a Shield event
data CiphertextData = CiphertextData
  { ctEncryptedBundle :: [Text]  -- ^ 3 x 32-byte hex strings
  , ctShieldKey :: Text          -- ^ 32-byte hex string
  } deriving (Show, Eq, Generic)

-- | A decrypted shielded note
data ShieldedNote = ShieldedNote
  { snTokenAddress :: Text
  , snTokenType :: TokenType
  , snTokenSubID :: Integer
  , snValue :: Integer
  , snBlockNumber :: Text
  , snTreePosition :: Integer
  , snRandom :: ByteString  -- ^ The decrypted random value
  } deriving (Show, Eq)

-- | Aggregated balance for a token
data TokenBalance = TokenBalance
  { tbTokenAddress :: Text
  , tbTokenType :: TokenType
  , tbTotalValue :: Integer
  , tbNoteCount :: Int
  } deriving (Show, Eq)

-- | A Nullified event from Cirrus (emitted when notes are spent)
data NullifiedEvent = NullifiedEvent
  { neTreeNumber :: Integer
  , neNullifiers :: [Text]  -- ^ List of nullifier hashes (hex)
  } deriving (Show, Eq, Generic)

-- | A Transact event from Cirrus (emitted on transfers/unshields with change outputs)
data TransactEvent = TransactEvent
  { teBlockNumber :: Text
  , teTreeNumber :: Integer
  , teStartPosition :: Integer
  , teCommitmentHashes :: [Text]     -- ^ Commitment hashes (bytes32[])
  , teCiphertexts :: [TransactCiphertext]  -- ^ Encrypted note data
  } deriving (Show, Eq, Generic)

-- | Ciphertext data from a Transact event
data TransactCiphertext = TransactCiphertext
  { tcCiphertext :: [Text]           -- ^ 4 x 32-byte hex strings
  , tcBlindedSenderViewingKey :: Text    -- ^ 32-byte hex (for sender to decrypt)
  , tcBlindedReceiverViewingKey :: Text  -- ^ 32-byte hex (for receiver to decrypt)
  } deriving (Show, Eq, Generic)

-- | Fetch all Shield events from Cirrus
fetchShieldEvents :: IO (Either Text [ShieldEvent])
fetchShieldEvents = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let baseUrl = "http://" <> defaultHost <> ":" <> show defaultPort
          url = baseUrl <> "/cirrus/search/event?event_name=eq.Shield&address=eq." <> T.unpack (normalizeAddress contractAddr)
      
      requestResult <- try $ parseRequest url
      case requestResult of
        Left (e :: SomeException) -> return $ Left $ "Failed to parse URL: " <> T.pack (show e)
        Right request -> do
          let requestWithHeaders = request { requestHeaders = [("Accept", "application/json")] }
          response <- authRequest requestWithHeaders
          let status = statusCode $ responseStatus response
          if status /= 200
            then return $ Left $ "HTTP error " <> T.pack (show status) <> ": " <> TE.decodeUtf8 (LBS.toStrict $ responseBody response)
            else case eitherDecode (responseBody response) of
              Left err -> return $ Left $ "JSON parse error: " <> T.pack err
              Right events -> return $ Right $ parseShieldEvents events

-- | Parse Shield events from JSON array
parseShieldEvents :: [Value] -> [ShieldEvent]
parseShieldEvents = mapMaybe parseShieldEvent

parseShieldEvent :: Value -> Maybe ShieldEvent
parseShieldEvent val = flip parseMaybe val $ \v -> do
  obj <- parseJSON v
  blockNumber <- obj .: "block_number"
  blockTimestamp <- obj .: "block_timestamp"
  txSender <- obj .: "transaction_sender"
  attrs <- obj .: "attributes"
  
  -- Parse attributes (they're stored as JSON strings in some cases)
  treeNumber <- parseIntField attrs "treeNumber"
  startPosition <- parseIntField attrs "startPosition"
  commitmentsStr <- attrs .: "commitments"
  ciphertextStr <- attrs .: "shieldCiphertext"
  feesStr <- attrs .: "fees"
  
  let commitments = parseCommitments commitmentsStr
      ciphertexts = parseCiphertexts ciphertextStr
      fees = parseFees feesStr
  
  return ShieldEvent
    { seBlockNumber = blockNumber
    , seBlockTimestamp = blockTimestamp
    , seTransactionSender = txSender
    , seTreeNumber = treeNumber
    , seStartPosition = startPosition
    , seCommitments = commitments
    , seCiphertexts = ciphertexts
    , seFees = fees
    }

parseIntField :: Object -> Key -> Parser Integer
parseIntField obj key = do
  val <- obj .: key
  case val of
    String s -> case readMaybe (T.unpack s) of
      Just n -> return n
      Nothing -> fail $ "Cannot parse integer from: " ++ T.unpack s
    Number n -> return $ round n
    _ -> fail "Expected string or number"

-- | Parse commitments from the string format
-- Format: "[CommitmentPreimage{\"npk\": \"...\", \"token\": {...}, \"value\": ...}]"
-- Note: The "CommitmentPreimage" prefix needs to be removed for valid JSON
parseCommitments :: Text -> [CommitmentData]
parseCommitments str = 
  -- Remove "CommitmentPreimage" prefix from each object
  let cleaned = T.replace "CommitmentPreimage{" "{" str
  in case extractJsonArray cleaned of
    Just arr -> mapMaybe parseCommitmentFromValue arr
    Nothing -> []

parseCommitmentFromValue :: Value -> Maybe CommitmentData
parseCommitmentFromValue val = flip parseMaybe val $ \v -> do
  obj <- parseJSON v
  npk <- obj .: "npk"
  tokenObj <- obj .: "token"
  tokenAddr <- tokenObj .: "tokenAddress"
  tokenType <- tokenObj .: "tokenType"
  tokenSubID <- tokenObj .: "tokenSubID"
  value <- obj .: "value"
  return CommitmentData
    { cdNpk = npk
    , cdTokenAddress = tokenAddr
    , cdTokenType = tokenType
    , cdTokenSubID = tokenSubID
    , cdValue = value
    }

-- | Parse ciphertexts from the string format
parseCiphertexts :: Text -> [CiphertextData]
parseCiphertexts str =
  case extractJsonArray str of
    Just arr -> mapMaybe parseCiphertextFromValue arr
    Nothing -> []

parseCiphertextFromValue :: Value -> Maybe CiphertextData
parseCiphertextFromValue val = flip parseMaybe val $ \v -> do
  obj <- parseJSON v
  bundle <- obj .: "encryptedBundle"
  key <- obj .: "shieldKey"
  return CiphertextData
    { ctEncryptedBundle = bundle
    , ctShieldKey = key
    }

-- | Parse fees from string format "[0, 1, ...]"
parseFees :: Text -> [Integer]
parseFees str =
  case extractJsonArray str of
    Just arr -> mapMaybe parseIntFromValue arr
    Nothing -> []

parseIntFromValue :: Value -> Maybe Integer
parseIntFromValue (Number n) = Just $ round n
parseIntFromValue (String s) = readMaybe (T.unpack s)
parseIntFromValue _ = Nothing

-- | Extract JSON array from a string that might have extra formatting
extractJsonArray :: Text -> Maybe [Value]
extractJsonArray str = 
  -- The string might be like "[{...}, {...}]" or have extra stuff
  let cleaned = T.strip str
      -- Find the first '[' and last ']'
      startIdx = T.findIndex (== '[') cleaned
      endIdx = T.findIndex (== ']') (T.reverse cleaned)
  in case (startIdx, endIdx) of
       (Just s, Just e) -> 
         let jsonStr = T.take (T.length cleaned - e) $ T.drop s cleaned
         in decode (LBS.fromStrict $ TE.encodeUtf8 jsonStr)
       _ -> Nothing

-- | Fetch all Nullified events from Cirrus (these indicate spent notes)
fetchNullifierEvents :: IO (Either Text [NullifiedEvent])
fetchNullifierEvents = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let baseUrl = "http://" <> defaultHost <> ":" <> show defaultPort
          url = baseUrl <> "/cirrus/search/event?event_name=eq.Nullified&address=eq." <> T.unpack (normalizeAddress contractAddr)
      
      requestResult <- try $ parseRequest url
      case requestResult of
        Left (e :: SomeException) -> return $ Left $ "Failed to parse URL: " <> T.pack (show e)
        Right request -> do
          let requestWithHeaders = request { requestHeaders = [("Accept", "application/json")] }
          response <- authRequest requestWithHeaders
          let status = statusCode $ responseStatus response
          if status /= 200
            then return $ Left $ "HTTP error " <> T.pack (show status)
            else case eitherDecode (responseBody response) of
              Left err -> return $ Left $ "JSON parse error: " <> T.pack err
              Right events -> return $ Right $ parseNullifierEvents events

-- | Parse Nullified events from JSON array
parseNullifierEvents :: [Value] -> [NullifiedEvent]
parseNullifierEvents = mapMaybe parseNullifierEvent

parseNullifierEvent :: Value -> Maybe NullifiedEvent
parseNullifierEvent val = flip parseMaybe val $ \v -> do
  obj <- parseJSON v
  attrs <- obj .: "attributes"
  
  treeNumber <- parseIntField attrs "treeNumber"
  nullifierStr <- attrs .: "nullifier"
  
  let nullifiers = parseNullifierList nullifierStr
  
  return NullifiedEvent
    { neTreeNumber = treeNumber
    , neNullifiers = nullifiers
    }

-- | Parse nullifier list from string format "[\"0x...\", \"0x...\"]"
parseNullifierList :: Text -> [Text]
parseNullifierList str =
  case extractJsonArray str of
    Just arr -> mapMaybe extractText arr
    Nothing -> []
  where
    extractText (String s) = Just $ normalizeAddress s
    extractText _ = Nothing

-- | Fetch all Transact events from Cirrus (for finding change notes)
fetchTransactEventsForNotes :: IO (Either Text [TransactEvent])
fetchTransactEventsForNotes = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let baseUrl = "http://" <> defaultHost <> ":" <> show defaultPort
          url = baseUrl <> "/cirrus/search/event?event_name=eq.Transact&address=eq." <> T.unpack (normalizeAddress contractAddr)
      
      requestResult <- try $ parseRequest url
      case requestResult of
        Left (e :: SomeException) -> return $ Left $ "Failed to parse URL: " <> T.pack (show e)
        Right request -> do
          let requestWithHeaders = request { requestHeaders = [("Accept", "application/json")] }
          response <- authRequest requestWithHeaders
          let status = statusCode $ responseStatus response
          if status /= 200
            then return $ Left $ "HTTP error " <> T.pack (show status)
            else case eitherDecode (responseBody response) of
              Left err -> return $ Left $ "JSON parse error: " <> T.pack err
              Right events -> return $ Right $ parseTransactEventsForNotes events

-- | Parse Transact events from JSON array
parseTransactEventsForNotes :: [Value] -> [TransactEvent]
parseTransactEventsForNotes = mapMaybe parseTransactEventForNotes

parseTransactEventForNotes :: Value -> Maybe TransactEvent
parseTransactEventForNotes val = flip parseMaybe val $ \v -> do
  obj <- parseJSON v
  blockNumber <- obj .: "block_number"
  attrs <- obj .: "attributes"
  
  treeNumber <- parseIntField attrs "treeNumber"
  startPosition <- parseIntField attrs "startPosition"
  hashStr <- attrs .: "hash"
  ciphertextStr <- attrs .: "ciphertext"
  
  let commitmentHashes = parseHashList hashStr
      ciphertexts = parseTransactCiphertexts ciphertextStr
  
  return TransactEvent
    { teBlockNumber = blockNumber
    , teTreeNumber = treeNumber
    , teStartPosition = startPosition
    , teCommitmentHashes = commitmentHashes
    , teCiphertexts = ciphertexts
    }

-- | Parse hash list from Transact event
parseHashList :: Text -> [Text]
parseHashList str =
  case extractJsonArray str of
    Just arr -> mapMaybe extractText arr
    Nothing -> []
  where
    extractText (String s) = Just $ normalizeAddress s
    extractText _ = Nothing

-- | Parse ciphertext array from Transact event
parseTransactCiphertexts :: Text -> [TransactCiphertext]
parseTransactCiphertexts str =
  -- The string may have CommitmentCiphertext prefix
  let cleaned = T.replace "CommitmentCiphertext" "" str
  in case extractJsonArray cleaned of
       Just arr -> mapMaybe parseTransactCiphertext arr
       Nothing -> []

parseTransactCiphertext :: Value -> Maybe TransactCiphertext
parseTransactCiphertext val = flip parseMaybe val $ \v -> do
  obj <- parseJSON v
  ciphertext <- obj .: "ciphertext"
  blindedSender <- obj .: "blindedSenderViewingKey"
  blindedReceiver <- obj .: "blindedReceiverViewingKey"
  return TransactCiphertext
    { tcCiphertext = ciphertext
    , tcBlindedSenderViewingKey = blindedSender
    , tcBlindedReceiverViewingKey = blindedReceiver
    }

-- | Try to decrypt a single note
tryDecryptNote :: RailgunKeys 
               -> CommitmentData 
               -> CiphertextData 
               -> Integer  -- ^ Tree position
               -> Text     -- ^ Block number
               -> Maybe ShieldedNote
tryDecryptNote keys commitment ciphertext treePos blockNum = do
  -- Parse the encrypted bundle
  bundle0 <- hexToBS =<< safeIndex (ctEncryptedBundle ciphertext) 0
  bundle1 <- hexToBS =<< safeIndex (ctEncryptedBundle ciphertext) 1
  shieldKey <- hexToBS $ ctShieldKey ciphertext
  
  -- Derive shared key via ECDH
  sharedKey <- getSharedSymmetricKey (viewingPrivateKey keys) shieldKey
  
  -- Decrypt the random value
  let encryptedRandom = BS.take 16 bundle1
  randomValue <- decryptRandom sharedKey bundle0 encryptedRandom
  
  -- Verify NPK matches
  let randomInt = bytesToInteger randomValue
      computedNpk = poseidonHash [masterPublicKey keys, randomInt]
      eventNpk = hexToInteger $ cdNpk commitment
  
  if computedNpk == eventNpk
    then Just ShieldedNote
      { snTokenAddress = cdTokenAddress commitment
      , snTokenType = intToTokenType $ cdTokenType commitment
      , snTokenSubID = cdTokenSubID commitment
      , snValue = cdValue commitment
      , snBlockNumber = blockNum
      , snTreePosition = treePos
      , snRandom = randomValue
      }
    else Nothing

safeIndex :: [a] -> Int -> Maybe a
safeIndex xs i
  | i < length xs = Just (xs !! i)
  | otherwise = Nothing

-- | Try to decrypt a note from a Transact event (for change notes)
-- Ciphertext format: 4 chunks of 32 bytes each
--   ct0 = IV (16 bytes) || first 16 bytes of encrypted data
--   ct1 = next 32 bytes of encrypted data
--   ct2 = next 32 bytes of encrypted data
--   ct3 = last 16 bytes of encrypted data || 16 bytes padding
-- Decrypted payload (96 bytes): npk (32) || token (32) || value (16) || random (16)
tryDecryptTransactNote :: RailgunKeys 
                       -> Text              -- ^ Commitment hash (to verify)
                       -> TransactCiphertext 
                       -> Integer           -- ^ Tree position
                       -> Text              -- ^ Block number
                       -> Maybe ShieldedNote
tryDecryptTransactNote keys commitmentHash ciphertext treePos blockNum =
  -- Try with sender key first (for change notes), then receiver key (for incoming notes)
  let senderKey = tcBlindedSenderViewingKey ciphertext
      receiverKey = tcBlindedReceiverViewingKey ciphertext
  in case tryWithKey senderKey of
    Just note -> Just note
    Nothing -> tryWithKey receiverKey
  where
    tryWithKey blindedKey = do
      -- Parse the ciphertext chunks
      ct0 <- hexToBS =<< safeIndex (tcCiphertext ciphertext) 0
      ct1 <- hexToBS =<< safeIndex (tcCiphertext ciphertext) 1
      ct2 <- hexToBS =<< safeIndex (tcCiphertext ciphertext) 2
      ct3 <- hexToBS =<< safeIndex (tcCiphertext ciphertext) 3
      
      -- Extract IV and encrypted data
      let iv = BS.take 16 ct0
          encryptedData = BS.drop 16 ct0 <> ct1 <> ct2 <> BS.take 16 ct3  -- 96 bytes
      
      -- Skip if key is all zeros
      blindedKeyBytes <- hexToBS blindedKey
      if BS.all (== 0) blindedKeyBytes
        then Nothing
        else do
          -- Derive shared key via ECDH
          sharedKey <- getSharedSymmetricKey (viewingPrivateKey keys) blindedKeyBytes
          
          -- Decrypt the full payload with AES-CTR
          let decrypted = aesDecryptCTR sharedKey iv encryptedData
          
          -- Parse decrypted data: npk (32) || token (32) || value (16) || random (16)
          let npkBytes = BS.take 32 decrypted
              tokenBytes = BS.take 32 $ BS.drop 32 decrypted
              valueBytes = BS.take 16 $ BS.drop 64 decrypted
              randomBytes' = BS.take 16 $ BS.drop 80 decrypted
              
              npkInt = bytesToInteger npkBytes
              -- Token is stored as 32-byte big-endian integer, address in LAST 20 bytes
              tokenAddr = T.toLower $ TE.decodeUtf8 $ B16.encode $ BS.drop 12 tokenBytes
              tokenId = hexToInteger tokenAddr
              valueInt = bytesToInteger valueBytes
              randomInt = bytesToInteger randomBytes'
              
              -- Verify NPK matches: npk should equal poseidon(masterPublicKey, random)
              expectedNpk = poseidonHash [masterPublicKey keys, randomInt]
              
              -- Verify commitment matches
              computedCommitment = poseidonHash [npkInt, tokenId, valueInt]
              eventCommitment = hexToInteger commitmentHash
          
          -- Note is ours if NPK matches AND commitment matches
          if npkInt == expectedNpk && computedCommitment == eventCommitment
            then Just ShieldedNote
              { snTokenAddress = tokenAddr
              , snTokenType = ERC20  -- Transact notes are always ERC20
              , snTokenSubID = 0
              , snValue = valueInt
              , snBlockNumber = blockNum
              , snTreePosition = treePos
              , snRandom = randomBytes'
              }
            else Nothing

-- | Try to decrypt all notes from a Transact event
tryDecryptTransactEvent :: RailgunKeys -> TransactEvent -> [ShieldedNote]
tryDecryptTransactEvent keys event =
  let hashes = teCommitmentHashes event
      ciphertexts = teCiphertexts event
      startPos = teStartPosition event
      blockNum = teBlockNumber event
      zipped = zip3 hashes ciphertexts [startPos..]
  in mapMaybe (\(h, ct, pos) -> tryDecryptTransactNote keys h ct pos blockNum) zipped

-- | Scan all Shield and Transact events and return notes that belong to us (excluding spent notes)
scanShieldedBalance :: RailgunKeys 
                    -> IO (Either Text ([ShieldedNote], [TokenBalance]))
scanShieldedBalance keys = do
  -- Fetch Shield events
  shieldEventsResult <- fetchShieldEvents
  case shieldEventsResult of
    Left err -> return $ Left err
    Right shieldEvents -> do
      -- Fetch Transact events (for change notes)
      transactEventsResult <- fetchTransactEventsForNotes
      let transactEvents = case transactEventsResult of
            Left _ -> []
            Right evts -> evts
      
      -- Fetch Nullified events to find spent notes
      nullifierResult <- fetchNullifierEvents
      let spentNullifiers = case nullifierResult of
            Left _ -> Set.empty  -- If we can't fetch, assume none spent
            Right nullEvents -> Set.fromList $ concatMap neNullifiers nullEvents
      
      -- Decrypt all notes from Shield events
      let shieldNotes = concatMap (tryDecryptEvent keys) shieldEvents
          -- Decrypt all notes from Transact events (change notes)
          transactNotes = concatMap (tryDecryptTransactEvent keys) transactEvents
          allNotes = shieldNotes ++ transactNotes
          
          -- Filter out spent notes by computing nullifiers
          nullifierKeyInt = bytesToInteger $ nullifierKey keys
          isNotSpent note = 
            let nullifier = computeNullifier nullifierKeyInt (snTreePosition note)
                nullifierHex = T.toLower $ integerToHex32 nullifier
            in not $ Set.member nullifierHex spentNullifiers
          
          unspentNotes = filter isNotSpent allNotes
          balances = aggregateBalances unspentNotes
      
      return $ Right (unspentNotes, balances)

-- | Convert an integer to a 32-byte hex string (lowercase, no 0x prefix)
integerToHex32 :: Integer -> Text
integerToHex32 n =
  let hexStr = T.pack $ printf "%064x" n
  in T.toLower hexStr

-- | Try to decrypt all notes in a single event
tryDecryptEvent :: RailgunKeys -> ShieldEvent -> [ShieldedNote]
tryDecryptEvent keys event =
  let commitments = seCommitments event
      ciphertexts = seCiphertexts event
      startPos = seStartPosition event
      blockNum = seBlockNumber event
      -- Zip commitments with ciphertexts and positions
      zipped = zip3 commitments ciphertexts [startPos..]
  in mapMaybe (\(c, ct, pos) -> tryDecryptNote keys c ct pos blockNum) zipped

-- | Aggregate notes into balances by token
aggregateBalances :: [ShieldedNote] -> [TokenBalance]
aggregateBalances notes = Map.elems $ foldl' addNote Map.empty notes
  where
    addNote :: Map Text TokenBalance -> ShieldedNote -> Map Text TokenBalance
    addNote m note = 
      let key = snTokenAddress note
          existing = Map.lookup key m
          newBal = case existing of
            Nothing -> TokenBalance
              { tbTokenAddress = snTokenAddress note
              , tbTokenType = snTokenType note
              , tbTotalValue = snValue note
              , tbNoteCount = 1
              }
            Just tb -> tb
              { tbTotalValue = tbTotalValue tb + snValue note
              , tbNoteCount = tbNoteCount tb + 1
              }
      in Map.insert key newBal m

-- Helper functions
normalizeAddress :: Text -> Text
normalizeAddress t
  | "0x" `T.isPrefixOf` T.toLower t = T.toLower $ T.drop 2 t
  | otherwise = T.toLower t

hexToBS :: Text -> Maybe ByteString
hexToBS t = case B16.decode (TE.encodeUtf8 $ normalizeAddress t) of
  Right bs -> Just bs
  Left _ -> Nothing

bytesToInteger :: ByteString -> Integer
bytesToInteger = BS.foldl' (\acc b -> acc * 256 + fromIntegral b) 0

hexToInteger :: Text -> Integer
hexToInteger t = case hexToBS t of
  Just bs -> bytesToInteger bs
  Nothing -> 0

intToTokenType :: Int -> TokenType
intToTokenType 0 = ERC20
intToTokenType 1 = ERC721
intToTokenType 2 = ERC1155
intToTokenType _ = ERC20
