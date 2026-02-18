{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE RecordWildCards #-}

module Railgun.Merkle
  ( -- * Types
    MerkleProof(..)
  , MerkleTreeData(..)
    -- * Fetching
  , fetchMerkleTreeData
    -- * Proof computation
  , computeMerkleProof
  , verifyMerkleProof
    -- * Constants
  , treeDepth
  , zeroValue
  ) where

import Data.Aeson ((.:), Value(..))
import Data.Aeson.Types (parseMaybe, Parser)
import qualified Data.Aeson as Aeson
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe, mapMaybe)
import Data.List (sortBy)
import Data.Function (on)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Network.HTTP.Client (parseRequest, requestHeaders, responseBody)

import Railgun.Crypto (poseidonHash)
import Railgun.API (readContractAddress, defaultHost, defaultPort)
import Strato.Auth (authRequest)

-- | Tree depth (16 levels for Railgun)
treeDepth :: Int
treeDepth = 16

-- | Zero value for empty leaves (Railgun's ZERO_VALUE constant)
-- keccak256("Railgun") % SNARK_SCALAR_FIELD
zeroValue :: Integer
zeroValue = 0x0bcf836f71425248d42e157d21692d3ee27f5229c40af4751731597bdaba2962

-- | Merkle proof for a leaf
data MerkleProof = MerkleProof
  { mpLeafIndex :: Integer           -- ^ Position of leaf in tree
  , mpSiblings :: [Integer]          -- ^ Sibling hashes at each level (bottom to top)
  , mpPathIndices :: [Int]           -- ^ 0 = left, 1 = right at each level
  } deriving (Show, Eq)

-- | Data needed to compute Merkle proofs
data MerkleTreeData = MerkleTreeData
  { mtdZeros :: Map Int Integer           -- ^ Zero values at each level
  , mtdFilledSubTrees :: Map Int Integer  -- ^ Filled subtrees at each level
  , mtdCommitments :: [(Integer, Integer)] -- ^ (index, commitment hash)
  , mtdNextLeafIndex :: Integer           -- ^ Next available leaf position
  } deriving (Show, Eq)

-- | Fetch Merkle tree data from Cirrus
fetchMerkleTreeData :: IO (Either Text MerkleTreeData)
fetchMerkleTreeData = do
  -- Fetch zeros from mapping table
  zerosResult <- fetchMapping "zeros"
  case zerosResult of
    Left err -> return $ Left $ "Failed to fetch zeros: " <> err
    Right zeros -> do
      -- Fetch filledSubTrees from mapping table
      filledResult <- fetchMapping "filledSubTrees"
      case filledResult of
        Left err -> return $ Left $ "Failed to fetch filledSubTrees: " <> err
        Right filled -> do
          -- Fetch commitments from Shield events
          commitmentsResult <- fetchCommitments
          case commitmentsResult of
            Left err -> return $ Left $ "Failed to fetch commitments: " <> err
            Right commitments -> do
              -- Fetch nextLeafIndex from storage
              nextIndexResult <- fetchNextLeafIndex
              case nextIndexResult of
                Left err -> return $ Left $ "Failed to fetch nextLeafIndex: " <> err
                Right nextIndex ->
                  return $ Right MerkleTreeData
                    { mtdZeros = zeros
                    , mtdFilledSubTrees = filled
                    , mtdCommitments = commitments
                    , mtdNextLeafIndex = nextIndex
                    }

-- | Fetch a mapping array from Cirrus
fetchMapping :: Text -> IO (Either Text (Map Int Integer))
fetchMapping collectionName = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let baseUrl = "http://" ++ defaultHost ++ ":" ++ show defaultPort
          url = baseUrl ++ "/cirrus/search/mapping?address=eq." ++ T.unpack contractAddr 
                ++ "&collection_name=eq." ++ T.unpack collectionName
      request <- parseRequest url
      let requestWithHeaders = request { requestHeaders = [("Accept", "application/json")] }
      response <- authRequest requestWithHeaders
      case Aeson.eitherDecode (responseBody response) of
        Left err -> return $ Left $ T.pack err
        Right (results :: [Value]) -> 
          return $ Right $ Map.fromList $ mapMaybe extractIndexValue results
  where
    extractIndexValue :: Value -> Maybe (Int, Integer)
    extractIndexValue v = parseMaybe parseEntry v
    
    parseEntry :: Value -> Parser (Int, Integer)
    parseEntry v = do
      obj <- Aeson.parseJSON v
      keyObj <- obj .: "key"
      indexStr <- keyObj .: "key"
      valueHex <- obj .: "value"
      let index = read indexStr :: Int
          value = hexToInteger valueHex
      return (index, value)

-- | Fetch commitments from Shield events
fetchCommitments :: IO (Either Text [(Integer, Integer)])
fetchCommitments = do
  -- Fetch from Shield events (initial deposits)
  shieldResult <- fetchShieldCommitments
  -- Fetch from Transact events (transfers/unshields that create change outputs)
  transactResult <- fetchTransactCommitments
  
  case (shieldResult, transactResult) of
    (Left err, _) -> return $ Left err
    (_, Left err) -> return $ Left err
    (Right shieldCommits, Right transactCommits) ->
      -- Sort by position to ensure correct ordering
      return $ Right $ sortBy (compare `on` fst) (shieldCommits ++ transactCommits)

-- | Fetch commitments from Shield events
fetchShieldCommitments :: IO (Either Text [(Integer, Integer)])
fetchShieldCommitments = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let baseUrl = "http://" ++ defaultHost ++ ":" ++ show defaultPort
          url = baseUrl ++ "/cirrus/search/event?address=eq." ++ T.unpack contractAddr 
                ++ "&event_name=eq.Shield&order=block_number"
      request <- parseRequest url
      let requestWithHeaders = request { requestHeaders = [("Accept", "application/json")] }
      response <- authRequest requestWithHeaders
      case Aeson.eitherDecode (responseBody response) of
        Left err -> return $ Left $ T.pack err
        Right (results :: [Value]) -> do
          let commitmentsList = concatMap extractShieldCommitments results
          return $ Right commitmentsList
  where
    extractShieldCommitments :: Value -> [(Integer, Integer)]
    extractShieldCommitments v = fromMaybe [] $ parseMaybe parseShieldEvent v
    
    parseShieldEvent :: Value -> Parser [(Integer, Integer)]
    parseShieldEvent v = do
      obj <- Aeson.parseJSON v
      attrs <- obj .: "attributes"
      startPosStr <- attrs .: "startPosition"
      commitmentsStr <- attrs .: "commitments"
      let startPos = read (T.unpack startPosStr) :: Integer
          -- Parse commitments array from the string representation
          commitments = parseCommitmentsArray commitmentsStr
      return $ zip [startPos..] commitments
    
    -- Parse the commitments JSON string to extract commitment hashes
    parseCommitmentsArray :: Text -> [Integer]
    parseCommitmentsArray str =
      -- The commitments string contains CommitmentPreimage objects
      -- We need to extract the fields and compute the commitment hash
      -- commitment = poseidon(npk, tokenId, value)
      case extractCommitmentHashes str of
        Just hashes -> hashes
        Nothing -> []

-- | Fetch commitments from Transact events (these contain commitment hashes directly)
fetchTransactCommitments :: IO (Either Text [(Integer, Integer)])
fetchTransactCommitments = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let baseUrl = "http://" ++ defaultHost ++ ":" ++ show defaultPort
          url = baseUrl ++ "/cirrus/search/event?address=eq." ++ T.unpack contractAddr 
                ++ "&event_name=eq.Transact&order=block_number"
      request <- parseRequest url
      let requestWithHeaders = request { requestHeaders = [("Accept", "application/json")] }
      response <- authRequest requestWithHeaders
      case Aeson.eitherDecode (responseBody response) of
        Left err -> return $ Left $ T.pack err
        Right (results :: [Value]) -> do
          let commitmentsList = concatMap extractTransactCommitments results
          return $ Right commitmentsList
  where
    extractTransactCommitments :: Value -> [(Integer, Integer)]
    extractTransactCommitments v = fromMaybe [] $ parseMaybe parseTransactEvent v
    
    parseTransactEvent :: Value -> Parser [(Integer, Integer)]
    parseTransactEvent v = do
      obj <- Aeson.parseJSON v
      attrs <- obj .: "attributes"
      startPosStr <- attrs .: "startPosition"
      hashStr <- attrs .: "hash"  -- Transact events have "hash" array with commitment hashes
      let startPos = read (T.unpack startPosStr) :: Integer
          -- Parse hash array - these are bytes32 hex strings
          hashes = parseHashArray hashStr
      return $ zip [startPos..] hashes
    
    -- Parse the hash array from Transact event
    parseHashArray :: Text -> [Integer]
    parseHashArray str =
      case Aeson.decodeStrict (TE.encodeUtf8 str) of
        Just (arr :: [Text]) -> map hexToInteger arr
        Nothing -> []

-- | Extract commitment hashes from the commitments JSON string
-- commitment = poseidon(npk, tokenId, value)
extractCommitmentHashes :: Text -> Maybe [Integer]
extractCommitmentHashes str = 
  -- The string looks like: [CommitmentPreimage{"npk": "xxx", "token": {...}, "value": n}]
  let cleanStr = T.replace "CommitmentPreimage" "" str
  in case Aeson.decodeStrict (TE.encodeUtf8 cleanStr) of
       Just (arr :: [Value]) -> Just $ mapMaybe extractCommitmentHash arr
       Nothing -> Nothing
  where
    extractCommitmentHash :: Value -> Maybe Integer
    extractCommitmentHash v = parseMaybe parseCommitment v
    
    parseCommitment :: Value -> Parser Integer
    parseCommitment v = do
      obj <- Aeson.parseJSON v
      npkHex <- obj .: "npk"
      let npk = hexToInteger npkHex
      -- Get token info
      tokenObj <- obj .: "token"
      tokenAddrHex <- tokenObj .: "tokenAddress"
      let tokenId = hexToInteger tokenAddrHex  -- For ERC20, tokenId is just the address
      -- Get value
      valueVal <- obj .: "value"
      value <- case valueVal of
        Number n -> return $ round n
        String s -> return $ read (T.unpack s)
        _ -> fail "Invalid value type"
      -- Compute commitment hash: poseidon(npk, tokenId, value)
      return $ poseidonHash [npk, tokenId, value]

-- | Fetch nextLeafIndex from storage
fetchNextLeafIndex :: IO (Either Text Integer)
fetchNextLeafIndex = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let baseUrl = "http://" ++ defaultHost ++ ":" ++ show defaultPort
          url = baseUrl ++ "/cirrus/search/storage?address=eq." ++ T.unpack contractAddr
      request <- parseRequest url
      let requestWithHeaders = request { requestHeaders = [("Accept", "application/json")] }
      response <- authRequest requestWithHeaders
      case Aeson.eitherDecode (responseBody response) of
        Left err -> return $ Left $ T.pack err
        Right (results :: [Value]) -> 
          case results of
            [] -> return $ Left "No storage found"
            (r:_) -> case parseMaybe extractNextLeafIndex r of
              Nothing -> return $ Right 0
              Just idx -> return $ Right idx
  where
    extractNextLeafIndex :: Value -> Parser Integer
    extractNextLeafIndex v = do
      obj <- Aeson.parseJSON v
      dataObj <- obj .: "data"
      nextLeafStr <- dataObj .: "nextLeafIndex"
      return $ if T.null nextLeafStr then 0 else read (T.unpack nextLeafStr)

-- | Compute Merkle proof for a leaf at given index
computeMerkleProof :: MerkleTreeData -> Integer -> Either Text MerkleProof
computeMerkleProof treeData leafIndex
  | leafIndex < 0 || leafIndex >= mtdNextLeafIndex treeData = 
      Left $ "Leaf index " <> T.pack (show leafIndex) <> " out of range"
  | otherwise = Right $ computeProofPath treeData leafIndex

-- | Compute the proof path (siblings and path indices)
computeProofPath :: MerkleTreeData -> Integer -> MerkleProof
computeProofPath MerkleTreeData{..} leafIndex =
  let -- Build the tree from leaves
      leafMap = Map.fromList mtdCommitments
      
      -- Build all tree nodes (level -> index -> value)
      -- Level 0 is leaves, level 16 is root
      treeNodes = buildTree leafMap
      
      -- Compute siblings at each level
      (siblings, pathIndices) = unzip $ map (computeLevelSibling treeNodes) [0..treeDepth-1]
      
  in MerkleProof
       { mpLeafIndex = leafIndex
       , mpSiblings = siblings
       , mpPathIndices = pathIndices
       }
  where
    -- Build tree nodes from leaves up to root
    buildTree :: Map Integer Integer -> Map (Int, Integer) Integer
    buildTree leaves =
      let -- Initialize level 0 with leaves
          level0 = Map.fromList [((0, idx), val) | (idx, val) <- Map.toList leaves]
          -- Build higher levels
      in foldl buildLevel level0 [1..treeDepth]
    
    buildLevel :: Map (Int, Integer) Integer -> Int -> Map (Int, Integer) Integer
    buildLevel nodeMap level =
      let prevLevel = level - 1
          -- Get max index at previous level (sparse, so just check up to nextLeafIndex)
          maxIdx = (mtdNextLeafIndex - 1) `div` (2 ^ prevLevel)
          -- Compute nodes at this level
          newNodes = [((level, idx `div` 2), computeNode nodeMap prevLevel idx) 
                     | idx <- [0, 2 .. maxIdx + 1], idx `div` 2 <= maxIdx `div` 2]
      in Map.union (Map.fromList newNodes) nodeMap
    
    computeNode :: Map (Int, Integer) Integer -> Int -> Integer -> Integer
    computeNode nodeMap level pairStartIdx =
      let leftIdx = pairStartIdx
          rightIdx = pairStartIdx + 1
          leftVal = Map.findWithDefault (getZero level) (level, leftIdx) nodeMap
          rightVal = Map.findWithDefault (getZero level) (level, rightIdx) nodeMap
      in poseidonHash [leftVal, rightVal]
    
    computeLevelSibling :: Map (Int, Integer) Integer -> Int -> (Integer, Int)
    computeLevelSibling nodes level =
      let -- Index at this level
          levelIndex = leafIndex `div` (2 ^ level)
          -- Is this node a left or right child?
          isRight = (levelIndex `mod` 2) == 1
          -- Sibling index
          siblingIndex = if isRight then levelIndex - 1 else levelIndex + 1
          -- Get sibling value
          siblingValue = Map.findWithDefault (getZero level) (level, siblingIndex) nodes
      in (siblingValue, if isRight then 1 else 0)
    
    getZero :: Int -> Integer
    getZero level = fromMaybe (computeZeroAtLevel level) (Map.lookup level mtdZeros)
    
    computeZeroAtLevel :: Int -> Integer
    computeZeroAtLevel 0 = zeroValue
    computeZeroAtLevel n = 
      let prevZero = computeZeroAtLevel (n - 1)
      in poseidonHash [prevZero, prevZero]

-- | Verify a Merkle proof
verifyMerkleProof :: Integer -> MerkleProof -> Integer -> Bool
verifyMerkleProof leafValue MerkleProof{..} expectedRoot =
  let computedRoot = foldl computeLevel leafValue (zip mpSiblings mpPathIndices)
  in computedRoot == expectedRoot
  where
    computeLevel :: Integer -> (Integer, Int) -> Integer
    computeLevel current (sibling, pathIdx) =
      if pathIdx == 0
        then poseidonHash [current, sibling]  -- current is left child
        else poseidonHash [sibling, current]  -- current is right child

-- | Convert hex text to Integer
hexToInteger :: Text -> Integer
hexToInteger t =
  let cleanHex = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 t else t
  in case B16.decode (TE.encodeUtf8 cleanHex) of
       Right bs -> bytesToInteger bs
       Left _ -> 0

bytesToInteger :: ByteString -> Integer
bytesToInteger = BS.foldl' (\acc b -> acc * 256 + fromIntegral b) 0
