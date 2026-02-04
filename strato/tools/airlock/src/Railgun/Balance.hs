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

import Railgun.Crypto (getSharedSymmetricKey, decryptRandom, poseidonHash)
import Railgun.Types (RailgunKeys(..), TokenType(..))

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

-- | Fetch all Shield events from Cirrus
fetchShieldEvents :: Text -> Text -> Text -> IO (Either Text [ShieldEvent])
fetchShieldEvents baseUrl authToken contractAddr = do
  manager <- newManager defaultManagerSettings
  
  let url = T.unpack baseUrl <> "/cirrus/search/event?event_name=eq.Shield&address=eq." <> T.unpack (normalizeAddress contractAddr)
  
  requestResult <- try $ parseRequest url
  case requestResult of
    Left (e :: SomeException) -> return $ Left $ "Failed to parse URL: " <> T.pack (show e)
    Right request -> do
      let requestWithAuth = request
            { requestHeaders = 
                [ ("Authorization", TE.encodeUtf8 $ "Bearer " <> authToken)
                , ("Accept", "application/json")
                ]
            }
      
      responseResult <- try $ httpLbs requestWithAuth manager
      case responseResult of
        Left (e :: SomeException) -> return $ Left $ "HTTP request failed: " <> T.pack (show e)
        Right response -> do
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

-- | Scan all Shield events and return notes that belong to us
scanShieldedBalance :: RailgunKeys 
                    -> Text  -- ^ Base URL
                    -> Text  -- ^ Auth token
                    -> Text  -- ^ Railgun contract address
                    -> IO (Either Text ([ShieldedNote], [TokenBalance]))
scanShieldedBalance keys baseUrl authToken contractAddr = do
  eventsResult <- fetchShieldEvents baseUrl authToken contractAddr
  case eventsResult of
    Left err -> return $ Left err
    Right events -> do
      let notes = concatMap (tryDecryptEvent keys) events
          balances = aggregateBalances notes
      return $ Right (notes, balances)

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
