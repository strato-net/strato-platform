{-# LANGUAGE OverloadedStrings #-}

module Railgun.BIP39
  ( generateMnemonic
  , entropyToMnemonic
  , loadWordList
  ) where

import Crypto.Hash (Digest, SHA256, hash)
import Crypto.Random (getRandomBytes)

import Data.Bits (shiftL, (.|.), testBit)
import Data.ByteArray (convert)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import Data.Vector (Vector, (!))
import qualified Data.Vector as V
import System.FilePath ((</>))

import Paths_airlock (getDataDir)

-- | Load the BIP39 English word list from the data directory.
loadWordList :: IO (Vector Text)
loadWordList = do
  dataDir <- getDataDir
  contents <- TIO.readFile (dataDir </> "data" </> "english.txt")
  let words' = V.fromList $ filter (not . T.null) $ map T.strip $ T.lines contents
  if V.length words' /= 2048
    then error $ "BIP39 word list has " ++ show (V.length words') ++ " words, expected 2048"
    else return words'

-- | Generate a BIP39 mnemonic phrase with the given number of words.
--
-- Generates cryptographically random entropy, computes the SHA-256 checksum,
-- and encodes the result as words from the standard English word list.
--
-- Valid word counts: 12, 15, 18, 21, 24
generateMnemonic :: Int -> IO (Either Text Text)
generateMnemonic wordCount = do
  case wordCountToEntropyBytes wordCount of
    Nothing -> return $ Left $ "Invalid word count: " <> T.pack (show wordCount)
                             <> ". Must be 12, 15, 18, 21, or 24."
    Just entropyLen -> do
      wordList <- loadWordList
      entropy <- getRandomBytes entropyLen
      return $ entropyToMnemonic wordList entropy

-- | Convert raw entropy bytes to a mnemonic phrase.
--
-- BIP39 algorithm:
--   1. SHA-256 hash the entropy for checksum
--   2. Append first (entropy_bits / 32) checksum bits to entropy
--   3. Split into 11-bit groups
--   4. Each group is an index into the 2048-word list
entropyToMnemonic :: Vector Text -> ByteString -> Either Text Text
entropyToMnemonic wordList entropy
  | V.length wordList /= 2048 = Left "Word list must have exactly 2048 entries"
  | entropyBits `mod` 32 /= 0 = Left "Entropy must be a multiple of 4 bytes"
  | entropyBits < 128 || entropyBits > 256 = Left "Entropy must be 128-256 bits"
  | otherwise = Right $ T.unwords $ map (wordList !) indices
  where
    entropyBits = BS.length entropy * 8
    checksumBits = entropyBits `div` 32
    checksumByte = BS.head $ convert (hash entropy :: Digest SHA256)
    totalBits = toBitList entropy ++ take checksumBits (byteToBits checksumByte)
    indices = map bitsToIndex (chunksOf 11 totalBits)

-- | Number of entropy bytes needed for a given word count.
wordCountToEntropyBytes :: Int -> Maybe Int
wordCountToEntropyBytes 12 = Just 16
wordCountToEntropyBytes 15 = Just 20
wordCountToEntropyBytes 18 = Just 24
wordCountToEntropyBytes 21 = Just 28
wordCountToEntropyBytes 24 = Just 32
wordCountToEntropyBytes _  = Nothing

-- | Convert a ByteString to a list of bits (MSB first).
toBitList :: ByteString -> [Bool]
toBitList = concatMap byteToBits . BS.unpack

-- | Convert a byte to 8 bits (MSB first).
byteToBits :: (Integral a) => a -> [Bool]
byteToBits b = [testBit (fromIntegral b :: Int) (7 - i) | i <- [0..7]]

-- | Convert a list of bits (MSB first) to an Int index.
bitsToIndex :: [Bool] -> Int
bitsToIndex = foldl (\acc bit -> acc `shiftL` 1 .|. (if bit then 1 else 0)) 0

-- | Split a list into chunks of a given size.
chunksOf :: Int -> [a] -> [[a]]
chunksOf _ [] = []
chunksOf n xs = let (h, t) = splitAt n xs in h : chunksOf n t
