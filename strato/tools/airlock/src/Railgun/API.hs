{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}

module Railgun.API
  ( -- * STRATO API interaction
    callShield
  , callTransact
  , approveToken
  , queryStorage
  , queryShieldEvents
    -- * Configuration
  , StratoConfig(..)
  , defaultConfig
  ) where

import Data.Aeson
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Lazy as LBS
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import GHC.Generics (Generic)
import qualified Network.HTTP.Client
import Network.HTTP.Client hiding (method)
import Network.HTTP.Client.TLS (tlsManagerSettings)
-- Note: For HTTP URLs, we use defaultManagerSettings to avoid TLS overhead
import Network.HTTP.Types.Status (statusCode)

import Railgun.Types (ShieldRequest(..), CommitmentPreimage(..), TokenData(..), TokenType(..), integerToHex32)
import Railgun.Unshield (UnshieldRequest(..), Transaction(..), SnarkProof(..), G1Point(..), G2Point(..), BoundParams(..), UnshieldType(..))

-- | STRATO API configuration
data StratoConfig = StratoConfig
  { stratoBaseUrl :: Text        -- ^ e.g., "http://localhost:8081"
  , stratoAuthToken :: Text      -- ^ OAuth bearer token
  , railgunContractAddress :: Text  -- ^ RailgunSmartWallet proxy address
  } deriving (Show, Eq)

-- | Default configuration for local jimtest
defaultConfig :: StratoConfig
defaultConfig = StratoConfig
  { stratoBaseUrl = "http://localhost:8081"
  , stratoAuthToken = ""  -- Must be set from .token file
  , railgunContractAddress = "959b55477e53900402fdbb2633b56709d252cadd"
  }

-- | Transaction payload for STRATO API
data TxPayload = TxPayload
  { txType :: Text
  , payload :: FunctionPayload
  } deriving (Show, Generic)

instance ToJSON TxPayload where
  toJSON tp = object
    [ "type" .= txType tp
    , "payload" .= payload tp
    ]

-- | Function call payload
data FunctionPayload = FunctionPayload
  { fpContractAddress :: Text
  , fpMethod :: Text
  , fpArgs :: Value
  } deriving (Show, Generic)

instance ToJSON FunctionPayload where
  toJSON fp = object
    [ "contractAddress" .= fpContractAddress fp
    , "method" .= fpMethod fp
    , "args" .= fpArgs fp
    ]

-- | Full transaction request body
data TxRequest = TxRequest
  { txs :: [TxPayload]
  } deriving (Show, Generic)

instance ToJSON TxRequest

-- | Call the shield function on the Railgun contract
callShield :: StratoConfig 
           -> [ShieldRequest]  -- ^ Shield requests (can batch multiple)
           -> IO (Either Text Text)
callShield config shieldReqs = do
  manager <- newManager tlsManagerSettings
  
  let url = T.unpack (stratoBaseUrl config) <> "/strato-api/bloc/v2.2/transaction?resolve"
      
      txPayload = TxPayload
        { txType = "FUNCTION"
        , payload = FunctionPayload
            { fpContractAddress = railgunContractAddress config
            , fpMethod = "shield"
            , fpArgs = object ["_shieldRequests" .= shieldReqs]
            }
        }
      
      reqBody = TxRequest { txs = [txPayload] }
  
  initialRequest <- parseRequest url
  let request = initialRequest
        { Network.HTTP.Client.method = "POST"
        , requestBody = RequestBodyLBS $ encode reqBody
        , requestHeaders = 
            [ ("Content-Type", "application/json")
            , ("Authorization", TE.encodeUtf8 $ "Bearer " <> stratoAuthToken config)
            , ("Accept", "*/*")
            , ("User-Agent", "curl/7.81.0")
            ]
        }
  
  response <- httpLbs request manager
  let status = statusCode $ responseStatus response
      respBody = TE.decodeUtf8 $ LBS.toStrict $ responseBody response
  
  if status >= 200 && status < 300
    then return $ Right respBody
    else return $ Left $ "HTTP " <> T.pack (show status) <> ": " <> respBody

-- | Call the transact function on the Railgun contract (for unshield/transfer)
callTransact :: StratoConfig 
             -> UnshieldRequest  -- ^ Unshield request with transactions
             -> IO (Either Text Text)
