{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}

module Main where

import System.Console.CmdArgs
import System.Exit (exitFailure, exitSuccess)
import System.IO (hPutStrLn, stderr)

import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import Network.URI (parseURI, uriAuthority, uriRegName, uriPort)

import Railgun.Keys (deriveFromMnemonic, railgunAddress)
import Railgun.Shield (createERC20ShieldRequest, serializeShieldRequest)
import Railgun.Unshield (createDummyUnshieldRequest, serializeUnshieldRequest)
import Railgun.API (StratoConfig(..), callShield, callTransact, approveToken)
import Railgun.Types (RailgunAddress(..))

-- | Command line modes
data Command
  = Shield
      { mnemonic :: String
      , passphrase :: String
      , tokenAddress :: String
      , amount :: Integer
      , authTokenFile :: FilePath
      , baseUrl :: String
      , railgunContractAddr :: String
      , derivationIndex :: Int
      , approveFirst :: Bool
      , dryRun :: Bool
      }
  | Unshield
      { mnemonic :: String
      , passphrase :: String
      , tokenAddress :: String
      , amount :: Integer
      , recipient :: String
      , authTokenFile :: FilePath
      , baseUrl :: String
      , railgunContractAddr :: String
      , derivationIndex :: Int
      , dryRun :: Bool
      }
  deriving (Show, Data, Typeable)

shieldMode :: Command
shieldMode = Shield
  { mnemonic = def &= help "BIP39 mnemonic phrase (12-24 words)" &= typ "PHRASE"
  , passphrase = "" &= help "Optional BIP39 passphrase" &= typ "PASSPHRASE"
  , tokenAddress = def &= help "ERC20 token contract address" &= typ "ADDRESS"
  , amount = 1000000000000000000 &= help "Amount to shield (in smallest unit, default 1e18)" &= typ "AMOUNT"
  , authTokenFile = ".token" &= help "Path to OAuth token file (default .token)" &= typFile
  , baseUrl = "http://localhost:8081" &= help "STRATO base URL" &= typ "URL"
  , railgunContractAddr = "959b55477e53900402fdbb2633b56709d252cadd" &= help "Railgun contract address" &= typ "ADDRESS"
  , derivationIndex = 0 &= help "Wallet derivation index (default 0)" &= typ "INDEX"
  , approveFirst = False &= help "Approve tokens before shielding"
  , dryRun = False &= help "Show request without sending"
  } &= help "Shield (deposit) tokens into Railgun"

unshieldMode :: Command
unshieldMode = Unshield
  { mnemonic = def &= help "BIP39 mnemonic phrase (12-24 words)" &= typ "PHRASE"
  , passphrase = "" &= help "Optional BIP39 passphrase" &= typ "PASSPHRASE"
  , tokenAddress = def &= help "ERC20 token contract address" &= typ "ADDRESS"
  , amount = 1000000000000000000 &= help "Amount to unshield (in smallest unit)" &= typ "AMOUNT"
  , recipient = def &= help "Recipient address for unshielded tokens" &= typ "ADDRESS"
  , authTokenFile = ".token" &= help "Path to OAuth token file (default .token)" &= typFile
  , baseUrl = "http://localhost:8081" &= help "STRATO base URL" &= typ "URL"
  , railgunContractAddr = "959b55477e53900402fdbb2633b56709d252cadd" &= help "Railgun contract address" &= typ "ADDRESS"
  , derivationIndex = 0 &= help "Wallet derivation index (default 0)" &= typ "INDEX"
  , dryRun = False &= help "Show request without sending"
  } &= help "Unshield (withdraw) tokens from Railgun (DUMMY - will fail verification)"

main :: IO ()
main = do
  opts <- cmdArgs $ modes [shieldMode, unshieldMode]
    &= summary "airlock - Railgun privacy wallet for STRATO"
    &= program "airlock"
  
  case opts of
    Shield{} -> runShield opts
    Unshield{} -> runUnshield opts

runShield :: Command -> IO ()
runShield opts = do
  -- Validate required arguments
  myWhen (null $ mnemonic opts) $ do
    hPutStrLn stderr "Error: --mnemonic is required"
    exitFailure
  
  myWhen (null $ tokenAddress opts) $ do
    hPutStrLn stderr "Error: --tokenAddress is required"
    exitFailure
  
  -- Derive keys from mnemonic
  TIO.putStrLn "Deriving Railgun keys from mnemonic..."
  case deriveFromMnemonic (T.pack $ mnemonic opts) (T.pack $ passphrase opts) (derivationIndex opts) of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error deriving keys: " <> err
      exitFailure
    Right keys -> do
      let addr = railgunAddress keys
      TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
      
      -- Create shield request (can do before auth for dry run)
      TIO.putStrLn "Creating shield request..."
      shieldReq <- createERC20ShieldRequest keys (T.pack $ tokenAddress opts) (amount opts)
      
      if dryRun opts
        then do
          TIO.putStrLn "\n=== Shield Request (dry run) ==="
          TIO.putStrLn $ serializeShieldRequest shieldReq
          exitSuccess
        else do
          -- Read auth token (only needed for actual API calls)
          authToken <- T.strip <$> TIO.readFile (authTokenFile opts)
          
          -- Parse host/port from URL
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
  -- Validate required arguments
  myWhen (null $ mnemonic opts) $ do
    hPutStrLn stderr "Error: --mnemonic is required"
    exitFailure
  
  myWhen (null $ tokenAddress opts) $ do
    hPutStrLn stderr "Error: --tokenAddress is required"
    exitFailure
  
  myWhen (null $ recipient opts) $ do
    hPutStrLn stderr "Error: --recipient is required"
    exitFailure
  
  -- Derive keys from mnemonic (for display purposes)
  TIO.putStrLn "Deriving Railgun keys from mnemonic..."
  case deriveFromMnemonic (T.pack $ mnemonic opts) (T.pack $ passphrase opts) (derivationIndex opts) of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error deriving keys: " <> err
      exitFailure
    Right keys -> do
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
          authToken <- T.strip <$> TIO.readFile (authTokenFile opts)
          
          -- Parse host/port from URL
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
