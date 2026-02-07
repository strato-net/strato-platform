{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Main where

import Control.Concurrent (threadDelay)
import Control.Exception (try, SomeException)
import Control.Monad (when, unless, forM_)
import Data.Aeson (decode, encode, (.:), (.=), object)
import Data.Aeson.Types (parseMaybe)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Lazy as LBS
import Data.Time.Clock.POSIX (getPOSIXTime)
import Options.Applicative
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

import Bloc.API (BlocTransactionResult(..))
import qualified Bloc.API as Bloc
import Blockchain.Strato.Model.Keccak256 (keccak256ToHex)
import Railgun.Keys (deriveFromMnemonic, railgunAddress, getMasterPublicKeyPoint)
import Railgun.Shield (createERC20ShieldRequest, serializeShieldRequest)
import Railgun.Unshield (createUnshieldRequest)
import Railgun.API (StratoConfig(..), defaultConfig, callShield, callTransact, approveToken, getChainId, getMerkleRoot, getTreeNumber, getBoundParamsHash, getUserAddress, getTokenBalance, getTokenDecimals, formatTokenAmount, parseTokenAmount)
import Railgun.Types (RailgunAddress(..), RailgunKeys(..), TokenType(..))
import Railgun.Balance (scanShieldedBalance, TokenBalance(..))
import qualified Railgun.Balance as Bal
import Railgun.Merkle (fetchMerkleTreeData, computeMerkleProof, MerkleTreeData(..))
import Railgun.Crypto (poseidonHash, computeNullifier)
import Railgun.Witness (SpendableNote(..), buildUnshieldWitness)
import Railgun.Prover (generateProof, defaultProverConfig)
import Railgun.Signing (deriveSigningKey, signTransactionData, computeSignatureMessage, RailgunSignature(..))

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

--------------------------------------------------------------------------------
-- Command line parsing with optparse-applicative
--------------------------------------------------------------------------------

data Command
  = Login
  | CreateWallet CreateWalletOpts
  | ListAddresses ListAddressesOpts
  | Shield ShieldOpts
  | Unshield UnshieldOpts
  | Balance BalanceOpts
  deriving (Show)

data CreateWalletOpts = CreateWalletOpts
  { cwoForceOverwrite :: Bool
  } deriving (Show)

data ListAddressesOpts = ListAddressesOpts
  { laoPassphrase :: String
  , laoNumAddresses :: Int
  } deriving (Show)

data ShieldOpts = ShieldOpts
  { soPassphrase :: String
  , soTokenAddress :: String
  , soAmount :: Integer
  , soBaseUrl :: String
  , soRailgunContractAddr :: String
  , soDerivationIndex :: Int
  , soApproveFirst :: Bool
  , soDryRun :: Bool
  } deriving (Show)

data UnshieldOpts = UnshieldOpts
  { uoPassphrase :: String
  , uoTokenAddress :: String
  , uoAmount :: String  -- Amount in tokens (e.g., "1.5") or empty for entire note
  , uoRecipient :: String
  , uoBaseUrl :: String
  , uoRailgunContractAddr :: String
  , uoDerivationIndex :: Int
  , uoDryRun :: Bool
  } deriving (Show)

data BalanceOpts = BalanceOpts
  { boPassphrase :: String
  , boBaseUrl :: String
  , boRailgunContractAddr :: String
  , boDerivationIndex :: Int
  , boShowNotes :: Bool
  , boTokenAddress :: Maybe String  -- ^ Optional: check specific token's unshielded balance
  } deriving (Show)

-- | Parser for login command
loginParser :: Parser Command
loginParser = pure Login

-- | Parser for create_wallet command
createWalletParser :: Parser Command
createWalletParser = CreateWallet <$> (CreateWalletOpts
  <$> switch
      ( long "force"
     <> help "Overwrite existing mnemonic (dangerous!)" ))

-- | Parser for list_addresses command
listAddressesParser :: Parser Command
listAddressesParser = ListAddresses <$> (ListAddressesOpts
  <$> strOption
      ( long "passphrase"
     <> value ""
     <> metavar "PASSPHRASE"
     <> help "Optional BIP39 passphrase" )
  <*> option auto
      ( long "num"
     <> value 10
     <> metavar "NUM"
     <> help "Number of addresses to display (default 10)" ))

-- | Parser for shield command
shieldParser :: Parser Command
shieldParser = Shield <$> (ShieldOpts
  <$> strOption
      ( long "passphrase"
     <> value ""
     <> metavar "PASSPHRASE"
     <> help "Optional BIP39 passphrase" )
  <*> strOption
      ( long "tokenaddress"
     <> value ""
     <> metavar "ADDRESS"
     <> help "ERC20 token contract address" )
  <*> option auto
      ( long "amount"
     <> value 1000000000000000000
     <> metavar "AMOUNT"
     <> help "Amount to shield (in smallest unit, default 1e18)" )
  <*> strOption
      ( long "baseurl"
     <> value "http://localhost:8081"
     <> metavar "URL"
     <> help "STRATO base URL" )
  <*> strOption
      ( long "railguncontractaddr"
     <> value "95be101d075f44084ca1cf51d0106c8606773952"
     <> metavar "ADDRESS"
     <> help "Railgun contract address" )
  <*> option auto
      ( long "derivationindex"
     <> value 0
     <> metavar "INDEX"
     <> help "Wallet derivation index (default 0)" )
  <*> switch
      ( long "approvefirst"
     <> help "Approve tokens before shielding" )
  <*> switch
      ( long "dryrun"
     <> help "Show request without sending" ))

-- | Parser for unshield command
unshieldParser :: Parser Command
unshieldParser = Unshield <$> (UnshieldOpts
  <$> strOption
      ( long "passphrase"
     <> value ""
     <> metavar "PASSPHRASE"
     <> help "Optional BIP39 passphrase" )
  <*> strOption
      ( long "tokenaddress"
     <> value ""
     <> metavar "ADDRESS"
     <> help "ERC20 token contract address" )
  <*> strOption
      ( long "amount"
     <> value ""
     <> metavar "AMOUNT"
     <> help "Amount to unshield in tokens (e.g., '1.5'), empty = entire note" )
  <*> strOption
      ( long "recipient"
     <> value ""
     <> metavar "ADDRESS"
     <> help "Recipient address for unshielded tokens" )
  <*> strOption
      ( long "baseurl"
     <> value "http://localhost:8081"
     <> metavar "URL"
     <> help "STRATO base URL" )
  <*> strOption
      ( long "railguncontractaddr"
     <> value "95be101d075f44084ca1cf51d0106c8606773952"
     <> metavar "ADDRESS"
     <> help "Railgun contract address" )
  <*> option auto
      ( long "derivationindex"
     <> value 0
     <> metavar "INDEX"
     <> help "Wallet derivation index (default 0)" )
  <*> switch
      ( long "dryrun"
     <> help "Show request without sending" ))

-- | Parser for balance command
balanceParser :: Parser Command
balanceParser = Balance <$> (BalanceOpts
  <$> strOption
      ( long "passphrase"
     <> value ""
     <> metavar "PASSPHRASE"
     <> help "Optional BIP39 passphrase" )
  <*> strOption
      ( long "baseurl"
     <> value "http://localhost:8081"
     <> metavar "URL"
     <> help "STRATO base URL" )
  <*> strOption
      ( long "railguncontractaddr"
     <> value "95be101d075f44084ca1cf51d0106c8606773952"
     <> metavar "ADDRESS"
     <> help "Railgun contract address" )
  <*> option auto
      ( long "derivationindex"
     <> value 0
     <> metavar "INDEX"
     <> help "Wallet derivation index (default 0)" )
  <*> switch
      ( long "shownotes"
     <> help "Show individual notes (not just totals)" )
  <*> optional (strOption
      ( long "tokenaddress"
     <> metavar "ADDRESS"
     <> help "Check unshielded balance for specific token" )))

-- | Combined command parser
commandParser :: Parser Command
commandParser = hsubparser
  ( command "login"
    (info loginParser
      (progDesc "Authenticate using OAuth device flow"))
  <> command "create_wallet"
    (info createWalletParser
      (progDesc "Create wallet by storing a mnemonic phrase"))
  <> command "list_addresses"
    (info listAddressesParser
      (progDesc "List derived addresses from the wallet"))
  <> command "shield"
    (info shieldParser
      (progDesc "Shield (deposit) tokens into Railgun"))
  <> command "unshield"
    (info unshieldParser
      (progDesc "Unshield (withdraw) tokens from Railgun (DUMMY - will fail verification)"))
  <> command "balance"
    (info balanceParser
      (progDesc "Show token balances (shielded and unshielded)"))
  )

-- | Main parser with info
opts :: ParserInfo Command
opts = info (commandParser <**> helper)
  ( fullDesc
 <> progDesc "Railgun privacy wallet for STRATO"
 <> header "airlock - Railgun privacy wallet for STRATO" )

main :: IO ()
main = do
  cmd <- customExecParser prefs' opts
  case cmd of
    Login -> runLogin
    CreateWallet o -> runCreateWallet o
    ListAddresses o -> runListAddresses o
    Shield o -> runShield o
    Unshield o -> runUnshield o
    Balance o -> runBalance o
  where
    prefs' = prefs showHelpOnEmpty

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

runCreateWallet :: CreateWalletOpts -> IO ()
runCreateWallet cwopts = do
  path <- mnemonicFilePath
  exists <- doesFileExist path
  
  when (exists && not (cwoForceOverwrite cwopts)) $ do
    hPutStrLn stderr $ "Error: Mnemonic already exists at " ++ path
    hPutStrLn stderr "Use --force to replace it (this will change your wallet!)."
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
  when (wordCount `notElem` [12, 15, 18, 21, 24]) $ do
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

runListAddresses :: ListAddressesOpts -> IO ()
runListAddresses laopts = do
  mnemonic <- readMnemonicFromFile
  
  TIO.putStrLn "============================================================"
  TIO.putStrLn "                  DERIVED ADDRESSES"
  TIO.putStrLn "============================================================"
  TIO.putStrLn ""
  
  let indices = [0 .. laoNumAddresses laopts - 1]
  mapM_ (printAddressAtIndex mnemonic (T.pack $ laoPassphrase laopts)) indices
  
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

runShield :: ShieldOpts -> IO ()
runShield sopts = do
  when (null $ soTokenAddress sopts) $ do
    hPutStrLn stderr "Error: --tokenaddress is required"
    exitFailure
  
  -- Load keys from mnemonic file
  TIO.putStrLn "Loading Railgun keys..."
  keys <- loadKeys (soPassphrase sopts) (soDerivationIndex sopts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  
  -- Create shield request
  TIO.putStrLn "Creating shield request..."
  shieldReq <- createERC20ShieldRequest keys (T.pack $ soTokenAddress sopts) (soAmount sopts)
  
  if soDryRun sopts
    then do
      TIO.putStrLn "\n=== Shield Request (dry run) ==="
      TIO.putStrLn $ serializeShieldRequest shieldReq
      exitSuccess
    else do
      -- Read auth token
      authToken <- readAuthToken
      
      let (host, port) = parseHostPort (soBaseUrl sopts)
          config = StratoConfig
            { stratoHost = T.pack host
            , stratoPort = port
            , stratoAuthToken = authToken
            , railgunContractAddress = T.pack $ soRailgunContractAddr sopts
            }
      
      -- Optionally approve tokens first
      when (soApproveFirst sopts) $ do
        TIO.putStrLn $ "Approving " <> T.pack (show $ soAmount sopts) <> " tokens..."
        approveResult <- approveToken config (T.pack $ soTokenAddress sopts) (soAmount sopts)
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
          when ("insufficient allowance" `T.isInfixOf` T.toLower err) $
            TIO.hPutStrLn stderr "\nHint: Use --approvefirst to approve the Railgun contract to spend your tokens."
          exitFailure
        Right results -> do
          TIO.putStrLn $ "Shield response: " <> T.pack (show $ length results) <> " transaction result(s)"
          mapM_ printTxResult results
      
      exitSuccess

runUnshield :: UnshieldOpts -> IO ()
runUnshield uopts = do
  when (null $ uoTokenAddress uopts) $ do
    hPutStrLn stderr "Error: --tokenaddress is required"
    exitFailure
  
  when (null $ uoRecipient uopts) $ do
    hPutStrLn stderr "Error: --recipient is required"
    exitFailure
  
  -- Load keys from mnemonic file
  TIO.putStrLn "Loading Railgun keys..."
  keys <- loadKeys (uoPassphrase uopts) (uoDerivationIndex uopts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  
  -- Read auth token
  authToken <- readAuthToken
  
  let (host, port) = parseHostPort (uoBaseUrl uopts)
      config = StratoConfig
        { stratoHost = T.pack host
        , stratoPort = port
        , stratoAuthToken = authToken
        , railgunContractAddress = T.pack $ uoRailgunContractAddr uopts
        }
      baseUrl = "http://" <> T.pack host <> ":" <> T.pack (show port)
      tokenAddr = T.toLower $ normalizeAddress $ T.pack $ uoTokenAddress uopts
  
  -- Step 1: Scan for our notes
  TIO.putStrLn "\nScanning for shielded notes..."
  notesResult <- scanShieldedBalance keys baseUrl authToken (railgunContractAddress config)
  (notes, _) <- case notesResult of
    Left err -> do
      TIO.hPutStrLn stderr $ "Failed to scan notes: " <> err
      exitFailure
    Right r -> return r
  
  TIO.putStrLn $ "Found " <> T.pack (show $ length notes) <> " note(s)"
  
  -- Get token decimals for formatting and parsing
  decimals <- getTokenDecimals config tokenAddr
  
  -- Parse requested amount (empty string = entire note)
  requestedAmount <- case parseTokenAmount (T.pack $ uoAmount uopts) decimals of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error: " <> err
      exitFailure
    Right amt -> return amt
  
  -- Step 2: Find a note for the requested token
  -- If amount is 0 (empty input), use the entire note value; otherwise find a note with enough value
  let tokenNotes = filter (\n -> T.toLower (Bal.snTokenAddress n) == tokenAddr) notes
  
  (noteToSpend, actualAmount) <- case tokenNotes of
    [] -> do
      TIO.hPutStrLn stderr $ "No notes found for token " <> tokenAddr
      TIO.hPutStrLn stderr "Available notes:"
      mapM_ (\n -> TIO.hPutStrLn stderr $ "  " <> Bal.snTokenAddress n <> ": " <> formatTokenAmount (Bal.snValue n) decimals) notes
      exitFailure
    (n:_) | requestedAmount == 0 -> do
      -- Use the first note's full value
      return (n, Bal.snValue n)
    ns -> do
      -- Find a note with enough value
      let matchingNotes = filter (\n -> Bal.snValue n >= requestedAmount) ns
      case matchingNotes of
        [] -> do
          TIO.hPutStrLn stderr $ "No spendable note found for token " <> tokenAddr 
                              <> " with value >= " <> formatTokenAmount requestedAmount decimals
          TIO.hPutStrLn stderr "Available notes:"
          mapM_ (\n -> TIO.hPutStrLn stderr $ "  " <> Bal.snTokenAddress n <> ": " <> formatTokenAmount (Bal.snValue n) decimals) notes
          exitFailure
        (m:_) -> return (m, requestedAmount)
  
  TIO.putStrLn $ "Selected note at tree position " <> T.pack (show $ Bal.snTreePosition noteToSpend)
  TIO.putStrLn $ "  Note value: " <> formatTokenAmount (Bal.snValue noteToSpend) decimals
  TIO.putStrLn $ "  Unshielding: " <> formatTokenAmount actualAmount decimals
  
  if uoDryRun uopts
    then do
      TIO.putStrLn "\n=== Dry run - would unshield ==="
      TIO.putStrLn $ "  Token: " <> tokenAddr
      TIO.putStrLn $ "  Amount: " <> formatTokenAmount actualAmount decimals
      TIO.putStrLn $ "  Recipient: " <> T.pack (uoRecipient uopts)
      exitSuccess
    else do
      -- Step 3: Get chain ID and merkle root
      TIO.putStrLn "\nFetching chain ID..."
      chainIdResult <- getChainId config
      chainId <- case chainIdResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to get chain ID: " <> err
          exitFailure
        Right cid -> do
          TIO.putStrLn $ "Chain ID: " <> T.pack (show cid)
          return cid
      
      TIO.putStrLn "Fetching merkle root..."
      merkleRootResult <- getMerkleRoot config
      merkleRootHex <- case merkleRootResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to get merkle root: " <> err
          exitFailure
        Right root -> do
          TIO.putStrLn $ "Merkle root: " <> root
          return root
      
      TIO.putStrLn "Fetching tree number..."
      treeNumResult <- getTreeNumber config
      treeNum <- case treeNumResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to get tree number: " <> err
          exitFailure
        Right tn -> do
          TIO.putStrLn $ "Tree number: " <> T.pack (show tn)
          return tn
      
      -- Step 4: Get Merkle proof for the note
      TIO.putStrLn "Fetching Merkle tree data..."
      merkleDataResult <- fetchMerkleTreeData 
                            (stratoHost config) 
                            (stratoPort config) 
                            authToken 
                            (railgunContractAddress config)
      treeData <- case merkleDataResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to fetch Merkle data: " <> err
          exitFailure
        Right td -> return td
      
      TIO.putStrLn $ "  Commitments: " <> T.pack (show $ length $ mtdCommitments treeData)
      
      let leafIndex = fromIntegral $ Bal.snTreePosition noteToSpend
      merkleProof <- case computeMerkleProof treeData leafIndex of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to compute Merkle proof: " <> err
          exitFailure
        Right mp -> do
          TIO.putStrLn $ "  Merkle proof computed for leaf " <> T.pack (show leafIndex)
          return mp
      
      -- Step 5: Build the SpendableNote
      let randomInt = bytesToIntegerBE (Bal.snRandom noteToSpend)
          npkInt = poseidonHash [masterPublicKey keys, randomInt]
          spendable = SpendableNote
            { snNoteIndex = Bal.snTreePosition noteToSpend
            , snNpk = npkInt
            , snValue = Bal.snValue noteToSpend
            , snTokenAddress = Bal.snTokenAddress noteToSpend
            , snRandom = randomInt
            }
      
      -- Step 6: Get Baby JubJub public key and generate signature
      TIO.putStrLn "\nPreparing circuit inputs..."
      
      let merkleRootInt = hexToInteger merkleRootHex
      
      -- Get Baby JubJub public key from spending key (same derivation as masterPublicKey)
      let (pkX, pkY) = getMasterPublicKeyPoint keys
      TIO.putStrLn $ "  Public key X: " <> T.pack (show pkX)
      TIO.putStrLn $ "  Public key Y: " <> T.pack (show pkY)
      
      -- Derive signing key (uses same spending key)
      signingKey <- case deriveSigningKey (spendingKey keys) of
        Nothing -> do
          TIO.hPutStrLn stderr "Failed to derive signing key"
          exitFailure
        Just sk -> return sk
      
      -- Compute values needed for signature message
      -- Nullifier = poseidon(nullifyingKey, leafIndex) - note: only 2 args
      let nullifierKeyInt = bytesToIntegerBE (nullifierKey keys)
          nullifier = computeNullifier nullifierKeyInt leafIndex
          
          -- Token and recipient as integers
          tokenId = hexToInteger (Bal.snTokenAddress noteToSpend)
          recipientInt = hexToInteger (T.pack $ uoRecipient uopts)
          
      -- Get bound params hash from contract (SolidVM has different ABI encoding)
      -- For unshield with 2 commitments (change + unshield), we need 1 ciphertext entry
      boundParamsHashResult <- getBoundParamsHash config (fromIntegral treeNum) chainId 1
      boundParamsHash <- case boundParamsHashResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to get boundParamsHash: " <> err
          exitFailure
        Right h -> do
          TIO.putStrLn $ "  BoundParamsHash: " <> T.pack (show h)
          return h
          
      let -- Compute output commitments
          unshieldCommitment = poseidonHash [recipientInt, tokenId, actualAmount]
          changeValue = Bal.snValue noteToSpend - actualAmount
          -- Always use our NPK for change commitment (even if value is 0)
          changeCommitment = poseidonHash [npkInt, tokenId, changeValue]
          
          -- Compute the message to sign
          sigMessage = computeSignatureMessage 
                         merkleRootInt 
                         boundParamsHash 
                         [nullifier] 
                         [changeCommitment, unshieldCommitment]  -- Change first, unshield last (contract expects unshield at last)
      
      TIO.putStrLn $ "  Nullifier: " <> T.pack (show nullifier)
      TIO.putStrLn $ "  Signature message: " <> T.pack (show sigMessage)
      
      -- Sign the message
      let signature = signTransactionData signingKey sigMessage
          sigR8x = rsR8x signature
          sigR8y = rsR8y signature
          sigS = rsS signature
      
      TIO.putStrLn $ "  Signature R.x: " <> T.pack (show sigR8x)
      TIO.putStrLn $ "  Signature R.y: " <> T.pack (show sigR8y)
      TIO.putStrLn $ "  Signature S: " <> T.pack (show sigS)
      
      -- Step 7: Build witness
      witnessResult <- case buildUnshieldWitness 
                              spendable 
                              merkleProof 
                              nullifierKeyInt
                              (pkX, pkY)
                              (sigR8x, sigR8y, sigS)
                              (T.pack $ uoRecipient uopts)
                              actualAmount
                              boundParamsHash
                              merkleRootInt of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to build witness: " <> err
          exitFailure
        Right w -> return w
      
      TIO.putStrLn "  Circuit inputs built"
      
      -- Step 8: Generate proof using snarkjs
      TIO.putStrLn "\nGenerating SNARK proof..."
      let proverConfig = defaultProverConfig
      
      proofResult <- generateProof proverConfig witnessResult
      snarkProof <- case proofResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Proof generation failed: " <> err
          exitFailure
        Right p -> do
          TIO.putStrLn "  Proof generated successfully"
          return p
      
      -- Step 9: Build and send the transaction
      let merkleRootBytes = hexToBytes merkleRootHex
          -- Build the real unshield request with actual proof
          unshieldReq = createUnshieldRequest
                          snarkProof
                          merkleRootBytes
                          nullifier
                          [changeCommitment, unshieldCommitment]  -- Change first, unshield last (contract expects unshield at last)
                          (T.pack $ uoTokenAddress uopts)
                          actualAmount
                          (T.pack $ uoRecipient uopts)
                          chainId
                          (fromIntegral treeNum)
      
      TIO.putStrLn "\nSending unshield transaction..."
      unshieldResult <- callTransact config unshieldReq
      case unshieldResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Unshield failed: " <> err
          exitFailure
        Right results -> do
          TIO.putStrLn $ "Unshield response: " <> T.pack (show $ length results) <> " transaction result(s)"
          mapM_ printTxResult results
      
      exitSuccess
  where
    normalizeAddress :: T.Text -> T.Text
    normalizeAddress t
      | "0x" `T.isPrefixOf` T.toLower t = T.drop 2 t
      | otherwise = t
    
    hexToInteger :: T.Text -> Integer
    hexToInteger t =
      let cleanHex = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 t else t
          digits = T.unpack cleanHex
      in foldl (\acc c -> acc * 16 + fromIntegral (hexDigitValue c)) 0 digits
    
    hexDigitValue :: Char -> Int
    hexDigitValue c
      | c >= '0' && c <= '9' = fromEnum c - fromEnum '0'
      | c >= 'a' && c <= 'f' = fromEnum c - fromEnum 'a' + 10
      | c >= 'A' && c <= 'F' = fromEnum c - fromEnum 'A' + 10
      | otherwise = 0
    
    -- Big-endian bytes to Integer conversion (for Poseidon hash inputs)
    bytesToIntegerBE :: BS.ByteString -> Integer
    bytesToIntegerBE = BS.foldl' (\acc b -> acc * 256 + fromIntegral b) 0

runBalance :: BalanceOpts -> IO ()
runBalance bopts = do
  -- Load keys from mnemonic file
  TIO.putStrLn "Loading Railgun keys..."
  keys <- loadKeys (boPassphrase bopts) (boDerivationIndex bopts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  TIO.putStrLn ""
  
  -- Read auth token
  authToken <- readAuthToken
  
  -- Create config for API calls
  let config = defaultConfig
        { stratoAuthToken = authToken
        , stratoHost = T.pack $ extractHost (boBaseUrl bopts)
        , stratoPort = extractPort (boBaseUrl bopts)
        , railgunContractAddress = T.pack $ boRailgunContractAddr bopts
        }
  
  -- Get user's Ethereum address for unshielded balances
  TIO.putStrLn "Getting user address..."
  userAddrResult <- getUserAddress config
  let maybeUserAddr = case userAddrResult of
        Right addr' -> Just addr'
        Left _ -> Nothing
  
  case maybeUserAddr of
    Just userAddr -> TIO.putStrLn $ "Ethereum address: 0x" <> userAddr
    Nothing -> return ()
  TIO.putStrLn ""
  
  TIO.putStrLn "Scanning Shield events..."
  TIO.putStrLn ""
  
  -- Scan for shielded notes
  result <- scanShieldedBalance keys 
              (T.pack $ boBaseUrl bopts) 
              authToken 
              (T.pack $ boRailgunContractAddr bopts)
  
  case result of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error scanning events: " <> err
      exitFailure
    Right (notes, balances) -> do
      TIO.putStrLn "============================================================"
      TIO.putStrLn "                    BALANCE SUMMARY"
      TIO.putStrLn "============================================================"
      TIO.putStrLn ""
      
      -- If a specific token address is requested, show its balance
      case boTokenAddress bopts of
        Just tokenAddr -> do
          let tokenAddrT = T.pack tokenAddr
              -- Find shielded balance for this token if any
              maybeShielded = filter (\tb -> T.toLower (tbTokenAddress tb) == T.toLower (normalizeAddr tokenAddrT)) balances
              shieldedValue = sum $ map tbTotalValue maybeShielded
              shieldedNotes = sum $ map tbNoteCount maybeShielded
              shieldedInTokens = fromIntegral shieldedValue / (1e18 :: Double)
          
          TIO.putStrLn $ "  Token: 0x" <> normalizeAddr tokenAddrT
          TIO.putStrLn $ "    Shielded:   " <> T.pack (printf "%.6f" shieldedInTokens) <> " tokens (" <> T.pack (show shieldedNotes) <> " notes)"
          
          case maybeUserAddr of
            Just userAddr -> do
              unshieldedResult <- getTokenBalance config tokenAddrT userAddr
              case unshieldedResult of
                Right unshieldedWei -> do
                  let unshieldedInTokens = fromIntegral unshieldedWei / (1e18 :: Double)
                      totalInTokens = shieldedInTokens + unshieldedInTokens
                  TIO.putStrLn $ "    Unshielded: " <> T.pack (printf "%.6f" unshieldedInTokens) <> " tokens"
                  TIO.putStrLn $ "    Total:      " <> T.pack (printf "%.6f" totalInTokens) <> " tokens"
                Left _ -> 
                  TIO.putStrLn "    Unshielded: (unable to fetch)"
            Nothing -> 
              TIO.putStrLn "    Unshielded: (unable to fetch user address)"
        
        Nothing -> do
          -- No specific token requested - show all balances
          -- Include default tokens (like USDST) even if no shielded notes
          let defaultTokens = ["937efa7e3a77e20bbdbd7c0d32b6514f368c1010"]  -- USDST
              shieldedTokenAddrs = map (T.toLower . tbTokenAddress) balances
              -- Find default tokens that aren't already in shielded balances
              extraTokens = filter (\t -> T.toLower t `notElem` shieldedTokenAddrs) defaultTokens
          
          -- Show shielded balances with unshielded
          unless (null balances) $ do
            mapM_ (printBalanceWithUnshielded config maybeUserAddr) balances
          
          -- Show default tokens that only have unshielded balance
          forM_ extraTokens $ \tokenAddr -> do
            case maybeUserAddr of
              Just userAddr -> do
                unshieldedResult <- getTokenBalance config tokenAddr userAddr
                case unshieldedResult of
                  Right unshieldedWei | unshieldedWei > 0 -> do
                    let unshieldedInTokens = fromIntegral unshieldedWei / (1e18 :: Double)
                    TIO.putStrLn $ "  Token: 0x" <> tokenAddr <> " (USDST)"
                    TIO.putStrLn $ "    Shielded:   0.000000 tokens (0 notes)"
                    TIO.putStrLn $ "    Unshielded: " <> T.pack (printf "%.6f" unshieldedInTokens) <> " tokens"
                    TIO.putStrLn $ "    Total:      " <> T.pack (printf "%.6f" unshieldedInTokens) <> " tokens"
                    TIO.putStrLn ""
                  _ -> return ()
              Nothing -> return ()
          
          when (null balances && null extraTokens) $
            TIO.putStrLn "  No balances found."
          
          unless (null notes) $ do
            TIO.putStrLn ""
            TIO.putStrLn $ "  Total shielded notes: " <> T.pack (show $ length notes)
      
      -- Optionally show individual notes
      when (boShowNotes bopts && not (null notes)) $ do
        TIO.putStrLn ""
        TIO.putStrLn "============================================================"
        TIO.putStrLn "                   INDIVIDUAL NOTES"
        TIO.putStrLn "============================================================"
        TIO.putStrLn ""
        mapM_ printNote notes
      
      TIO.putStrLn ""
      TIO.putStrLn "============================================================"
      exitSuccess
  where
    normalizeAddr t = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 (T.toLower t) else T.toLower t

-- | Extract host from URL like "http://localhost:8081"
extractHost :: String -> String
extractHost url = 
  let withoutScheme = dropWhile (/= '/') $ dropWhile (/= ':') url
      hostPart = takeWhile (/= ':') $ drop 2 withoutScheme  -- skip "//"
  in if null hostPart then "localhost" else hostPart

-- | Extract port from URL like "http://localhost:8081"
extractPort :: String -> Int
extractPort url =
  let afterHost = dropWhile (/= ':') $ drop 7 url  -- skip "http://"
      portStr = takeWhile (\c -> c >= '0' && c <= '9') $ drop 1 afterHost
  in if null portStr then 8081 else read portStr

printBalance :: TokenBalance -> IO ()
printBalance tb = do
  let tokenDisplay = case tbTokenType tb of
        ERC20 -> "ERC20"
        ERC721 -> "ERC721"
        ERC1155 -> "ERC1155"
      valueInTokens = fromIntegral (tbTotalValue tb) / (1e18 :: Double)
  TIO.putStrLn $ "  Token: 0x" <> tbTokenAddress tb <> " (" <> tokenDisplay <> ")"
  TIO.putStrLn $ "  Shielded: " <> T.pack (printf "%.18f" valueInTokens) <> " tokens"
  TIO.putStrLn $ "  Raw wei: " <> T.pack (show $ tbTotalValue tb)
  TIO.putStrLn $ "  Notes: " <> T.pack (show $ tbNoteCount tb)
  TIO.putStrLn ""

printBalanceWithUnshielded :: StratoConfig -> Maybe T.Text -> TokenBalance -> IO ()
printBalanceWithUnshielded config maybeUserAddr tb = do
  let tokenDisplay = case tbTokenType tb of
        ERC20 -> "ERC20"
        ERC721 -> "ERC721"
        ERC1155 -> "ERC1155"
      shieldedInTokens = fromIntegral (tbTotalValue tb) / (1e18 :: Double)
  
  TIO.putStrLn $ "  Token: 0x" <> tbTokenAddress tb <> " (" <> tokenDisplay <> ")"
  TIO.putStrLn $ "    Shielded:   " <> T.pack (printf "%.6f" shieldedInTokens) <> " tokens (" <> T.pack (show $ tbNoteCount tb) <> " notes)"
  
  -- Get unshielded balance if we have user address
  case maybeUserAddr of
    Just userAddr -> do
      unshieldedResult <- getTokenBalance config (tbTokenAddress tb) userAddr
      case unshieldedResult of
        Right unshieldedWei -> do
          let unshieldedInTokens = fromIntegral unshieldedWei / (1e18 :: Double)
              totalInTokens = shieldedInTokens + unshieldedInTokens
          TIO.putStrLn $ "    Unshielded: " <> T.pack (printf "%.6f" unshieldedInTokens) <> " tokens"
          TIO.putStrLn $ "    Total:      " <> T.pack (printf "%.6f" totalInTokens) <> " tokens"
        Left _ -> 
          TIO.putStrLn "    Unshielded: (unable to fetch)"
    Nothing -> 
      TIO.putStrLn "    Unshielded: (unable to fetch user address)"
  TIO.putStrLn ""

printNote :: Bal.ShieldedNote -> IO ()
printNote note = do
  let valueInTokens = fromIntegral (Bal.snValue note) / (1e18 :: Double)
  TIO.putStrLn $ "  Note at tree position " <> T.pack (show $ Bal.snTreePosition note) <> " (block " <> Bal.snBlockNumber note <> ")"
  TIO.putStrLn $ "    Token: 0x" <> Bal.snTokenAddress note
  TIO.putStrLn $ "    Value: " <> T.pack (printf "%.18f" valueInTokens) <> " tokens"
  TIO.putStrLn ""

-- | Print transaction result with status
printTxResult :: BlocTransactionResult -> IO ()
printTxResult result = do
  let status = blocTransactionStatus result
      txHash = T.pack $ keccak256ToHex $ blocTransactionHash result
  case status of
    Bloc.Success -> TIO.putStrLn $ "  Transaction " <> txHash <> ": SUCCESS"
    Bloc.Failure -> TIO.putStrLn $ "  Transaction " <> txHash <> ": FAILED"
    Bloc.Pending -> TIO.putStrLn $ "  Transaction " <> txHash <> ": PENDING"

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

-- | Convert hex string to ByteString
hexToBytes :: T.Text -> BS.ByteString
hexToBytes hex = 
  let cleanHex = if "0x" `T.isPrefixOf` T.toLower hex then T.drop 2 hex else hex
  in case B16.decode (TE.encodeUtf8 cleanHex) of
    Right bs -> bs
    Left _ -> BS.empty