callTransact config unshieldReq = do
  manager <- newManager defaultManagerSettings
  
  let url = T.unpack (stratoBaseUrl config) <> "/strato-api/bloc/v2.2/transaction?resolve"
      
      -- Convert transactions to JSON format expected by contract
      txsJson = map transactionToJson (urTransactions unshieldReq)
      
      txPayload = TxPayload
        { txType = "FUNCTION"
        , payload = FunctionPayload
            { fpContractAddress = railgunContractAddress config
            , fpMethod = "transact"
            , fpArgs = object ["_transactions" .= txsJson]
            }
        }
      
      reqBody = TxRequest { txs = [txPayload] }
  
  initialRequest <- parseRequest url
  let request = initialRequest
        { Network.HTTP.Client.method = "POST"
        , requestBody = RequestBodyLBS $ encode reqBody
        , requestHeaders = 
            [ ("Content-Type", "application/json")
            , ("Authorization", TE.encodeUtf8 $ "Bearer " <> stratoAuthToken config)
            , ("Accept", "*/*")
            , ("User-Agent", "curl/7.81.0")
            ]
        }
  
  response <- httpLbs request manager
  let status = statusCode $ responseStatus response
      respBody = TE.decodeUtf8 $ LBS.toStrict $ responseBody response
  
  if status >= 200 && status < 300
    then return $ Right respBody
    else return $ Left $ "HTTP " <> T.pack (show status) <> ": " <> respBody

-- | Convert a Transaction to JSON for the contract call
transactionToJson :: Transaction -> Value
transactionToJson tx = object
  [ "proof" .= proofToJson (txProof tx)
  , "merkleRoot" .= bytesToHexText (txMerkleRoot tx)
  , "nullifiers" .= map bytesToHexText (txNullifiers tx)
  , "commitments" .= map bytesToHexText (txCommitments tx)
  , "boundParams" .= boundParamsToJson (txBoundParams tx)
  , "unshieldPreimage" .= preimageToJson (txUnshieldPreimage tx)
  ]
  where
    -- STRATO expects bytes32 as 64 hex chars WITHOUT 0x prefix
    bytesToHexText bs = TE.decodeUtf8 $ B16.encode bs

proofToJson :: SnarkProof -> Value
proofToJson proof = object
  [ "a" .= g1ToJson (proofA proof)
  , "b" .= g2ToJson (proofB proof)
  , "c" .= g1ToJson (proofC proof)
  ]

g1ToJson :: G1Point -> Value
g1ToJson (G1Point x y) = object
  [ "x" .= show x
  , "y" .= show y
  ]

g2ToJson :: G2Point -> Value
g2ToJson (G2Point (xIm, xRe) (yIm, yRe)) = object
  [ "x" .= [show xIm, show xRe]
  , "y" .= [show yIm, show yRe]
  ]

boundParamsToJson :: BoundParams -> Value
boundParamsToJson bp = object
  [ "treeNumber" .= bpTreeNumber bp
  , "minGasPrice" .= show (bpMinGasPrice bp)
  , "unshield" .= unshieldTypeToString (bpUnshield bp)
  , "chainID" .= show (bpChainID bp)
  , "adaptContract" .= T.drop 2 (bpAdaptContract bp)  -- Remove 0x prefix
  , "adaptParams" .= TE.decodeUtf8 (B16.encode $ bpAdaptParams bp)  -- No 0x prefix
  , "commitmentCiphertext" .= ([] :: [Value])
  ]
  where
    unshieldTypeToString UnshieldNone = "NONE" :: Text
    unshieldTypeToString UnshieldNormal = "NORMAL"
    unshieldTypeToString UnshieldRedirect = "REDIRECT"

preimageToJson :: CommitmentPreimage -> Value
preimageToJson cp = object
  [ "npk" .= integerToHex32 (cpNpk cp)  -- integerToHex32 produces 64 hex chars, no 0x prefix
  , "token" .= object
      [ "tokenType" .= tokenTypeToString (tokenType (cpToken cp))
      , "tokenAddress" .= T.drop 2 (tokenAddress (cpToken cp))  -- Remove 0x prefix
      , "tokenSubID" .= show (tokenSubID (cpToken cp))
      ]
  , "value" .= show (cpValue cp)
  ]
  where
    tokenTypeToString :: TokenType -> Text
    tokenTypeToString t = case t of
      ERC20 -> "ERC20"
      ERC721 -> "ERC721"
      ERC1155 -> "ERC1155"

