{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Railgun.API
  ( -- * STRATO API interaction
    callShield
  , callTransact
  , approveToken
  , getChainId
  , getMerkleRoot
  , getTreeNumber
    -- * Configuration
  , StratoConfig(..)
  , defaultConfig
  ) where

import Bloc.API (FunctionPayload(..), PostBlocTransactionRequest(..), BlocTransactionPayload(..), BlocTransactionResult(..))
import Bloc.Client (postBlocTransactionParallelExternal)
import BlockApps.Solidity.ArgValue (ArgValue(..))
import Blockchain.Strato.Model.Address (Address(..))
import qualified Data.Aeson.KeyMap as KM
import qualified Data.ByteString.Base16 as B16
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import qualified Data.Vector as V
import Data.Aeson (eitherDecode, parseJSON, (.:), Value)
import Data.Aeson.Types (parseMaybe, Parser)
import Network.HTTP.Client (newManager, defaultManagerSettings, httpLbs, parseRequest, requestHeaders, responseBody)
import Servant.Client (BaseUrl(..), Scheme(..), ClientEnv(..), mkClientEnv, runClientM, defaultMakeClientRequest)
import Servant.Client.Core (addHeader)

import Railgun.Types (ShieldRequest(..), CommitmentPreimage(..), ShieldCiphertext(..), TokenData(..), TokenType(..), integerToHex32, encryptedBundleToHexList)
import Railgun.Unshield (UnshieldRequest(..), Transaction(..), SnarkProof(..), G1Point(..), G2Point(..), BoundParams(..), UnshieldType(..))

-- | STRATO API configuration
data StratoConfig = StratoConfig
  { stratoHost :: Text              -- ^ e.g., "localhost"
  , stratoPort :: Int               -- ^ e.g., 8081
  , stratoAuthToken :: Text         -- ^ OAuth bearer token
  , railgunContractAddress :: Text  -- ^ RailgunSmartWallet proxy address
  } deriving (Show, Eq)

-- | Default configuration for local jimtest
defaultConfig :: StratoConfig
defaultConfig = StratoConfig
  { stratoHost = "localhost"
  , stratoPort = 8081
  , stratoAuthToken = ""  -- Must be set from .token file
  , railgunContractAddress = "95be101d075f44084ca1cf51d0106c8606773952"
  }

-- | Create a servant-client environment with custom headers for nginx CSRF bypass
makeClientEnv :: StratoConfig -> IO ClientEnv
makeClientEnv config = do
  manager <- newManager defaultManagerSettings
  let baseUrl = BaseUrl Http (T.unpack $ stratoHost config) (stratoPort config) "/strato-api/bloc/v2.2"
      env = mkClientEnv manager baseUrl
      -- Add headers to bypass nginx CSRF protection
      customMakeRequest burl req = defaultMakeClientRequest burl 
        $ addHeader "User-Agent" ("curl/7.81.0" :: T.Text)
        $ addHeader "Accept" ("*/*" :: T.Text)
        $ req
  pure $ env { makeClientRequest = customMakeRequest }

-- | Convert Address text to Address type  
textToAddress :: Text -> Address
textToAddress t = 
  let hex = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 t else t
  in Address $ read ("0x" ++ T.unpack hex)

-- | Call the shield function on the Railgun contract
callShield :: StratoConfig 
           -> [ShieldRequest]  -- ^ Shield requests (can batch multiple)
           -> IO (Either Text [BlocTransactionResult])
callShield config shieldReqs = do
  clientEnv <- makeClientEnv config
  
  let contractAddr = textToAddress (railgunContractAddress config)
      args = Map.singleton "_shieldRequests" (shieldRequestsToArgValue shieldReqs)
      
      payload = BlocFunction $ FunctionPayload
        { functionpayloadContractAddress = contractAddr
        , functionpayloadMethod = "shield"
        , functionpayloadArgs = args
        , functionpayloadTxParams = Nothing
        , functionpayloadMetadata = Nothing
        }
      
      request = PostBlocTransactionRequest
        { postbloctransactionrequestAddress = Nothing
        , postbloctransactionrequestTxs = [payload]
        , postbloctransactionrequestTxParams = Nothing
        , postbloctransactionrequestSrcs = Nothing
        }
      
      authHeader = Just $ "Bearer " <> stratoAuthToken config
  
  result <- runClientM (postBlocTransactionParallelExternal authHeader Nothing True request) clientEnv
  pure $ case result of
    Left err -> Left $ T.pack $ show err
    Right txResults -> Right txResults

-- | Call the transact function on the Railgun contract (for unshield/transfer)
callTransact :: StratoConfig 
             -> UnshieldRequest  -- ^ Unshield request with transactions
             -> IO (Either Text [BlocTransactionResult])
callTransact config unshieldReq = do
  clientEnv <- makeClientEnv config
  
  let contractAddr = textToAddress (railgunContractAddress config)
      args = Map.singleton "_transactions" (transactionsToArgValue (urTransactions unshieldReq))
      
      payload = BlocFunction $ FunctionPayload
        { functionpayloadContractAddress = contractAddr
        , functionpayloadMethod = "transact"
        , functionpayloadArgs = args
        , functionpayloadTxParams = Nothing
        , functionpayloadMetadata = Nothing
        }
      
      request = PostBlocTransactionRequest
        { postbloctransactionrequestAddress = Nothing
        , postbloctransactionrequestTxs = [payload]
        , postbloctransactionrequestTxParams = Nothing
        , postbloctransactionrequestSrcs = Nothing
        }
      
      authHeader = Just $ "Bearer " <> stratoAuthToken config
  
  result <- runClientM (postBlocTransactionParallelExternal authHeader Nothing True request) clientEnv
  pure $ case result of
    Left err -> Left $ T.pack $ show err
    Right txResults -> Right txResults

-- | Approve token spending for the Railgun contract
approveToken :: StratoConfig
             -> Text      -- ^ Token contract address
             -> Integer   -- ^ Amount to approve
             -> IO (Either Text [BlocTransactionResult])
approveToken config tokenAddr amount = do
  clientEnv <- makeClientEnv config
  
  let contractAddr = textToAddress tokenAddr
      args = Map.fromList
        [ ("spender", ArgString $ railgunContractAddress config)
        , ("amount", ArgString $ T.pack $ show amount)
        ]
      
      payload = BlocFunction $ FunctionPayload
        { functionpayloadContractAddress = contractAddr
        , functionpayloadMethod = "approve"
        , functionpayloadArgs = args
        , functionpayloadTxParams = Nothing
        , functionpayloadMetadata = Nothing
        }
      
      request = PostBlocTransactionRequest
        { postbloctransactionrequestAddress = Nothing
        , postbloctransactionrequestTxs = [payload]
        , postbloctransactionrequestTxParams = Nothing
        , postbloctransactionrequestSrcs = Nothing
        }
      
      authHeader = Just $ "Bearer " <> stratoAuthToken config
  
  result <- runClientM (postBlocTransactionParallelExternal authHeader Nothing True request) clientEnv
  pure $ case result of
    Left err -> Left $ T.pack $ show err
    Right txResults -> Right txResults

-- | Convert ShieldRequests to ArgValue for the API
shieldRequestsToArgValue :: [ShieldRequest] -> ArgValue
shieldRequestsToArgValue reqs = ArgArray $ V.fromList $ map shieldRequestToArgValue reqs

shieldRequestToArgValue :: ShieldRequest -> ArgValue
shieldRequestToArgValue ShieldRequest{..} = ArgObject $ KM.fromList
  [ ("preimage", preimageToArgValue srPreimage)
  , ("ciphertext", ciphertextToArgValue srCiphertext)
  ]

preimageToArgValue :: CommitmentPreimage -> ArgValue
preimageToArgValue CommitmentPreimage{..} = ArgObject $ KM.fromList
  [ ("npk", ArgString $ integerToHex32 cpNpk)
  , ("token", tokenToArgValue cpToken)
  , ("value", ArgString $ T.pack $ show cpValue)
  ]

tokenToArgValue :: TokenData -> ArgValue
tokenToArgValue TokenData{..} = ArgObject $ KM.fromList
  [ ("tokenType", ArgString $ tokenTypeToString tokenType)
  , ("tokenAddress", ArgString tokenAddress)  -- Already normalized (no 0x prefix)
  , ("tokenSubID", ArgString $ T.pack $ show tokenSubID)
  ]
  where
    tokenTypeToString ERC20 = "ERC20"
    tokenTypeToString ERC721 = "ERC721"
    tokenTypeToString ERC1155 = "ERC1155"

ciphertextToArgValue :: ShieldCiphertext -> ArgValue
ciphertextToArgValue ShieldCiphertext{..} = ArgObject $ KM.fromList
  [ ("encryptedBundle", ArgArray $ V.fromList $ map ArgString $ encryptedBundleToHexList scEncryptedBundle)
  , ("shieldKey", ArgString $ TE.decodeUtf8 $ B16.encode scShieldKey)
  ]

-- | Convert Transactions to ArgValue for the API
transactionsToArgValue :: [Transaction] -> ArgValue
transactionsToArgValue txs = ArgArray $ V.fromList $ map transactionToArgValue txs

transactionToArgValue :: Transaction -> ArgValue
transactionToArgValue Transaction{..} = ArgObject $ KM.fromList
  [ ("proof", proofToArgValue txProof)
  , ("merkleRoot", ArgString $ bytesToHexText txMerkleRoot)
  , ("nullifiers", ArgArray $ V.fromList $ map (ArgString . bytesToHexText) txNullifiers)
  , ("commitments", ArgArray $ V.fromList $ map (ArgString . bytesToHexText) txCommitments)
  , ("boundParams", boundParamsToArgValue txBoundParams)
  , ("unshieldPreimage", preimageToArgValue txUnshieldPreimage)
  ]
  where
    bytesToHexText bs = TE.decodeUtf8 $ B16.encode bs

proofToArgValue :: SnarkProof -> ArgValue
proofToArgValue SnarkProof{..} = ArgObject $ KM.fromList
  [ ("a", g1ToArgValue proofA)
  , ("b", g2ToArgValue proofB)
  , ("c", g1ToArgValue proofC)
  ]

g1ToArgValue :: G1Point -> ArgValue
g1ToArgValue (G1Point x y) = ArgObject $ KM.fromList
  [ ("x", ArgString $ T.pack $ show x)
  , ("y", ArgString $ T.pack $ show y)
  ]

g2ToArgValue :: G2Point -> ArgValue
g2ToArgValue (G2Point (xIm, xRe) (yIm, yRe)) = ArgObject $ KM.fromList
  [ ("x", ArgArray $ V.fromList [ArgString $ T.pack $ show xIm, ArgString $ T.pack $ show xRe])
  , ("y", ArgArray $ V.fromList [ArgString $ T.pack $ show yIm, ArgString $ T.pack $ show yRe])
  ]

boundParamsToArgValue :: BoundParams -> ArgValue
boundParamsToArgValue BoundParams{..} = ArgObject $ KM.fromList
  [ ("treeNumber", ArgInt $ fromIntegral bpTreeNumber)
  , ("minGasPrice", ArgString $ T.pack $ show bpMinGasPrice)
  , ("unshield", ArgString $ unshieldTypeToString bpUnshield)
  , ("chainID", ArgString $ T.pack $ show bpChainID)
  , ("adaptContract", ArgString $ T.drop 2 bpAdaptContract)  -- Remove 0x prefix
  , ("adaptParams", ArgString $ TE.decodeUtf8 $ B16.encode bpAdaptParams)
  , ("commitmentCiphertext", ArgArray V.empty)
  ]
  where
    unshieldTypeToString UnshieldNone = "NONE"
    unshieldTypeToString UnshieldNormal = "NORMAL"
    unshieldTypeToString UnshieldRedirect = "REDIRECT"

-- | Get the chain ID from STRATO metadata endpoint
getChainId :: StratoConfig -> IO (Either Text Integer)
getChainId config = do
  manager <- newManager defaultManagerSettings
  let url = "http://" ++ T.unpack (stratoHost config) ++ ":" ++ show (stratoPort config) ++ "/strato-api/eth/v1.2/metadata"
  request <- parseRequest url
  let requestWithAuth = request 
        { requestHeaders = [("Authorization", TE.encodeUtf8 $ "Bearer " <> stratoAuthToken config)]
        }
  response <- httpLbs requestWithAuth manager
  case eitherDecode (responseBody response) of
    Left err -> return $ Left $ "Failed to parse metadata response: " <> T.pack err
    Right json -> case parseMaybe (\obj -> obj .: "networkID") json of
      Nothing -> return $ Left "networkID not found in metadata"
      Just (networkIdStr :: Text) -> case reads (T.unpack networkIdStr) of
        [(n, "")] -> return $ Right n
        _ -> return $ Left $ "Failed to parse networkID: " <> networkIdStr

-- | Get the current merkle root from the Railgun contract
getMerkleRoot :: StratoConfig -> IO (Either Text Text)
getMerkleRoot config = do
  manager <- newManager defaultManagerSettings
  let storageUrl = "http://" ++ T.unpack (stratoHost config) ++ ":" ++ show (stratoPort config) 
            ++ "/cirrus/search/storage?address=eq." 
            ++ T.unpack (railgunContractAddress config) ++ "&limit=1"
  request <- parseRequest storageUrl
  let requestWithAuth = request 
        { requestHeaders = 
            [ ("Authorization", TE.encodeUtf8 $ "Bearer " <> stratoAuthToken config)
            , ("Accept", "application/json")
            ]
        }
  response <- httpLbs requestWithAuth manager
  case eitherDecode (responseBody response) of
    Left err -> return $ Left $ "Failed to parse Cirrus storage response: " <> T.pack err
    Right (results :: [Value]) -> 
      case results of
        [] -> return $ Left "No storage found for contract"
        (r:_) -> case parseMaybe extractMerkleRoot r of
          Nothing -> return $ Left "merkleRoot not found in storage"
          Just root -> return $ Right root
  where
    extractMerkleRoot :: Value -> Parser Text
    extractMerkleRoot v = do
      obj <- parseJSON v
      dataObj <- obj .: "data"
      dataObj .: "merkleRoot"

-- | Get the current tree number from the Railgun contract
getTreeNumber :: StratoConfig -> IO (Either Text Integer)
getTreeNumber config = do
  manager <- newManager defaultManagerSettings
  let storageUrl = "http://" ++ T.unpack (stratoHost config) ++ ":" ++ show (stratoPort config) 
            ++ "/cirrus/search/storage?address=eq." 
            ++ T.unpack (railgunContractAddress config) ++ "&limit=1"
  request <- parseRequest storageUrl
  let requestWithAuth = request 
        { requestHeaders = 
            [ ("Authorization", TE.encodeUtf8 $ "Bearer " <> stratoAuthToken config)
            , ("Accept", "application/json")
            ]
        }
  response <- httpLbs requestWithAuth manager
  case eitherDecode (responseBody response) of
    Left err -> return $ Left $ "Failed to parse Cirrus storage response: " <> T.pack err
    Right (results :: [Value]) -> 
      case results of
        [] -> return $ Right 0
        (r:_) -> case parseMaybe extractTreeNumberFromStorage r of
          Nothing -> return $ Right 0  -- Default to 0 if not found
          Just n -> return $ Right n
  where
    extractTreeNumberFromStorage :: Value -> Parser Integer
    extractTreeNumberFromStorage v = do
      obj <- parseJSON v
      dataObj <- obj .: "data"
      treeNumStr <- dataObj .: "treeNumber"
      -- Empty string means 0
      if T.null treeNumStr
        then return 0
        else case reads (T.unpack treeNumStr) of
          [(n, "")] -> return n
          _ -> return 0
