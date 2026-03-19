{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Railgun.API
  ( -- * STRATO API interaction
    callShield
  , callTransact
  , approveToken
  , getMerkleRoot
  , getTreeNumber
  , getBoundParamsHash
  , getUserAddress
  , getTokenBalance
  , getTokenDecimals
  , formatTokenAmount
  , parseTokenAmount
    -- * Configuration
  , readContractAddress
  , defaultHost
  , defaultPort
  ) where

import Bloc.API (FunctionPayload(..), PostBlocTransactionRequest(..), BlocTransactionPayload(..), BlocTransactionResult(..), BlocTransactionData(..))
import Bloc.Client (postBlocTransactionParallelExternal)
import BlockApps.Solidity.ArgValue (ArgValue(..))
import BlockApps.Solidity.SolidityValue (SolidityValue(..))
import Blockchain.Strato.Model.Address (Address(..), formatAddressWithoutColor)
import qualified Data.Aeson.KeyMap as KM
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import qualified Data.Text.IO as TIO
import qualified Data.Vector as V
import Data.Aeson (eitherDecode, parseJSON, (.:), Value)
import Data.Aeson.Types (parseMaybe, Parser)
import qualified Data.ByteString.Lazy as LBS
import qualified Network.HTTP.Client as HTTP
import Servant.Client (BaseUrl(..), Scheme(..), ClientEnv(..), mkClientEnv, defaultMakeClientRequest, ClientError(..))
import Servant.Client.Core (addHeader, ResponseF(..))
import Network.HTTP.Types (Status(..))
import Text.Printf (printf)
import Strato.Strato23.API.Types (AddressAndKey(..))
import Strato.Auth (runServantWithAuthEnv, authRequest)
import Blockchain.EthConf.Model (EthConf(..), ContractsConf(..))
import Data.Yaml (decodeFileEither)
import System.Directory (doesFileExist, getHomeDirectory)
import System.Environment (lookupEnv)
import System.FilePath ((</>))
import Data.Maybe (fromMaybe)

import Railgun.Types (ShieldRequest(..), CommitmentPreimage(..), ShieldCiphertext(..), TokenData(..), TokenType(..), integerToHex32, encryptedBundleToHexList)
import Railgun.Unshield (UnshieldRequest(..), Transaction(..), SnarkProof(..), G1Point(..), G2Point(..), BoundParams(..), UnshieldType(..), CommitmentCiphertext(..))

-- | Extract a human-readable error message from a Servant ClientError
formatClientError :: ClientError -> Text
formatClientError (FailureResponse _ resp) = 
  let Status code _ = responseStatusCode resp
      body = TE.decodeUtf8 $ LBS.toStrict $ responseBody resp
      -- Try to extract the actual error message from the body
      cleanBody = T.replace "\\\"" "\"" $ T.replace "\"" "" body
  in "HTTP " <> T.pack (show code) <> ": " <> cleanBody
formatClientError (DecodeFailure msg _) = "Failed to decode response: " <> msg
formatClientError (UnsupportedContentType _ _) = "Unsupported content type in response"
formatClientError (InvalidContentTypeHeader _) = "Invalid content type header"
formatClientError (ConnectionError ex) = "Connection error: " <> T.pack (show ex)

-- | Default STRATO host
defaultHost :: String
defaultHost = "localhost"

-- | Default STRATO port  
defaultPort :: Int
defaultPort = 8081

-- | Read contract address from ethconf.yaml
readContractAddress :: IO (Maybe Text)
readContractAddress = do
  home <- getHomeDirectory
  let defaultNodePath = home </> ".strato" </> "default-node"
  exists <- doesFileExist defaultNodePath
  if not exists
    then return Nothing
    else do
      nodeDir <- T.unpack . T.strip <$> TIO.readFile defaultNodePath
      let ethconfPath = nodeDir </> ".ethereumH" </> "ethconf.yaml"
      ethconfExists <- doesFileExist ethconfPath
      if not ethconfExists
        then return Nothing
        else do
          result <- decodeFileEither ethconfPath
          case result of
            Left _ -> return Nothing
            Right ethConf -> 
              return $ T.pack . formatAddressWithoutColor <$> (contractsConfig ethConf >>= railgunProxy)

-- | Create a servant-client environment with custom headers for nginx CSRF bypass
makeBlocClientEnv :: IO ClientEnv
makeBlocClientEnv = do
  manager <- HTTP.newManager HTTP.defaultManagerSettings
  let baseUrl = BaseUrl Http defaultHost defaultPort "/strato-api/bloc/v2.2"
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
callShield :: [ShieldRequest]  -- ^ Shield requests (can batch multiple)
           -> IO (Either Text [BlocTransactionResult])
callShield shieldReqs = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found in ethconf.yaml"
    Just contractAddrText -> do
      clientEnv <- makeBlocClientEnv
      let contractAddr = textToAddress contractAddrText
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
      
      result <- runServantWithAuthEnv clientEnv $ \authHeader ->
        postBlocTransactionParallelExternal authHeader Nothing True request
      pure $ case result of
        Left clientErr -> Left $ formatClientError clientErr
        Right txResults -> Right txResults

-- | Call the transact function on the Railgun contract (for unshield/transfer)
callTransact :: UnshieldRequest  -- ^ Unshield request with transactions
             -> IO (Either Text [BlocTransactionResult])
callTransact unshieldReq = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddrText -> do
      clientEnv <- makeBlocClientEnv
      let contractAddr = textToAddress contractAddrText
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
      
      result <- runServantWithAuthEnv clientEnv $ \authHeader ->
        postBlocTransactionParallelExternal authHeader Nothing True request
      pure $ case result of
        Left clientErr -> Left $ formatClientError clientErr
        Right txResults -> Right txResults

-- | Approve token spending for the Railgun contract
approveToken :: Text      -- ^ Token contract address
             -> Integer   -- ^ Amount to approve
             -> IO (Either Text [BlocTransactionResult])
approveToken tokenAddr amount = do
  maybeRailgunAddr <- readContractAddress
  case maybeRailgunAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just railgunAddr -> do
      clientEnv <- makeBlocClientEnv
      let contractAddr = textToAddress tokenAddr
          args = Map.fromList
            [ ("spender", ArgString railgunAddr)
            , ("value", ArgString $ T.pack $ show amount)
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
      
      result <- runServantWithAuthEnv clientEnv $ \authHeader ->
        postBlocTransactionParallelExternal authHeader Nothing True request
      pure $ case result of
        Left clientErr -> Left $ formatClientError clientErr
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
-- Swap G2 coordinates for Ethereum bn128 compatibility: [imaginary, real] order
-- snarkjs outputs [real, imaginary], but ecPairing expects [imaginary, real]
g2ToArgValue (G2Point (x0, x1) (y0, y1)) = ArgObject $ KM.fromList
  [ ("x", ArgArray $ V.fromList [ArgString $ T.pack $ show x1, ArgString $ T.pack $ show x0])  -- Swap: [imag, real]
  , ("y", ArgArray $ V.fromList [ArgString $ T.pack $ show y1, ArgString $ T.pack $ show y0])  -- Swap: [imag, real]
  ]

boundParamsToArgValue :: BoundParams -> ArgValue
boundParamsToArgValue BoundParams{..} = ArgObject $ KM.fromList
  [ ("treeNumber", ArgInt $ fromIntegral bpTreeNumber)
  , ("minGasPrice", ArgString $ T.pack $ show bpMinGasPrice)
  , ("unshield", ArgString $ unshieldTypeToString bpUnshield)
  , ("chainID", ArgString $ T.pack $ show bpChainID)
  , ("adaptContract", ArgString $ T.drop 2 bpAdaptContract)  -- Remove 0x prefix
  , ("adaptParams", ArgString $ TE.decodeUtf8 $ B16.encode bpAdaptParams)
  , ("commitmentCiphertext", ArgArray $ V.fromList $ map commitmentCiphertextToArgValue bpCommitmentCiphertext)
  ]
  where
    unshieldTypeToString UnshieldNone = "NONE"
    unshieldTypeToString UnshieldNormal = "NORMAL"
    unshieldTypeToString UnshieldRedirect = "REDIRECT"
    
    commitmentCiphertextToArgValue CommitmentCiphertext{..} = ArgObject $ KM.fromList $
      [ ("ciphertext", ArgArray $ V.fromList $ map (ArgString . TE.decodeUtf8 . B16.encode) ccCiphertext)
      , ("blindedSenderViewingKey", ArgString $ TE.decodeUtf8 $ B16.encode ccBlindedSenderViewingKey)
      , ("blindedReceiverViewingKey", ArgString $ TE.decodeUtf8 $ B16.encode ccBlindedReceiverViewingKey)
      ]
      -- Only include annotationData and memo if non-empty
      ++ (if BS.null ccAnnotationData then [] else [("annotationData", ArgString $ TE.decodeUtf8 $ B16.encode ccAnnotationData)])
      ++ (if BS.null ccMemo then [] else [("memo", ArgString $ TE.decodeUtf8 $ B16.encode ccMemo)])

-- | Get the current merkle root from the Railgun contract
-- Note: Cirrus may strip leading zeros from bytes32 values. We pad to 64 chars
-- but this may cause contract lookup failures due to a SolidVM bug with
-- bytes32 mapping keys. See: [TODO: add bug tracker link]
getMerkleRoot :: IO (Either Text Text)
getMerkleRoot = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let storageUrl = "http://" ++ defaultHost ++ ":" ++ show defaultPort 
                ++ "/cirrus/search/storage?address=eq." 
                ++ T.unpack contractAddr ++ "&limit=1"
      request <- HTTP.parseRequest storageUrl
      let requestWithHeaders = request { HTTP.requestHeaders = [("Accept", "application/json")] }
      response <- authRequest requestWithHeaders
      case eitherDecode (HTTP.responseBody response) of
        Left err -> return $ Left $ "Failed to parse Cirrus storage response: " <> T.pack err
        Right (results :: [Value]) -> 
          case results of
            [] -> return $ Left "No storage found for contract"
            (r:_) -> case parseMaybe extractMerkleRoot r of
              Nothing -> return $ Left "merkleRoot not found in storage"
              Just root -> return $ Right $ padHex64 root
  where
    extractMerkleRoot :: Value -> Parser Text
    extractMerkleRoot v = do
      obj <- parseJSON v
      dataObj <- obj .: "data"
      dataObj .: "merkleRoot"
    
    -- Pad hex string to 64 characters (32 bytes) with leading zeros
    padHex64 :: Text -> Text
    padHex64 t = 
      let clean = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 t else t
          padding = T.replicate (64 - T.length clean) "0"
      in padding <> clean

-- | Call the contract's hashBoundParams function to get the exact hash it will compute
-- This is needed because SolidVM's ABI encoding may differ from standard Ethereum
getBoundParamsHash :: Int       -- ^ Tree number
                   -> Integer   -- ^ Chain ID
                   -> [CommitmentCiphertext]  -- ^ Actual ciphertext entries
                   -> Bool      -- ^ True for unshield (NORMAL), False for transfer (NONE)
                   -> IO (Either Text Integer)
getBoundParamsHash treeNum chainId ciphertexts isUnshield = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddrText -> do
      clientEnv <- makeBlocClientEnv
      -- Convert CommitmentCiphertext to ArgValue
      let ciphertextToArg ct = ArgObject $ KM.fromList
            [ ("ciphertext", ArgArray $ V.fromList $ 
                map (ArgString . TE.decodeUtf8 . B16.encode) (ccCiphertext ct))
            , ("blindedSenderViewingKey", ArgString $ TE.decodeUtf8 $ B16.encode $ ccBlindedSenderViewingKey ct)
            , ("blindedReceiverViewingKey", ArgString $ TE.decodeUtf8 $ B16.encode $ ccBlindedReceiverViewingKey ct)
            ]
          ciphertextArray = V.fromList $ map ciphertextToArg ciphertexts
          -- Use NORMAL for unshield, NONE for transfer
          unshieldType = if isUnshield then "NORMAL" else "NONE"
          
          contractAddr = textToAddress contractAddrText
          boundParams = ArgObject $ KM.fromList
            [ ("treeNumber", ArgInt $ fromIntegral treeNum)
            , ("minGasPrice", ArgString "0")
            , ("unshield", ArgString unshieldType)
            , ("chainID", ArgString $ T.pack $ show chainId)
            , ("adaptContract", ArgString "0000000000000000000000000000000000000000")
            , ("adaptParams", ArgString "0000000000000000000000000000000000000000000000000000000000000000")
            , ("commitmentCiphertext", ArgArray ciphertextArray)
            ]
          args = Map.singleton "_boundParams" boundParams
          
          payload = BlocFunction $ FunctionPayload
            { functionpayloadContractAddress = contractAddr
            , functionpayloadMethod = "hashBoundParams"
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
      
      result <- runServantWithAuthEnv clientEnv $ \authHeader ->
        postBlocTransactionParallelExternal authHeader Nothing True request
      pure $ case result of
        Left clientErr -> Left $ formatClientError clientErr
        Right txResults -> case txResults of
          [] -> Left "No transaction result"
          (r:_) -> case blocTransactionData r of
            Just (Call contents) -> case contents of
              [] -> Left "Empty result from hashBoundParams"
              (SolidityValueAsString hashStr:_) -> 
                case reads (T.unpack hashStr) of
                  [(n, "")] -> Right n
                  _ -> Left $ "Failed to parse hash: " <> hashStr
              _ -> Left "Unexpected value type from hashBoundParams"
            _ -> Left "Unexpected result type from hashBoundParams"

-- | Get the current tree number from the Railgun contract
getTreeNumber :: IO (Either Text Integer)
getTreeNumber = do
  maybeContractAddr <- readContractAddress
  case maybeContractAddr of
    Nothing -> return $ Left "Railgun contract address not found"
    Just contractAddr -> do
      let storageUrl = "http://" ++ defaultHost ++ ":" ++ show defaultPort 
                ++ "/cirrus/search/storage?address=eq." 
                ++ T.unpack contractAddr ++ "&limit=1"
      request <- HTTP.parseRequest storageUrl
      let requestWithHeaders = request { HTTP.requestHeaders = [("Accept", "application/json")] }
      response <- authRequest requestWithHeaders
      case eitherDecode (HTTP.responseBody response) of
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

-- | Get the user's Ethereum address from the vault key endpoint
getUserAddress :: IO (Either Text Text)
getUserAddress = do
  vaultUrl <- fromMaybe "https://vault.blockapps.net:8093" <$> lookupEnv "VAULT_URL"
  let url = vaultUrl ++ "/strato/v2.3/key"
  request <- HTTP.parseRequest url
  let requestWithHeaders = request { HTTP.requestHeaders = [("Accept", "application/json")] }
  response <- authRequest requestWithHeaders
  case eitherDecode (HTTP.responseBody response) of
    Left err -> return $ Left $ "Failed to parse key response: " <> T.pack err
    Right addrAndKey -> return $ Right $ T.pack $ formatAddressWithoutColor $ unAddress addrAndKey

-- | Get the unshielded balance of a token for a given address
-- Reads directly from Cirrus storage (no transaction fees)
getTokenBalance :: Text -> Text -> IO (Either Text Integer)
getTokenBalance tokenAddr userAddr = do
  let normalizedToken = T.toLower $ if "0x" `T.isPrefixOf` T.toLower tokenAddr then T.drop 2 tokenAddr else tokenAddr
      normalizedUser = T.toLower $ if "0x" `T.isPrefixOf` T.toLower userAddr then T.drop 2 userAddr else userAddr
      baseUrl = "http://" ++ defaultHost ++ ":" ++ show defaultPort
      -- Query the _balances mapping in the token contract
      -- The key is stored as {"key": "<address>"} so we use the jsonb operator ->>
      url = baseUrl ++ "/cirrus/search/mapping?address=eq." ++ T.unpack normalizedToken
            ++ "&collection_name=eq._balances&key->>key=eq." ++ T.unpack normalizedUser
  
  request <- HTTP.parseRequest url
  let requestWithHeaders = request { HTTP.requestHeaders = [("Accept", "application/json")] }
  response <- authRequest requestWithHeaders
  pure $ case eitherDecode (HTTP.responseBody response) of
    Left err -> Left $ T.pack err
    Right (results :: [Value]) -> case results of
      [] -> Right 0  -- No balance entry means 0
      (r:_) -> case parseMaybe extractBalance r of
        Nothing -> Right 0
        Just bal -> Right bal
  where
    extractBalance :: Value -> Parser Integer
    extractBalance v = do
      obj <- parseJSON v
      -- value is already an integer in Cirrus, not hex
      obj .: "value"

-- | Get the decimals for a token (default 18 if not found)
getTokenDecimals :: Text -> IO Int
getTokenDecimals tokenAddr = do
  clientEnv <- makeBlocClientEnv
  
  let normalizedToken = if "0x" `T.isPrefixOf` T.toLower tokenAddr then T.drop 2 tokenAddr else tokenAddr
      contractAddr = textToAddress normalizedToken
      
      payload = BlocFunction $ FunctionPayload
        { functionpayloadContractAddress = contractAddr
        , functionpayloadMethod = "decimals"
        , functionpayloadArgs = Map.empty
        , functionpayloadTxParams = Nothing
        , functionpayloadMetadata = Nothing
        }
      
      request = PostBlocTransactionRequest
        { postbloctransactionrequestAddress = Nothing
        , postbloctransactionrequestTxs = [payload]
        , postbloctransactionrequestTxParams = Nothing
        , postbloctransactionrequestSrcs = Nothing
        }
  
  result <- runServantWithAuthEnv clientEnv $ \authHeader ->
    postBlocTransactionParallelExternal authHeader Nothing True request
  pure $ case result of
    Left _ -> 18  -- Default on client error
    Right txResults -> case txResults of
      [] -> 18
      (r:_) -> case blocTransactionData r of
        Just (Call contents) -> case contents of
          (SolidityValueAsString decStr:_) -> case reads (T.unpack decStr) of
            [(n, "")] -> n
            _ -> 18
          _ -> 18
        _ -> 18

-- | Format a token amount with proper decimal places
formatTokenAmount :: Integer -> Int -> Text
formatTokenAmount amount decimals =
  let divisor = 10 ^ decimals :: Integer
      intPart = amount `div` divisor
      fracPart = amount `mod` divisor
      -- Pad fractional part with leading zeros if needed
      fracStr = T.pack $ printf ("%0" ++ show decimals ++ "d") fracPart
      -- Remove trailing zeros but keep at least 2 decimal places
      trimmedFrac = T.dropWhileEnd (== '0') fracStr
      finalFrac = if T.length trimmedFrac < 2 then T.take 2 fracStr else trimmedFrac
  in T.pack (show intPart) <> "." <> finalFrac

-- | Parse a decimal token amount string into wei
-- e.g., "1.5" with 18 decimals -> 1500000000000000000
parseTokenAmount :: Text -> Int -> Either Text Integer
parseTokenAmount amountStr decimals
  | T.null amountStr = Right 0  -- Empty means "entire note"
  | otherwise = case T.splitOn "." amountStr of
      [intPart] -> 
        -- No decimal point, just an integer
        case reads (T.unpack intPart) of
          [(n, "")] -> Right $ n * (10 ^ decimals)
          _ -> Left $ "Invalid amount: " <> amountStr
      [intPart, fracPart] ->
        -- Has decimal point
        let intVal = case T.unpack intPart of
              "" -> 0
              s -> case reads s of
                [(n, "")] -> n
                _ -> -1  -- Invalid
            -- Pad or truncate fractional part to match decimals
            paddedFrac = T.take decimals (fracPart <> T.replicate decimals "0")
            fracVal = case reads (T.unpack paddedFrac) of
              [(n, "")] -> n
              _ -> -1  -- Invalid
        in if intVal < 0 || fracVal < 0
           then Left $ "Invalid amount: " <> amountStr
           else Right $ intVal * (10 ^ decimals) + fracVal
      _ -> Left $ "Invalid amount format: " <> amountStr