-- | Approve token spending for the Railgun contract
approveToken :: StratoConfig
             -> Text      -- ^ Token contract address
             -> Integer   -- ^ Amount to approve
             -> IO (Either Text Text)
approveToken config tokenAddr amount = do
  manager <- newManager tlsManagerSettings
  
  let url = T.unpack (stratoBaseUrl config) <> "/strato/v2.3/transaction/parallel?resolve=true"
      
      txPayload = TxPayload
        { txType = "FUNCTION"
        , payload = FunctionPayload
            { fpContractAddress = tokenAddr
            , fpMethod = "approve"
            , fpArgs = object 
                [ "spender" .= railgunContractAddress config
                , "value" .= show amount
                ]
            }
        }
      
      reqBody = object
        [ "txs" .= [txPayload]
        , "txParams" .= object 
            [ "gasPrice" .= (1 :: Int)
            , "gasLimit" .= (32100000000 :: Integer)
            ]
        ]
  
  initialRequest <- parseRequest url
  let request = initialRequest
        { Network.HTTP.Client.method = "POST"
        , requestBody = RequestBodyLBS $ encode reqBody
        , requestHeaders = 
            [ ("Content-Type", "application/json")
            , ("Authorization", TE.encodeUtf8 $ "Bearer " <> stratoAuthToken config)
            ]
        }
  
  response <- httpLbs request manager
  let status = statusCode $ responseStatus response
      respBody = TE.decodeUtf8 $ LBS.toStrict $ responseBody response
  
  if status >= 200 && status < 300
    then return $ Right respBody
    else return $ Left $ "HTTP " <> T.pack (show status) <> ": " <> respBody

-- | Query storage from STRATO API
queryStorage :: StratoConfig
             -> Text      -- ^ Contract address
             -> Text      -- ^ Storage key (or search term)
             -> IO (Either Text Value)
queryStorage config contractAddr key = do
  manager <- newManager tlsManagerSettings
  
  let url = T.unpack (stratoBaseUrl config) 
          <> "/strato-api/eth/v1.2/storage?address=" 
          <> T.unpack contractAddr 
          <> "&search=" 
          <> T.unpack key
  
  initialRequest <- parseRequest url
  let request = initialRequest
        { Network.HTTP.Client.method = "GET"
        , requestHeaders = 
            [ ("Authorization", TE.encodeUtf8 $ "Bearer " <> stratoAuthToken config)
            ]
        }
  
  response <- httpLbs request manager
  let status = statusCode $ responseStatus response
      respBody = responseBody response
  
  if status >= 200 && status < 300
    then case eitherDecode respBody of
      Right val -> return $ Right val
      Left err -> return $ Left $ "JSON parse error: " <> T.pack err
    else return $ Left $ "HTTP " <> T.pack (show status) <> ": " <> TE.decodeUtf8 (LBS.toStrict respBody)

-- | Query shield events from the Railgun contract
-- Looks for commitments in the merkle tree
queryShieldEvents :: StratoConfig -> IO (Either Text Value)
queryShieldEvents config = do
  manager <- newManager tlsManagerSettings
  
  -- Query the commitments mapping from the Railgun contract
  let url = T.unpack (stratoBaseUrl config) 
          <> "/strato-api/eth/v1.2/storage?address=" 
          <> T.unpack (railgunContractAddress config)
          <> "&search=commitments"
  
  initialRequest <- parseRequest url
  let request = initialRequest
        { Network.HTTP.Client.method = "GET"
        , requestHeaders = 
            [ ("Authorization", TE.encodeUtf8 $ "Bearer " <> stratoAuthToken config)
            ]
        }
  
  response <- httpLbs request manager
  let status = statusCode $ responseStatus response
      respBody = responseBody response
  
  if status >= 200 && status < 300
    then case eitherDecode respBody of
      Right val -> return $ Right val
      Left err -> return $ Left $ "JSON parse error: " <> T.pack err
    else return $ Left $ "HTTP " <> T.pack (show status) <> ": " <> TE.decodeUtf8 (LBS.toStrict respBody)
