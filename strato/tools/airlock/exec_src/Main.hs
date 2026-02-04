{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Main where

import Control.Concurrent (threadDelay)
import Control.Exception (try, SomeException)
import Control.Monad (when)
import Data.Aeson (decode, encode, (.:), (.=), object)
import Data.Aeson.Types (parseMaybe)
import qualified Data.ByteString.Lazy as LBS
import Data.Time.Clock.POSIX (getPOSIXTime)
import System.Console.CmdArgs
import System.Directory (doesFileExist, createDirectoryIfMissing, getHomeDirectory)
import System.Exit (exitFailure, exitSuccess)
import System.FilePath ((</>))
import System.IO (hPutStrLn, stderr, hFlush, stdout, hGetEcho, stdin, hSetEcho)
import Network.HTTP.Client (newManager, httpLbs, parseRequest, urlEncodedBody, responseBody, Manager)
import Network.HTTP.Client.TLS (tlsManagerSettings)

import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import qualified Data.Text.Encoding as TE
import Network.URI (parseURI, uriAuthority, uriRegName, uriPort)
import Text.Printf (printf)

import Railgun.Keys (deriveFromMnemonic, railgunAddress)
import Railgun.Shield (createERC20ShieldRequest, serializeShieldRequest)
import Railgun.Unshield (createDummyUnshieldRequest, serializeUnshieldRequest)
import Railgun.API (StratoConfig(..), callShield, callTransact, approveToken)
import Railgun.Types (RailgunAddress(..), RailgunKeys, TokenType(..))
import Railgun.Balance (scanShieldedBalance, ShieldedNote(..), TokenBalance(..))

-- | Path to the mnemonic file
mnemonicFilePath :: IO FilePath
mnemonicFilePath = do
  home <- getHomeDirectory
  return $ home </> ".secrets" </> "railgunMnemonic"

-- | Path to the auth token file
tokenFilePath :: IO FilePath
tokenFilePath = do
  home <- getHomeDirectory
  return $ home </> ".secrets" </> "stratoToken"

-- | Path to the OAuth config file (shared with other tools)
oauthConfigFilePath :: IO FilePath
oauthConfigFilePath = do
  home <- getHomeDirectory
  return $ home </> ".secrets" </> "oauth_credentials"

-- | OAuth configuration
data OAuthConfig = OAuthConfig
  { oauthTokenUrl :: T.Text
  , oauthDeviceUrl :: T.Text
  , oauthClientId :: T.Text
  , oauthClientSecret :: T.Text
  } deriving (Show)

-- | Read OAuth config from file
-- Uses OAUTH_DISCOVERY_URL to derive token and device endpoints
readOAuthConfig :: IO OAuthConfig
readOAuthConfig = do
  configPath <- oauthConfigFilePath
  exists <- doesFileExist configPath
  if exists
    then do
      content <- TIO.readFile configPath
      let pairs = map (T.breakOn "=") $ T.lines content
          getValue key = case lookup key [(T.strip k, T.strip $ T.drop 1 v) | (k, v) <- pairs] of
            Just val -> val
            Nothing -> ""
          discoveryUrl = getValue "OAUTH_DISCOVERY_URL"
          clientId = getValue "OAUTH_CLIENT_ID"
          clientSecret = getValue "OAUTH_CLIENT_SECRET"
          -- Derive token and device URLs from discovery URL
          -- Discovery URL: https://host/auth/realms/realm/.well-known/openid-configuration
          -- Token URL: https://host/auth/realms/realm/protocol/openid-connect/token
          -- Device URL: https://host/auth/realms/realm/protocol/openid-connect/auth/device
          realmUrl = T.replace "/.well-known/openid-configuration" "" discoveryUrl
          tokenUrl = realmUrl <> "/protocol/openid-connect/token"
          deviceUrl = realmUrl <> "/protocol/openid-connect/auth/device"
      return OAuthConfig
        { oauthTokenUrl = tokenUrl
        , oauthDeviceUrl = deviceUrl
        , oauthClientId = clientId
        , oauthClientSecret = clientSecret
        }
    else do
      hPutStrLn stderr $ "Error: OAuth config not found at " ++ configPath
      hPutStrLn stderr ""
      hPutStrLn stderr "Please create the file with:"
      hPutStrLn stderr "  OAUTH_DISCOVERY_URL=https://your-keycloak/.well-known/openid-configuration"
      hPutStrLn stderr "  OAUTH_CLIENT_ID=your_client_id"
      hPutStrLn stderr "  OAUTH_CLIENT_SECRET=your_client_secret"
      exitFailure

-- | Token data stored in file
data StoredToken = StoredToken
  { storedAccessToken :: T.Text
  , storedRefreshToken :: T.Text
  , storedExpiresAt :: Integer  -- Unix timestamp
  } deriving (Show)

-- | Read auth token from file, auto-refreshing if expired
readAuthToken :: IO T.Text
readAuthToken = do
  path <- tokenFilePath
  exists <- doesFileExist path
  if not exists
    then do
      hPutStrLn stderr "Not logged in. Please run 'airlock login' first."
      exitFailure
    else do
      content <- LBS.readFile path
      case decode content of
        Just tokenJson -> do
          let getField key = parseMaybe (\obj -> obj .: key) tokenJson :: Maybe T.Text
              getFieldInt key = parseMaybe (\obj -> obj .: key) tokenJson :: Maybe Integer
          case (getField "access_token", getField "refresh_token", getFieldInt "expires_at") of
            (Just accessToken, Just refreshToken, Just expiresAt) -> do
              now <- round <$> getPOSIXTime
              -- Refresh if token expires in less than 60 seconds
              if now >= expiresAt - 60
                then do
                  TIO.hPutStrLn stderr "Token expired, refreshing..."
                  refreshAuthToken refreshToken
                else return accessToken
            _ -> do
              hPutStrLn stderr "Session expired. Please run 'airlock login' again."
              exitFailure
        Nothing -> do
          hPutStrLn stderr "Session expired. Please run 'airlock login' again."
          exitFailure

-- | Refresh the auth token using refresh_token
refreshAuthToken :: T.Text -> IO T.Text
refreshAuthToken refreshToken = do
  config <- readOAuthConfig
  manager <- newManager tlsManagerSettings
  
  tokenReq <- parseRequest $ T.unpack $ oauthTokenUrl config
  let tokenReqWithBody = urlEncodedBody
        [ ("client_id", TE.encodeUtf8 $ oauthClientId config)
        , ("client_secret", TE.encodeUtf8 $ oauthClientSecret config)
        , ("grant_type", "refresh_token")
        , ("refresh_token", TE.encodeUtf8 refreshToken)
        ] tokenReq
  
  tokenResp <- httpLbs tokenReqWithBody manager
  
  case decode (responseBody tokenResp) of
    Nothing -> do
      hPutStrLn stderr "Session expired. Please run 'airlock login' again."
      exitFailure
    Just tokenJson -> do
      let getField key = parseMaybe (\obj -> obj .: key) tokenJson :: Maybe T.Text
          getFieldInt key = parseMaybe (\obj -> obj .: key) tokenJson :: Maybe Int
          getError = getField "error"
      
      case getError of
        Just _ -> do
          hPutStrLn stderr "Session expired. Please run 'airlock login' again."
          exitFailure
        Nothing -> do
          case (getField "access_token", getFieldInt "expires_in") of
            (Just newAccessToken, Just expiresIn) -> do
              -- Get new refresh token if provided, otherwise keep old one
              let newRefreshToken = case getField "refresh_token" of
                    Just rt -> rt
                    Nothing -> refreshToken
              
              -- Save new tokens
              now <- round <$> getPOSIXTime
              saveTokens newAccessToken newRefreshToken (now + fromIntegral expiresIn)
              
              TIO.hPutStrLn stderr "Token refreshed successfully."
              return newAccessToken
            _ -> do
              hPutStrLn stderr "Session expired. Please run 'airlock login' again."
              exitFailure

-- | Save tokens to file
saveTokens :: T.Text -> T.Text -> Integer -> IO ()
saveTokens accessToken refreshToken expiresAt = do
  path <- tokenFilePath
  home <- getHomeDirectory
  createDirectoryIfMissing True (home </> ".secrets")
  let tokenData = object
        [ "access_token" .= accessToken
        , "refresh_token" .= refreshToken
        , "expires_at" .= expiresAt
        ]
  LBS.writeFile path (encode tokenData)

-- | Read mnemonic from file, or fail with instructions
readMnemonicFromFile :: IO T.Text
readMnemonicFromFile = do
  path <- mnemonicFilePath
  exists <- doesFileExist path
  if exists
    then T.strip <$> TIO.readFile path
    else do
      hPutStrLn stderr $ "Error: Mnemonic not found at " ++ path
      hPutStrLn stderr ""
      hPutStrLn stderr "Please run 'airlock create_wallet' to set up your wallet."
      exitFailure

-- | Command line modes
data Command
  = Login
      { }
  | CreateWallet
      { forceOverwrite :: Bool
      }
  | ListAddresses
      { passphrase :: String
      , numAddresses :: Int
      }
  | Shield
      { passphrase :: String
      , tokenAddress :: String
      , amount :: Integer
      , baseUrl :: String
      , railgunContractAddr :: String
      , derivationIndex :: Int
      , approveFirst :: Bool
      , dryRun :: Bool
      }
  | Unshield
      { passphrase :: String
      , tokenAddress :: String
      , amount :: Integer
      , recipient :: String
      , baseUrl :: String
      , railgunContractAddr :: String
      , derivationIndex :: Int
      , dryRun :: Bool
      }
  | Balance
      { passphrase :: String
      , baseUrl :: String
      , railgunContractAddr :: String
      , derivationIndex :: Int
      , showNotes :: Bool
      }
  deriving (Show, Data, Typeable)

loginMode :: Command
loginMode = Login
  { } &= help "Authenticate using OAuth device flow"

createWalletMode :: Command
createWalletMode = CreateWallet
  { forceOverwrite = False &= help "Overwrite existing mnemonic (dangerous!)"
  } &= help "Create wallet by storing a mnemonic phrase"
    &= name "create_wallet"

listAddressesMode :: Command
listAddressesMode = ListAddresses
  { passphrase = "" &= help "Optional BIP39 passphrase" &= typ "PASSPHRASE"
  , numAddresses = 10 &= help "Number of addresses to display (default 10)" &= typ "NUM"
  } &= help "List derived addresses from the wallet"
    &= name "list_addresses"

shieldMode :: Command
shieldMode = Shield
  { passphrase = "" &= help "Optional BIP39 passphrase" &= typ "PASSPHRASE"
  , tokenAddress = def &= help "ERC20 token contract address" &= typ "ADDRESS"
  , amount = 1000000000000000000 &= help "Amount to shield (in smallest unit, default 1e18)" &= typ "AMOUNT"
  , baseUrl = "http://localhost:8081" &= help "STRATO base URL" &= typ "URL"
  , railgunContractAddr = "959b55477e53900402fdbb2633b56709d252cadd" &= help "Railgun contract address" &= typ "ADDRESS"
  , derivationIndex = 0 &= help "Wallet derivation index (default 0)" &= typ "INDEX"
  , approveFirst = False &= help "Approve tokens before shielding"
  , dryRun = False &= help "Show request without sending"
  } &= help "Shield (deposit) tokens into Railgun"

unshieldMode :: Command
unshieldMode = Unshield
  { passphrase = "" &= help "Optional BIP39 passphrase" &= typ "PASSPHRASE"
  , tokenAddress = def &= help "ERC20 token contract address" &= typ "ADDRESS"
  , amount = 1000000000000000000 &= help "Amount to unshield (in smallest unit)" &= typ "AMOUNT"
  , recipient = def &= help "Recipient address for unshielded tokens" &= typ "ADDRESS"
  , baseUrl = "http://localhost:8081" &= help "STRATO base URL" &= typ "URL"
  , railgunContractAddr = "959b55477e53900402fdbb2633b56709d252cadd" &= help "Railgun contract address" &= typ "ADDRESS"
  , derivationIndex = 0 &= help "Wallet derivation index (default 0)" &= typ "INDEX"
  , dryRun = False &= help "Show request without sending"
  } &= help "Unshield (withdraw) tokens from Railgun (DUMMY - will fail verification)"

balanceMode :: Command
balanceMode = Balance
  { passphrase = "" &= help "Optional BIP39 passphrase" &= typ "PASSPHRASE"
  , baseUrl = "http://localhost:8081" &= help "STRATO base URL" &= typ "URL"
  , railgunContractAddr = "959b55477e53900402fdbb2633b56709d252cadd" &= help "Railgun contract address" &= typ "ADDRESS"
  , derivationIndex = 0 &= help "Wallet derivation index (default 0)" &= typ "INDEX"
  , showNotes = False &= help "Show individual notes (not just totals)"
  } &= help "Show shielded token balances"

main :: IO ()
main = do
  opts <- cmdArgs $ modes [loginMode, createWalletMode, listAddressesMode, shieldMode, unshieldMode, balanceMode]
    &= summary "airlock - Railgun privacy wallet for STRATO"
    &= program "airlock"
  
  case opts of
    Login{} -> runLogin
    CreateWallet{} -> runCreateWallet opts
    ListAddresses{} -> runListAddresses opts
    Shield{} -> runShield opts
    Unshield{} -> runUnshield opts
    Balance{} -> runBalance opts

runLogin :: IO ()
runLogin = do
  TIO.putStrLn "=== Airlock Login (OAuth Device Flow) ==="
  TIO.putStrLn ""
  
  -- Read OAuth config
  config <- readOAuthConfig
  
  when (T.null $ oauthClientSecret config) $ do
    hPutStrLn stderr "Error: OAUTH_CLIENT_SECRET not set in config file"
    exitFailure
  
  manager <- newManager tlsManagerSettings
  
  -- Step 1: Request device code
  TIO.putStrLn "Requesting device code..."
  deviceReq <- parseRequest $ T.unpack $ oauthDeviceUrl config
  let deviceReqWithBody = urlEncodedBody
        [ ("client_id", TE.encodeUtf8 $ oauthClientId config)
        , ("client_secret", TE.encodeUtf8 $ oauthClientSecret config)
        ] deviceReq
  
  deviceResp <- httpLbs deviceReqWithBody manager
  
  case decode (responseBody deviceResp) of
    Nothing -> do
      hPutStrLn stderr $ "Error: Failed to parse device code response: " ++ show (responseBody deviceResp)
      exitFailure
    Just deviceJson -> do
      let getValue key = parseMaybe (\obj -> obj .: key) deviceJson :: Maybe T.Text
          getValueInt key = parseMaybe (\obj -> obj .: key) deviceJson :: Maybe Int
      
      case (getValue "user_code", getValue "verification_uri", getValue "device_code", getValueInt "interval") of
        (Just userCode, Just verifyUri, Just deviceCode, Just interval) -> do
          TIO.putStrLn ""
          TIO.putStrLn "============================================================"
          TIO.putStrLn ""
          TIO.putStrLn $ "  Go to: " <> verifyUri
          TIO.putStrLn $ "  Enter code: " <> userCode
          TIO.putStrLn ""
          TIO.putStrLn "============================================================"
          TIO.putStrLn ""
          TIO.putStrLn "Waiting for authentication..."
          
          -- Step 2: Poll for token
          pollForToken manager config deviceCode interval
        _ -> do
          hPutStrLn stderr "Error: Invalid device code response"
          exitFailure

pollForToken :: Manager -> OAuthConfig -> T.Text -> Int -> IO ()
pollForToken manager config deviceCode interval = do
  threadDelay (interval * 1000000)  -- Wait interval seconds
  
  tokenReq <- parseRequest $ T.unpack $ oauthTokenUrl config
  let tokenReqWithBody = urlEncodedBody
        [ ("client_id", TE.encodeUtf8 $ oauthClientId config)
        , ("client_secret", TE.encodeUtf8 $ oauthClientSecret config)
        , ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
        , ("device_code", TE.encodeUtf8 deviceCode)
        ] tokenReq
  
  tokenResp <- httpLbs tokenReqWithBody manager
  
  case decode (responseBody tokenResp) of
    Nothing -> do
      hPutStrLn stderr $ "Error: Failed to parse token response"
      exitFailure
    Just tokenJson -> do
      let getError = parseMaybe (\obj -> obj .: "error") tokenJson :: Maybe T.Text
          getToken = parseMaybe (\obj -> obj .: "access_token") tokenJson :: Maybe T.Text
      
      case (getError, getToken) of
        (Just "authorization_pending", _) -> do
          TIO.putStr "."
          hFlush stdout
          pollForToken manager config deviceCode interval
        (Just "slow_down", _) -> do
          TIO.putStr "."
          hFlush stdout
          pollForToken manager config deviceCode (interval + 1)
        (Just err, _) -> do
          TIO.putStrLn ""
          TIO.hPutStrLn stderr $ "Authentication failed: " <> err
          exitFailure
        (Nothing, Just token) -> do
          let getRefresh = parseMaybe (\obj -> obj .: "refresh_token") tokenJson :: Maybe T.Text
              getExpiresIn = parseMaybe (\obj -> obj .: "expires_in") tokenJson :: Maybe Int
          
          case (getRefresh, getExpiresIn) of
            (Just refreshTok, Just expiresIn) -> do
              TIO.putStrLn ""
              TIO.putStrLn ""
              TIO.putStrLn "Login successful!"
              
              -- Save tokens with expiry
              now <- round <$> getPOSIXTime
              saveTokens token refreshTok (now + fromIntegral expiresIn)
              
              path <- tokenFilePath
              TIO.putStrLn $ "Token saved to: " <> T.pack path
              TIO.putStrLn "Token will auto-refresh when expired."
              exitSuccess
            _ -> do
              TIO.putStrLn ""
              TIO.putStrLn ""
              TIO.putStrLn "Login successful! (no refresh token received)"
              
              -- Save without refresh token (will need to re-login when expired)
              now <- round <$> getPOSIXTime
              saveTokens token "" (now + 300)  -- Assume 5 min default
              
              path <- tokenFilePath
              TIO.putStrLn $ "Token saved to: " <> T.pack path
              exitSuccess
        _ -> do
          TIO.putStrLn ""
          hPutStrLn stderr $ "Unexpected response: " ++ show (responseBody tokenResp)
          exitFailure

runCreateWallet :: Command -> IO ()
runCreateWallet opts = do
  path <- mnemonicFilePath
  exists <- doesFileExist path
  
  myWhen (exists && not (forceOverwrite opts)) $ do
    hPutStrLn stderr $ "Error: Mnemonic already exists at " ++ path
    hPutStrLn stderr "Use --forceoverwrite to replace it (this will change your wallet!)."
    exitFailure
  
  TIO.putStrLn "=== Airlock Wallet Setup ==="
  TIO.putStrLn ""
  TIO.putStrLn "Enter your BIP39 mnemonic phrase (12-24 words)."
  TIO.putStrLn "This will be stored securely and used for all airlock commands."
  TIO.putStrLn ""
  TIO.putStr "Mnemonic: "
  hFlush stdout
  
  -- Read mnemonic (hidden input)
  mnemonic <- getHiddenLine
  TIO.putStrLn ""
  
  let mnemonicText = T.strip $ T.pack mnemonic
      wordCount = length $ T.words mnemonicText
  
  -- Validate word count
  myWhen (wordCount `notElem` [12, 15, 18, 21, 24]) $ do
    hPutStrLn stderr $ "Error: Invalid mnemonic - expected 12, 15, 18, 21, or 24 words, got " ++ show wordCount
    exitFailure
  
  -- Verify we can derive keys from it
  case deriveFromMnemonic mnemonicText "" 0 of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error: Invalid mnemonic - " <> err
      exitFailure
    Right keys -> do
      -- Create directory if needed
      home <- getHomeDirectory
      createDirectoryIfMissing True (home </> ".secrets")
      
      -- Write mnemonic to file
      TIO.writeFile path mnemonicText
      
      let addr = railgunAddress keys
      TIO.putStrLn "Wallet created successfully!"
      TIO.putStrLn ""
      TIO.putStrLn $ "Mnemonic stored at: " <> T.pack path
      TIO.putStrLn $ "Railgun address (index 0): " <> unRailgunAddress addr
      TIO.putStrLn ""
      TIO.putStrLn "You can now use 'airlock balance', 'airlock shield', etc."
      TIO.putStrLn "Use 'airlock list_addresses' to see all derived addresses."
      exitSuccess

runListAddresses :: Command -> IO ()
runListAddresses opts = do
  mnemonic <- readMnemonicFromFile
  
  TIO.putStrLn "============================================================"
  TIO.putStrLn "                  DERIVED ADDRESSES"
  TIO.putStrLn "============================================================"
  TIO.putStrLn ""
  
  let indices = [0 .. numAddresses opts - 1]
  mapM_ (printAddressAtIndex mnemonic (T.pack $ passphrase opts)) indices
  
  TIO.putStrLn "============================================================"
  exitSuccess

printAddressAtIndex :: T.Text -> T.Text -> Int -> IO ()
printAddressAtIndex mnemonic passphraseText idx = do
  case deriveFromMnemonic mnemonic passphraseText idx of
    Left err -> TIO.putStrLn $ "  [" <> T.pack (show idx) <> "] Error: " <> err
    Right keys -> do
      let addr = railgunAddress keys
      TIO.putStrLn $ "  [" <> T.pack (show idx) <> "] " <> unRailgunAddress addr

-- | Read a line with hidden input (for sensitive data)
getHiddenLine :: IO String
getHiddenLine = do
  result <- try $ do
    old <- hGetEcho stdin
    hSetEcho stdin False
    line <- getLine
    hSetEcho stdin old
    return line
  case result of
    Left (_ :: SomeException) -> getLine  -- Fallback if echo control fails
    Right line -> return line

-- | Load keys from mnemonic file
loadKeys :: String -> Int -> IO RailgunKeys
loadKeys passphraseStr idx = do
  mnemonic <- readMnemonicFromFile
  case deriveFromMnemonic mnemonic (T.pack passphraseStr) idx of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error deriving keys: " <> err
      exitFailure
    Right keys -> return keys

runShield :: Command -> IO ()
runShield opts = do
  myWhen (null $ tokenAddress opts) $ do
    hPutStrLn stderr "Error: --tokenaddress is required"
    exitFailure
  
  -- Load keys from mnemonic file
  TIO.putStrLn "Loading Railgun keys..."
  keys <- loadKeys (passphrase opts) (derivationIndex opts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  
  -- Create shield request
  TIO.putStrLn "Creating shield request..."
  shieldReq <- createERC20ShieldRequest keys (T.pack $ tokenAddress opts) (amount opts)
  
  if dryRun opts
    then do
      TIO.putStrLn "\n=== Shield Request (dry run) ==="
      TIO.putStrLn $ serializeShieldRequest shieldReq
      exitSuccess
    else do
      -- Read auth token
      authToken <- readAuthToken
      
      let (host, port) = parseHostPort (baseUrl opts)
          config = StratoConfig
            { stratoHost = T.pack host
            , stratoPort = port
            , stratoAuthToken = authToken
            , railgunContractAddress = T.pack $ railgunContractAddr opts
            }
      
      -- Optionally approve tokens first
      myWhen (approveFirst opts) $ do
        TIO.putStrLn $ "Approving " <> T.pack (show $ amount opts) <> " tokens..."
        approveResult <- approveToken config (T.pack $ tokenAddress opts) (amount opts)
        case approveResult of
          Left err -> do
            TIO.hPutStrLn stderr $ "Approval failed: " <> err
            exitFailure
          Right results -> TIO.putStrLn $ "Approval successful: " <> T.pack (show $ length results) <> " transaction(s)"
      
      -- Send shield transaction
      TIO.putStrLn "Sending shield transaction..."
      shieldResult <- callShield config [shieldReq]
      case shieldResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Shield failed: " <> err
          exitFailure
        Right results -> do
          TIO.putStrLn $ "Shield successful: " <> T.pack (show $ length results) <> " transaction result(s)"
          TIO.putStrLn "Shield successful!"
      
      exitSuccess

runUnshield :: Command -> IO ()
runUnshield opts = do
  myWhen (null $ tokenAddress opts) $ do
    hPutStrLn stderr "Error: --tokenaddress is required"
    exitFailure
  
  myWhen (null $ recipient opts) $ do
    hPutStrLn stderr "Error: --recipient is required"
    exitFailure
  
  -- Load keys from mnemonic file
  TIO.putStrLn "Loading Railgun keys..."
  keys <- loadKeys (passphrase opts) (derivationIndex opts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  
  -- Create DUMMY unshield request
  TIO.putStrLn "\n*** WARNING: This creates a DUMMY unshield request ***"
  TIO.putStrLn "*** The transaction WILL FAIL on-chain (invalid proof) ***"
  TIO.putStrLn "*** This is for testing transaction structure only ***\n"
  
  let unshieldReq = createDummyUnshieldRequest 
                      (T.pack $ tokenAddress opts)
                      (amount opts)
                      (T.pack $ recipient opts)
  
  if dryRun opts
    then do
      TIO.putStrLn "\n=== Unshield Request (dry run) ==="
      TIO.putStrLn $ serializeUnshieldRequest unshieldReq
      exitSuccess
    else do
      -- Read auth token
      authToken <- readAuthToken
      
      let (host, port) = parseHostPort (baseUrl opts)
          config = StratoConfig
            { stratoHost = T.pack host
            , stratoPort = port
            , stratoAuthToken = authToken
            , railgunContractAddress = T.pack $ railgunContractAddr opts
            }
      
      -- Send unshield transaction
      TIO.putStrLn "Sending unshield transaction (will fail with invalid proof)..."
      unshieldResult <- callTransact config unshieldReq
      case unshieldResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Unshield failed (expected): " <> err
          exitFailure
        Right results -> do
          TIO.putStrLn $ "Unshield response: " <> T.pack (show $ length results) <> " transaction result(s)"
          TIO.putStrLn "Unshield request sent (likely failed verification)."
      
      exitSuccess

runBalance :: Command -> IO ()
runBalance opts = do
  -- Load keys from mnemonic file
  TIO.putStrLn "Loading Railgun keys..."
  keys <- loadKeys (passphrase opts) (derivationIndex opts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  TIO.putStrLn ""
  
  -- Read auth token
  authToken <- readAuthToken
  
  TIO.putStrLn "Scanning Shield events..."
  TIO.putStrLn ""
  
  -- Scan for shielded notes
  result <- scanShieldedBalance keys 
              (T.pack $ baseUrl opts) 
              authToken 
              (T.pack $ railgunContractAddr opts)
  
  case result of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error scanning events: " <> err
      exitFailure
    Right (notes, balances) -> do
      TIO.putStrLn "============================================================"
      TIO.putStrLn "               SHIELDED BALANCE SUMMARY"
      TIO.putStrLn "============================================================"
      TIO.putStrLn ""
      
      if null balances
        then TIO.putStrLn "  No shielded notes found for this wallet."
        else do
          mapM_ printBalance balances
          TIO.putStrLn ""
          TIO.putStrLn $ "  Total notes: " <> T.pack (show $ length notes)
      
      -- Optionally show individual notes
      myWhen (showNotes opts && not (null notes)) $ do
        TIO.putStrLn ""
        TIO.putStrLn "============================================================"
        TIO.putStrLn "                   INDIVIDUAL NOTES"
        TIO.putStrLn "============================================================"
        TIO.putStrLn ""
        mapM_ printNote notes
      
      TIO.putStrLn ""
      TIO.putStrLn "============================================================"
      exitSuccess

printBalance :: TokenBalance -> IO ()
printBalance tb = do
  let tokenDisplay = case tbTokenType tb of
        ERC20 -> "ERC20"
        ERC721 -> "ERC721"
        ERC1155 -> "ERC1155"
      valueInTokens = fromIntegral (tbTotalValue tb) / (1e18 :: Double)
  TIO.putStrLn $ "  Token: 0x" <> tbTokenAddress tb <> " (" <> tokenDisplay <> ")"
  TIO.putStrLn $ "  Balance: " <> T.pack (printf "%.18f" valueInTokens) <> " tokens"
  TIO.putStrLn $ "  Raw wei: " <> T.pack (show $ tbTotalValue tb)
  TIO.putStrLn $ "  Notes: " <> T.pack (show $ tbNoteCount tb)
  TIO.putStrLn ""

printNote :: ShieldedNote -> IO ()
printNote note = do
  let valueInTokens = fromIntegral (snValue note) / (1e18 :: Double)
  TIO.putStrLn $ "  Note at tree position " <> T.pack (show $ snTreePosition note) <> " (block " <> snBlockNumber note <> ")"
  TIO.putStrLn $ "    Token: 0x" <> snTokenAddress note
  TIO.putStrLn $ "    Value: " <> T.pack (printf "%.18f" valueInTokens) <> " tokens"
  TIO.putStrLn ""

-- | Helper for when (from Control.Monad, but avoiding import collision)
myWhen :: Bool -> IO () -> IO ()
myWhen True action = action
myWhen False _ = return ()

-- | Parse host and port from a URL string like "http://localhost:8081"
parseHostPort :: String -> (String, Int)
parseHostPort url = case parseURI url of
  Just uri -> case uriAuthority uri of
    Just auth -> 
      let host = uriRegName auth
          portStr = dropWhile (== ':') (uriPort auth)
          port = if null portStr then 80 else read portStr
      in (host, port)
    Nothing -> ("localhost", 8081)
  Nothing -> ("localhost", 8081)
