{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Main where

import Control.Exception (try, SomeException)
import Control.Monad (when, unless, forM_)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Data.Yaml (decodeFileEither)
import Options.Applicative
import System.Directory (doesFileExist, doesDirectoryExist, createDirectoryIfMissing, getHomeDirectory, listDirectory)
import Data.List (isPrefixOf)
import System.Exit (exitFailure, exitSuccess)
import System.FilePath ((</>))
import System.IO (hPutStrLn, stderr, hFlush, stdout, hGetEcho, stdin, hSetEcho)

import Blockchain.EthConf.Model (EthConf(..), ContractsConf(..))
import Blockchain.Strato.Model.Address (formatAddressWithoutColor)

import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import qualified Data.Text.Encoding as TE
import Text.Printf (printf)

import Bloc.API (BlocTransactionResult(..))
import qualified Bloc.API as Bloc
import Blockchain.Strato.Model.Keccak256 (keccak256ToHex)
import Railgun.Keys (deriveFromMnemonic, railgunAddress, getMasterPublicKeyPoint)
import Railgun.Shield (createERC20ShieldRequest, serializeShieldRequest)
import Railgun.Unshield (createUnshieldRequest)
import Railgun.API (callShield, callTransact, approveToken, getMerkleRoot, getTreeNumber, getBoundParamsHash, getUserAddress, getTokenBalance, getTokenDecimals, formatTokenAmount, parseTokenAmount)
import Strato.Auth (runServant, formatAuthError)
import Handlers.Metadata (getMetaDataClient, MetadataResponse(..))
import Servant.Client (BaseUrl(..), Scheme(..))
import Railgun.Types (RailgunAddress(..), RailgunKeys(..), TokenType(..))
import Railgun.Balance (scanShieldedBalance, TokenBalance(..))
import qualified Railgun.Balance as Bal
import Railgun.Merkle (fetchMerkleTreeData, computeMerkleProof, MerkleTreeData(..))
import Railgun.Crypto (poseidonHash, computeNullifier)
import qualified Railgun.Crypto
import Railgun.Witness (SpendableNote(..), buildUnshieldWitness, buildTransferWitness)
import Railgun.Transfer (parseRecipientAddress, createTransferRequest, TransferNote(..), encryptNoteForRecipient, createCommitmentCiphertext)
import qualified Railgun.Transfer
import qualified Railgun.Unshield
import Railgun.Unshield (CommitmentCiphertext(..))
import Railgun.Prover (generateProof, defaultProverConfig)
import Railgun.Signing (deriveSigningKey, signTransactionData, computeSignatureMessage, RailgunSignature(..))

-- | Path to the mnemonic file for a named wallet
-- Each wallet has its own mnemonic for security (different owners, imports, etc.)
mnemonicFilePath :: String -> IO FilePath
mnemonicFilePath walletName = do
  home <- getHomeDirectory
  let filename = if walletName == "default" || null walletName
                 then "railgunMnemonic"
                 else "railgunMnemonic." ++ walletName
  return $ home </> ".secrets" </> filename

-- | Get the node directory from ~/.strato/default-node
getDefaultNodeDir :: IO (Maybe FilePath)
getDefaultNodeDir = do
  home <- getHomeDirectory
  let defaultNodeFile = home </> ".strato" </> "default-node"
  exists <- doesFileExist defaultNodeFile
  if exists
    then do
      contents <- TIO.readFile defaultNodeFile
      let nodeDir = T.unpack $ T.strip contents
      dirExists <- doesDirectoryExist nodeDir
      if dirExists
        then return $ Just nodeDir
        else do
          hPutStrLn stderr $ "Error: Node directory not found: " ++ nodeDir
          exitFailure
    else return Nothing

-- | Read Railgun contract address from node's ethconf.yaml
readContractAddress :: IO (Maybe String)
readContractAddress = do
  maybeNodeDir <- getDefaultNodeDir
  case maybeNodeDir of
    Nothing -> return Nothing
    Just nodeDir -> do
      let ethconfPath = nodeDir </> ".ethereumH" </> "ethconf.yaml"
      exists <- doesFileExist ethconfPath
      if not exists
        then do
          hPutStrLn stderr $ "Error: Node config not found. Is the node initialized?"
          exitFailure
        else do
          result <- decodeFileEither ethconfPath
          case result of
            Left err -> do
              hPutStrLn stderr $ "Error: Invalid node config: " ++ show err
              exitFailure
            Right ethConf -> 
              return $ formatAddressWithoutColor <$> (contractsConfig ethConf >>= railgunProxy)

-- | Require the Railgun contract address, failing with helpful message if not set
requireContractAddress :: String -> IO String
requireContractAddress cliAddr
  | not (null cliAddr) = return cliAddr
  | otherwise = do
      maybeAddr <- readContractAddress
      case maybeAddr of
        Just addr | not (null addr) -> return addr
        _ -> do
          hPutStrLn stderr "Error: Railgun contract address not found. Has it been deployed?"
          exitFailure

-- | Read mnemonic from file for a named wallet, or fail with instructions
readMnemonicFromFile :: String -> IO T.Text
readMnemonicFromFile walletName = do
  path <- mnemonicFilePath walletName
  exists <- doesFileExist path
  if exists
    then T.strip <$> TIO.readFile path
    else do
      hPutStrLn stderr $ "Error: Wallet" ++ (if walletName == "default" then "" else " '" ++ walletName ++ "'") ++ " not found."
      hPutStrLn stderr ""
      if walletName == "default"
        then hPutStrLn stderr "Create it with: airlock setup_wallet"
        else hPutStrLn stderr $ "Create it with: airlock setup_wallet --wallet " ++ walletName
      exitFailure

--------------------------------------------------------------------------------
-- Command line parsing with optparse-applicative
--------------------------------------------------------------------------------

data Command
  = SetupWallet SetupWalletOpts
  | ListWallets
  | ListAddresses ListAddressesOpts
  | Shield ShieldOpts
  | Unshield UnshieldOpts
  | Transfer TransferOpts
  | Balance BalanceOpts
  deriving (Show)

data SetupWalletOpts = SetupWalletOpts
  { swoWalletName :: String
  , swoForceOverwrite :: Bool
  } deriving (Show)

data ListAddressesOpts = ListAddressesOpts
  { laoWallet :: String
  , laoNumAddresses :: Int
  } deriving (Show)

data ShieldOpts = ShieldOpts
  { soWallet :: String
  , soTokenAddress :: String
  , soAmount :: String  -- Amount in tokens (e.g., "1.5"), default "1"
  , soBaseUrl :: String
  , soRailgunContractAddr :: String
  , soDerivationIndex :: Int
  , soApproveFirst :: Bool
  , soDryRun :: Bool
  } deriving (Show)

data UnshieldOpts = UnshieldOpts
  { uoWallet :: String
  , uoTokenAddress :: String
  , uoAmount :: String  -- Amount in tokens (e.g., "1.5") or empty for entire note
  , uoRecipient :: String
  , uoBaseUrl :: String
  , uoRailgunContractAddr :: String
  , uoDerivationIndex :: Int
  , uoDryRun :: Bool
  } deriving (Show)

data TransferOpts = TransferOpts
  { toWallet :: String
  , toTokenAddress :: String
  , toAmount :: String  -- Amount in tokens (e.g., "1.5") or empty for entire note
  , toRecipient :: String  -- Railgun address (0zk...)
  , toBaseUrl :: String
  , toRailgunContractAddr :: String
  , toDerivationIndex :: Int
  , toDryRun :: Bool
  } deriving (Show)

data BalanceOpts = BalanceOpts
  { boWallet :: String
  , boBaseUrl :: String
  , boRailgunContractAddr :: String
  , boDerivationIndex :: Int
  , boShowNotes :: Bool
  , boTokenAddress :: Maybe String  -- ^ Optional: check specific token's unshielded balance
  } deriving (Show)

-- | Parser for setup_wallet command
setupWalletParser :: Parser Command
setupWalletParser = SetupWallet <$> (SetupWalletOpts
  <$> strOption
      ( long "wallet"
     <> value "default"
     <> metavar "NAME"
     <> completer walletCompleter
     <> help "Wallet name (default: 'default')" )
  <*> switch
      ( long "force"
     <> help "Overwrite existing wallet" ))

-- | Parser for list_addresses command
listAddressesParser :: Parser Command
listAddressesParser = ListAddresses <$> (ListAddressesOpts
  <$> strOption
      ( long "wallet"
     <> value "default"
     <> metavar "NAME"
     <> completer walletCompleter
     <> help "Wallet name (default: 'default')" )
  <*> option auto
      ( long "num"
     <> value 10
     <> metavar "NUM"
     <> help "Number of addresses to display (default 10)" ))

-- | Parser for shield command
shieldParser :: Parser Command
shieldParser = Shield <$> (ShieldOpts
  <$> strOption
      ( long "wallet"
     <> value "default"
     <> metavar "NAME"
     <> completer walletCompleter
     <> help "Wallet name (default: 'default')" )
  <*> strOption
      ( long "tokenaddress"
     <> value ""
     <> metavar "ADDRESS"
     <> help "ERC20 token contract address" )
  <*> strOption
      ( long "amount"
     <> value "1"
     <> metavar "AMOUNT"
     <> help "Amount to shield in tokens (e.g., '1.5'), default 1" )
  <*> strOption
      ( long "baseurl"
     <> value "http://localhost:8081"
     <> metavar "URL"
     <> help "STRATO base URL" )
  <*> strOption
      ( long "railguncontractaddr"
     <> value ""
     <> metavar "ADDRESS"
     <> help "Railgun contract address (reads from node config if not specified)" )
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
      ( long "wallet"
     <> value "default"
     <> metavar "NAME"
     <> completer walletCompleter
     <> help "Wallet name (default: 'default')" )
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
     <> value ""
     <> metavar "ADDRESS"
     <> help "Railgun contract address (reads from node config if not specified)" )
  <*> option auto
      ( long "derivationindex"
     <> value 0
     <> metavar "INDEX"
     <> help "Wallet derivation index (default 0)" )
  <*> switch
      ( long "dryrun"
     <> help "Show request without sending" ))

-- | Parser for transfer command (shielded transfer)
transferParser :: Parser Command
transferParser = Transfer <$> (TransferOpts
  <$> strOption
      ( long "wallet"
     <> value "default"
     <> metavar "NAME"
     <> completer walletCompleter
     <> help "Wallet name (default: 'default')" )
  <*> strOption
      ( long "tokenaddress"
     <> value ""
     <> metavar "ADDRESS"
     <> help "ERC20 token contract address" )
  <*> strOption
      ( long "amount"
     <> value ""
     <> metavar "AMOUNT"
     <> help "Amount to transfer in tokens (e.g., '1.5'), empty = entire note" )
  <*> strOption
      ( long "recipient"
     <> value ""
     <> metavar "ADDRESS"
     <> help "Recipient's Railgun address (0zk...)" )
  <*> strOption
      ( long "baseurl"
     <> value "http://localhost:8081"
     <> metavar "URL"
     <> help "STRATO base URL" )
  <*> strOption
      ( long "railguncontractaddr"
     <> value ""
     <> metavar "ADDRESS"
     <> help "Railgun contract address (reads from node config if not specified)" )
  <*> option auto
      ( long "derivationindex"
     <> value 0
     <> metavar "INDEX"
     <> help "Wallet derivation index (default 0)" )
  <*> switch
      ( long "dryrun"
     <> help "Show request without sending" ))

-- | Completer for wallet names - lists available wallets from ~/.secrets/
walletCompleter :: Completer
walletCompleter = listIOCompleter $ do
  home <- getHomeDirectory
  let secretsDir = home </> ".secrets"
  exists <- doesDirectoryExist secretsDir
  if not exists
    then return ["default"]
    else do
      files <- listDirectory secretsDir
      let prefix = "railgunMnemonic."
          namedWallets = [drop (length prefix) f | f <- files, prefix `isPrefixOf` f]
      defaultExists <- doesFileExist (secretsDir </> "railgunMnemonic")
      return $ (if defaultExists then ["default"] else []) ++ namedWallets

-- | Parser for balance command
balanceParser :: Parser Command
balanceParser = Balance <$> (BalanceOpts
  <$> strOption
      ( long "wallet"
     <> value "default"
     <> metavar "NAME"
     <> completer walletCompleter
     <> help "Wallet name (default: 'default')" )
  <*> strOption
      ( long "baseurl"
     <> value "http://localhost:8081"
     <> metavar "URL"
     <> help "STRATO base URL" )
  <*> strOption
      ( long "railguncontractaddr"
     <> value ""
     <> metavar "ADDRESS"
     <> help "Railgun contract address (reads from node config if not specified)" )
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
  ( command "setup_wallet"
    (info setupWalletParser
      (progDesc "Set up a wallet with your recovery phrase"))
  <> command "list_wallets"
    (info (pure ListWallets)
      (progDesc "List all configured wallets"))
  <> command "list_addresses"
    (info listAddressesParser
      (progDesc "List derived addresses from the wallet"))
  <> command "shield"
    (info shieldParser
      (progDesc "Shield (deposit) tokens into Railgun"))
  <> command "unshield"
    (info unshieldParser
      (progDesc "Unshield (withdraw) tokens from Railgun"))
  <> command "transfer"
    (info transferParser
      (progDesc "Transfer tokens to another Railgun address (shielded)"))
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
    SetupWallet o -> runSetupWallet o
    ListWallets -> runListWallets
    ListAddresses o -> runListAddresses o
    Shield o -> runShield o
    Unshield o -> runUnshield o
    Transfer o -> runTransfer o
    Balance o -> runBalance o
  where
    prefs' = prefs showHelpOnEmpty

runSetupWallet :: SetupWalletOpts -> IO ()
runSetupWallet swopts = do
  let walletName = swoWalletName swopts
  mnemonicPath <- mnemonicFilePath walletName
  mnemonicExists <- doesFileExist mnemonicPath
  
  when (mnemonicExists && not (swoForceOverwrite swopts)) $ do
    hPutStrLn stderr $ "Error: Wallet" ++ (if walletName == "default" then "" else " '" ++ walletName ++ "'") ++ " already exists."
    hPutStrLn stderr "Use --force to replace it (this will change your wallet!)."
    exitFailure
  
  TIO.putStrLn $ "=== Setup Wallet" <> (if walletName == "default" then "" else ": " <> T.pack walletName) <> " ==="
  TIO.putStrLn ""
  TIO.putStrLn "Enter your BIP39 mnemonic phrase (12-24 words)."
  TIO.putStrLn "This is your recovery phrase - keep it safe!"
  TIO.putStrLn ""
  TIO.putStr "Mnemonic: "
  hFlush stdout
  
  mnemonic <- getHiddenLine
  TIO.putStrLn ""
  
  let mnemonicText = T.strip $ T.pack mnemonic
      wordCount = length $ T.words mnemonicText
  
  when (wordCount `notElem` [12, 15, 18, 21, 24]) $ do
    hPutStrLn stderr $ "Error: Invalid mnemonic - expected 12, 15, 18, 21, or 24 words, got " ++ show wordCount
    exitFailure
  
  -- Verify keys can be derived
  case deriveFromMnemonic mnemonicText "" 0 of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error: Invalid mnemonic - " <> err
      exitFailure
    Right keys -> do
      -- Save mnemonic
      home <- getHomeDirectory
      createDirectoryIfMissing True (home </> ".secrets")
      TIO.writeFile mnemonicPath mnemonicText
      
      let addr = railgunAddress keys
      TIO.putStrLn $ "Wallet" <> (if walletName == "default" then "" else " '" <> T.pack walletName <> "'") <> " created successfully!"
      TIO.putStrLn ""
      TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
      TIO.putStrLn ""
      if walletName == "default"
        then TIO.putStrLn "You can now use 'airlock balance', 'airlock shield', etc."
        else TIO.putStrLn $ "Use --wallet " <> T.pack walletName <> " with other commands."
      exitSuccess

runListWallets :: IO ()
runListWallets = do
  home <- getHomeDirectory
  let secretsDir = home </> ".secrets"
  exists <- doesDirectoryExist secretsDir
  if not exists
    then do
      TIO.putStrLn "No wallets configured."
      TIO.putStrLn "Create one with: airlock setup_wallet --wallet <name>"
      exitSuccess
    else do
      files <- listDirectory secretsDir
      let prefix = "railgunMnemonic." :: String
          mnemonicFiles = filter (prefix `isPrefixOf`) files
          walletNames = map (drop (length prefix)) mnemonicFiles
      
      if null walletNames
        then do
          -- Check for default wallet (no suffix)
          defaultExists <- doesFileExist (secretsDir </> "railgunMnemonic")
          if defaultExists
            then do
              TIO.putStrLn "Configured wallets:"
              TIO.putStrLn "  default"
            else do
              TIO.putStrLn "No wallets configured."
              TIO.putStrLn "Create one with: airlock setup_wallet --wallet <name>"
        else do
          TIO.putStrLn "Configured wallets:"
          -- Check for default wallet too
          defaultExists <- doesFileExist (secretsDir </> "railgunMnemonic")
          when defaultExists $ TIO.putStrLn "  default"
          mapM_ (\n -> TIO.putStrLn $ "  " <> T.pack n) walletNames
      exitSuccess

runListAddresses :: ListAddressesOpts -> IO ()
runListAddresses laopts = do
  let walletName = laoWallet laopts
  mnemonic <- readMnemonicFromFile walletName
  
  TIO.putStrLn "============================================================"
  TIO.putStrLn $ "         DERIVED ADDRESSES (wallet: " <> T.pack walletName <> ")"
  TIO.putStrLn "============================================================"
  TIO.putStrLn ""
  
  let indices = [0 .. laoNumAddresses laopts - 1]
  mapM_ (printAddressAtIndex mnemonic) indices
  
  TIO.putStrLn "============================================================"
  exitSuccess

printAddressAtIndex :: T.Text -> Int -> IO ()
printAddressAtIndex mnemonic idx = do
  case deriveFromMnemonic mnemonic "" idx of
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

-- | Load keys from mnemonic file using a named wallet
loadKeys :: String -> Int -> IO RailgunKeys
loadKeys walletName idx = do
  mnemonic <- readMnemonicFromFile walletName
  case deriveFromMnemonic mnemonic "" idx of
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
  TIO.putStrLn $ "Loading Railgun keys (wallet: " <> T.pack (soWallet sopts) <> ")..."
  keys <- loadKeys (soWallet sopts) (soDerivationIndex sopts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  
  -- Resolve contract address (validates it exists in ethconf.yaml)
  _ <- requireContractAddress (soRailgunContractAddr sopts)
  
  let tokenAddr = T.pack $ soTokenAddress sopts
  
  -- Get token decimals and parse amount
  decimals <- getTokenDecimals tokenAddr
  amountWei <- case parseTokenAmount (T.pack $ soAmount sopts) decimals of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error: " <> err
      exitFailure
    Right amt -> return amt
  
  -- Create shield request
  TIO.putStrLn "Creating shield request..."
  TIO.putStrLn $ "  Amount: " <> formatTokenAmount amountWei decimals <> " tokens"
  shieldReq <- createERC20ShieldRequest keys tokenAddr amountWei
  
  if soDryRun sopts
    then do
      TIO.putStrLn "\n=== Shield Request (dry run) ==="
      TIO.putStrLn $ serializeShieldRequest shieldReq
      exitSuccess
    else do
      -- Optionally approve tokens first
      when (soApproveFirst sopts) $ do
        TIO.putStrLn $ "Approving " <> formatTokenAmount amountWei decimals <> " tokens..."
        approveResult <- approveToken tokenAddr amountWei
        case approveResult of
          Left err -> do
            TIO.hPutStrLn stderr $ "Approval failed: " <> err
            exitFailure
          Right results -> TIO.putStrLn $ "Approval successful: " <> T.pack (show $ length results) <> " transaction(s)"
      
      -- Send shield transaction
      TIO.putStrLn "Sending shield transaction..."
      shieldResult <- callShield [shieldReq]
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
  TIO.putStrLn $ "Loading Railgun keys (wallet: " <> T.pack (uoWallet uopts) <> ")..."
  keys <- loadKeys (uoWallet uopts) (uoDerivationIndex uopts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  
  -- Resolve contract address (validates it exists in ethconf.yaml)
  _ <- requireContractAddress (uoRailgunContractAddr uopts)
  
  let tokenAddr = T.toLower $ normalizeAddress $ T.pack $ uoTokenAddress uopts
  
  -- Step 1: Scan for our notes
  TIO.putStrLn "\nScanning for shielded notes..."
  notesResult <- scanShieldedBalance keys
  (notes, _) <- case notesResult of
    Left err -> do
      TIO.hPutStrLn stderr $ "Failed to scan notes: " <> err
      exitFailure
    Right r -> return r
  
  TIO.putStrLn $ "Found " <> T.pack (show $ length notes) <> " note(s)"
  
  -- Get token decimals for formatting and parsing
  decimals <- getTokenDecimals tokenAddr
  
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
      let metadataUrl = BaseUrl Http "localhost" 8081 "/strato-api/eth/v1.2"
      metadataResult <- runServant metadataUrl getMetaDataClient
      chainId <- case metadataResult of
        Left authErr -> do
          TIO.hPutStrLn stderr $ "Auth failed: " <> formatAuthError authErr
          exitFailure
        Right (Left clientErr) -> do
          TIO.hPutStrLn stderr $ "Failed to get metadata: " <> T.pack (show clientErr)
          exitFailure
        Right (Right metadata) -> do
          let cid = read (networkID metadata) :: Integer
          TIO.putStrLn $ "Chain ID: " <> T.pack (show cid)
          return cid
      
      TIO.putStrLn "Fetching merkle root..."
      merkleRootResult <- getMerkleRoot
      merkleRootHex <- case merkleRootResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to get merkle root: " <> err
          exitFailure
        Right root -> do
          TIO.putStrLn $ "Merkle root: " <> root
          return root
      
      TIO.putStrLn "Fetching tree number..."
      treeNumResult <- getTreeNumber
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
      -- Using dummy ciphertext for unshield (change note - recipient gets unshielded tokens)
      let dummyCiphertext = CommitmentCiphertext
            { ccCiphertext = [BS.replicate 32 0, BS.replicate 32 0, BS.replicate 32 0, BS.replicate 32 0]
            , ccBlindedSenderViewingKey = BS.replicate 32 0
            , ccBlindedReceiverViewingKey = BS.replicate 32 0
            , ccAnnotationData = BS.empty
            , ccMemo = BS.empty
            }
      boundParamsHashResult <- getBoundParamsHash (fromIntegral treeNum) chainId [dummyCiphertext] True -- True = unshield
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
      unshieldResult <- callTransact unshieldReq
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

runTransfer :: TransferOpts -> IO ()
runTransfer topts = do
  when (null $ toTokenAddress topts) $ do
    hPutStrLn stderr "Error: --tokenaddress is required"
    exitFailure
  
  when (null $ toRecipient topts) $ do
    hPutStrLn stderr "Error: --recipient is required (Railgun address starting with 0zk)"
    exitFailure
  
  -- Validate recipient address format
  let recipientAddr = T.pack $ toRecipient topts
  unless ("0zk" `T.isPrefixOf` recipientAddr) $ do
    hPutStrLn stderr "Error: --recipient must be a Railgun address (starting with 0zk)"
    hPutStrLn stderr "For transfers to Ethereum addresses, use 'airlock unshield' instead."
    exitFailure
  
  -- Parse recipient's public keys
  (recipientMasterPk, recipientViewingPk) <- case parseRecipientAddress recipientAddr of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error parsing recipient address: " <> err
      exitFailure
    Right pks -> return pks
  
  -- Load keys from mnemonic file
  TIO.putStrLn $ "Loading Railgun keys (wallet: " <> T.pack (toWallet topts) <> ")..."
  keys <- loadKeys (toWallet topts) (toDerivationIndex topts)
  
  let addr = railgunAddress keys
  TIO.putStrLn $ "Railgun address: " <> unRailgunAddress addr
  
  -- Resolve contract address (validates it exists in ethconf.yaml)
  _ <- requireContractAddress (toRailgunContractAddr topts)
  
  let tokenAddr = T.toLower $ normalizeAddress $ T.pack $ toTokenAddress topts
  
  -- Step 1: Scan for our notes
  TIO.putStrLn "\nScanning for shielded notes..."
  notesResult <- scanShieldedBalance keys
  (notes, _) <- case notesResult of
    Left err -> do
      TIO.hPutStrLn stderr $ "Failed to scan notes: " <> err
      exitFailure
    Right r -> return r
  
  TIO.putStrLn $ "Found " <> T.pack (show $ length notes) <> " note(s)"
  
  -- Get token decimals
  decimals <- getTokenDecimals tokenAddr
  
  -- Parse requested amount
  requestedAmount <- case parseTokenAmount (T.pack $ toAmount topts) decimals of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error: " <> err
      exitFailure
    Right amt -> return amt
  
  -- Step 2: Find a note for the requested token
  let tokenNotes = filter (\n -> T.toLower (Bal.snTokenAddress n) == tokenAddr) notes
  
  (noteToSpend, actualAmount) <- case tokenNotes of
    [] -> do
      TIO.hPutStrLn stderr $ "No notes found for token " <> tokenAddr
      TIO.hPutStrLn stderr "Available notes:"
      mapM_ (\n -> TIO.hPutStrLn stderr $ "  " <> Bal.snTokenAddress n <> ": " <> formatTokenAmount (Bal.snValue n) decimals) notes
      exitFailure
    (n:_) | requestedAmount == 0 -> do
      return (n, Bal.snValue n)
    ns -> do
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
  TIO.putStrLn $ "  Transferring: " <> formatTokenAmount actualAmount decimals
  TIO.putStrLn $ "  To: " <> recipientAddr
  
  if toDryRun topts
    then do
      TIO.putStrLn "\n=== Dry run - would transfer ==="
      TIO.putStrLn $ "  Token: " <> tokenAddr
      TIO.putStrLn $ "  Amount: " <> formatTokenAmount actualAmount decimals
      TIO.putStrLn $ "  Recipient: " <> recipientAddr
      exitSuccess
    else do
      -- Step 3: Get chain ID and merkle root
      TIO.putStrLn "\nFetching chain ID..."
      let metadataUrl = BaseUrl Http "localhost" 8081 "/strato-api/eth/v1.2"
      metadataResult <- runServant metadataUrl getMetaDataClient
      chainId <- case metadataResult of
        Left authErr -> do
          TIO.hPutStrLn stderr $ "Auth failed: " <> formatAuthError authErr
          exitFailure
        Right (Left clientErr) -> do
          TIO.hPutStrLn stderr $ "Failed to get metadata: " <> T.pack (show clientErr)
          exitFailure
        Right (Right metadata) -> do
          let cid = read (networkID metadata) :: Integer
          TIO.putStrLn $ "Chain ID: " <> T.pack (show cid)
          return cid
      
      TIO.putStrLn "Fetching merkle root..."
      merkleRootResult <- getMerkleRoot
      merkleRootHex <- case merkleRootResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to get merkle root: " <> err
          exitFailure
        Right root -> do
          TIO.putStrLn $ "Merkle root: " <> root
          return root
      
      TIO.putStrLn "Fetching tree number..."
      treeNumResult <- getTreeNumber
      treeNum <- case treeNumResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to get tree number: " <> err
          exitFailure
        Right tn -> do
          TIO.putStrLn $ "Tree number: " <> T.pack (show tn)
          return tn
      
      -- Step 4: Get Merkle proof
      TIO.putStrLn "Fetching Merkle tree data..."
      merkleDataResult <- fetchMerkleTreeData
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
      let (pkX, pkY) = getMasterPublicKeyPoint keys
      
      -- Derive signing key
      signingKey <- case deriveSigningKey (spendingKey keys) of
        Nothing -> do
          TIO.hPutStrLn stderr "Failed to derive signing key"
          exitFailure
        Just sk -> return sk
      
      -- Compute recipient's NPK for the transfer output note
      -- NPK = poseidon(masterPublicKey, random)
      -- The masterPublicKey from the address is already the poseidon-hashed value
      let recipientMasterPublicKey = bytesToIntegerBE recipientMasterPk
      
      -- Generate random for recipient's note
      recipientRandom <- Railgun.Crypto.randomBytes 16
      let recipientRandomInt = bytesToIntegerBE recipientRandom
          -- Compute recipient's NPK using same formula as Shield
          recipientNpk = poseidonHash [recipientMasterPublicKey, recipientRandomInt]
      
      -- Compute values needed for signature
      let nullifierKeyInt = bytesToIntegerBE (nullifierKey keys)
          nullifier = computeNullifier nullifierKeyInt leafIndex
          tokenId = hexToInteger (Bal.snTokenAddress noteToSpend)
          changeValue = Bal.snValue noteToSpend - actualAmount
      
      -- Step 6b: Create commitment ciphertexts FIRST (needed for boundParamsHash)
      TIO.putStrLn "  Creating encrypted note data..."
      
      -- Use input note's random for change note (must match NPK derivation)
      let changeRandom = Bal.snRandom noteToSpend
      
      -- Create ciphertext for change note (going back to ourselves)
      changeCiphertext <- createCommitmentCiphertext
                            (viewingPrivateKey keys)
                            (viewingPublicKey keys)
                            npkInt
                            (T.pack $ toTokenAddress topts)
                            changeValue
                            changeRandom
      
      -- Create the transfer note for encryption
      let transferNote = TransferNote
            { tnRecipientNpk = recipientNpk
            , tnRecipientViewingKey = recipientViewingPk
            , tnTokenAddress = T.pack $ toTokenAddress topts
            , tnValue = actualAmount
            , tnRandom = recipientRandom
            }
      
      -- Encrypt the transfer note for the recipient
      transferCiphertextResult <- encryptNoteForRecipient
                                    (viewingPrivateKey keys)
                                    (viewingPublicKey keys)
                                    transferNote
      transferCiphertext <- case transferCiphertextResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to encrypt note: " <> err
          exitFailure
        Right ct -> return ct
      
      -- Get bound params hash using the ACTUAL ciphertexts
      boundParamsHashResult <- getBoundParamsHash (fromIntegral treeNum) chainId 
                                 [changeCiphertext, transferCiphertext] False
      boundParamsHash <- case boundParamsHashResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to get boundParamsHash: " <> err
          exitFailure
        Right h -> do
          TIO.putStrLn $ "  BoundParamsHash: " <> T.pack (show h)
          return h
      
      let -- Compute output commitments
          changeCommitment = poseidonHash [npkInt, tokenId, changeValue]
          transferCommitment = poseidonHash [recipientNpk, tokenId, actualAmount]
          
          -- Compute the message to sign
          sigMessage = computeSignatureMessage 
                         merkleRootInt 
                         boundParamsHash 
                         [nullifier] 
                         [changeCommitment, transferCommitment]
      
      TIO.putStrLn $ "  Nullifier: " <> T.pack (show nullifier)
      TIO.putStrLn $ "  Change commitment: " <> T.pack (show changeCommitment)
      TIO.putStrLn $ "  Transfer commitment: " <> T.pack (show transferCommitment)
      TIO.putStrLn $ "  Change value: " <> T.pack (show changeValue)
      TIO.putStrLn $ "  Transfer amount: " <> T.pack (show actualAmount)
      TIO.putStrLn $ "  TokenId: " <> T.pack (show tokenId)
      TIO.putStrLn $ "  NPK (ours): " <> T.pack (show npkInt)
      TIO.putStrLn $ "  NPK (recipient): " <> T.pack (show recipientNpk)
      
      -- Sign the message
      let signature = signTransactionData signingKey sigMessage
          sigR8x = rsR8x signature
          sigR8y = rsR8y signature
          sigS = rsS signature
      
      -- Step 7: Build witness for transfer
      witnessResult <- case buildTransferWitness 
                              spendable 
                              merkleProof 
                              nullifierKeyInt
                              (pkX, pkY)
                              (sigR8x, sigR8y, sigS)
                              recipientNpk
                              actualAmount
                              boundParamsHash
                              merkleRootInt of
        Left err -> do
          TIO.hPutStrLn stderr $ "Failed to build witness: " <> err
          exitFailure
        Right w -> return w
      
      TIO.putStrLn "  Circuit inputs built"
      
      -- Debug: Save circuit inputs for inspection
      -- let inputsJson = Aeson.encode witnessResult
      -- LBS.writeFile "/tmp/circuit_inputs.json" inputsJson
      -- TIO.putStrLn "  Circuit inputs saved to /tmp/circuit_inputs.json"
      
      -- Step 8: Generate SNARK proof
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
      
      -- Step 9: Build and send the transaction (ciphertexts already created above)
      let merkleRootBytes = hexToBytes merkleRootHex
          transferReq = createTransferRequest
                          snarkProof
                          merkleRootBytes
                          nullifier
                          [changeCommitment, transferCommitment]
                          [changeCiphertext, transferCiphertext]
                          (T.pack $ toTokenAddress topts)
                          chainId
                          (fromIntegral treeNum)
      
      TIO.putStrLn "\nSending shielded transfer transaction..."
      
      -- Use callTransact (same as unshield) since the contract interface is the same
      transferResult <- callTransact (trToUnshield transferReq)
      case transferResult of
        Left err -> do
          TIO.hPutStrLn stderr $ "Transfer failed: " <> err
          exitFailure
        Right results -> do
          TIO.putStrLn $ "Transfer response: " <> T.pack (show $ length results) <> " transaction result(s)"
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
    
    bytesToIntegerBE :: BS.ByteString -> Integer
    bytesToIntegerBE = BS.foldl' (\acc b -> acc * 256 + fromIntegral b) 0
    
    -- Convert TransferRequest to UnshieldRequest for the API call
    -- They use the same structure
    trToUnshield :: Railgun.Transfer.TransferRequest -> Railgun.Unshield.UnshieldRequest
    trToUnshield tr = Railgun.Unshield.UnshieldRequest 
                        { Railgun.Unshield.urTransactions = Railgun.Transfer.trTransactions tr }

runBalance :: BalanceOpts -> IO ()
runBalance bopts = do
  -- Load keys
  keys <- loadKeys (boWallet bopts) (boDerivationIndex bopts)
  -- Validate contract address exists in ethconf.yaml
  _ <- requireContractAddress (boRailgunContractAddr bopts)
  
  -- Get addresses
  let railgunAddr = railgunAddress keys
  userAddrResult <- getUserAddress
  let maybeUserAddr = case userAddrResult of
        Right addr' -> Just addr'
        Left _ -> Nothing
  
  -- Scan for shielded notes
  result <- scanShieldedBalance keys
  
  case result of
    Left err -> do
      TIO.hPutStrLn stderr $ "Error: " <> err
      exitFailure
    Right (notes, balances) -> do
      -- Header with addresses
      TIO.putStrLn $ "Wallet: " <> T.pack (boWallet bopts)
      TIO.putStrLn $ "  Railgun:  " <> unRailgunAddress railgunAddr
      case maybeUserAddr of
        Just userAddr -> TIO.putStrLn $ "  Ethereum: 0x" <> userAddr
        Nothing -> return ()
      TIO.putStrLn ""
      
      -- If a specific token address is requested, show its balance
      case boTokenAddress bopts of
        Just tokenAddr -> do
          let tokenAddrT = T.pack tokenAddr
              maybeShielded = filter (\tb -> T.toLower (tbTokenAddress tb) == T.toLower (normalizeAddr tokenAddrT)) balances
              shieldedValue = sum $ map tbTotalValue maybeShielded
              shieldedNotes = sum $ map tbNoteCount maybeShielded
              shieldedInTokens = fromIntegral shieldedValue / (1e18 :: Double)
          
          TIO.putStrLn $ "Token 0x" <> normalizeAddr tokenAddrT <> ":"
          TIO.putStrLn $ "  Shielded:   " <> T.pack (printf "%.6f" shieldedInTokens) <> " (" <> T.pack (show shieldedNotes) <> " notes)"
          
          case maybeUserAddr of
            Just userAddr -> do
              unshieldedResult <- getTokenBalance tokenAddrT userAddr
              case unshieldedResult of
                Right unshieldedWei -> do
                  let unshieldedInTokens = fromIntegral unshieldedWei / (1e18 :: Double)
                      totalInTokens = shieldedInTokens + unshieldedInTokens
                  TIO.putStrLn $ "  Unshielded: " <> T.pack (printf "%.6f" unshieldedInTokens)
                  TIO.putStrLn $ "  Total:      " <> T.pack (printf "%.6f" totalInTokens)
                Left _ -> 
                  TIO.putStrLn "  Unshielded: (error)"
            Nothing -> 
              TIO.putStrLn "  Unshielded: (no eth address)"
        
        Nothing -> do
          -- No specific token requested - show all balances
          let defaultTokens = ["937efa7e3a77e20bbdbd7c0d32b6514f368c1010"]  -- USDST
              shieldedTokenAddrs = map (T.toLower . tbTokenAddress) balances
              extraTokens = filter (\t -> T.toLower t `notElem` shieldedTokenAddrs) defaultTokens
          
          -- Show shielded balances with unshielded
          mapM_ (printTokenBalance maybeUserAddr) balances
          
          -- Show default tokens that only have unshielded balance
          forM_ extraTokens $ \tokenAddr ->
            printTokenBalance maybeUserAddr TokenBalance
              { tbTokenAddress = tokenAddr
              , tbTotalValue = 0
              , tbNoteCount = 0
              , tbTokenType = ERC20
              }
          
          when (null balances && null extraTokens) $
            TIO.putStrLn "No balances found."
      
      -- Optionally show individual notes
      when (boShowNotes bopts && not (null notes)) $ do
        TIO.putStrLn ""
        TIO.putStrLn "Notes:"
        mapM_ printNote notes
  where
    normalizeAddr t = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 (T.toLower t) else T.toLower t

-- | Known token names
tokenName :: T.Text -> T.Text
tokenName addr = case T.toLower addr of
  "937efa7e3a77e20bbdbd7c0d32b6514f368c1010" -> "USDST"
  _ -> "ERC20"

-- | Print balance for a token (shielded + unshielded)
printTokenBalance :: Maybe T.Text -> TokenBalance -> IO ()
printTokenBalance maybeUserAddr tb = do
  let shieldedWei = tbTotalValue tb
      shieldedInTokens = fromIntegral shieldedWei / (1e18 :: Double)
  
  -- Get unshielded balance
  unshieldedWei <- case maybeUserAddr of
    Just userAddr -> do
      result <- getTokenBalance (tbTokenAddress tb) userAddr
      return $ either (const 0) id result
    Nothing -> return 0
  
  -- Only print if there's some balance
  when (shieldedWei > 0 || unshieldedWei > 0) $ do
    let unshieldedInTokens = fromIntegral unshieldedWei / (1e18 :: Double)
        totalInTokens = shieldedInTokens + unshieldedInTokens
    
    TIO.putStrLn $ "Token 0x" <> tbTokenAddress tb <> " (" <> tokenName (tbTokenAddress tb) <> "):"
    TIO.putStrLn $ "  Shielded:   " <> T.pack (printf "%.6f" shieldedInTokens) <> " (" <> T.pack (show $ tbNoteCount tb) <> " notes)"
    TIO.putStrLn $ "  Unshielded: " <> T.pack (printf "%.6f" unshieldedInTokens)
    when (shieldedWei > 0 && unshieldedWei > 0) $
      TIO.putStrLn $ "  Total:      " <> T.pack (printf "%.6f" totalInTokens)
    TIO.putStrLn ""

printNote :: Bal.ShieldedNote -> IO ()
printNote note = do
  let valueInTokens = fromIntegral (Bal.snValue note) / (1e18 :: Double)
  TIO.putStrLn $ "  [" <> T.pack (show $ Bal.snTreePosition note) <> "] " 
    <> T.pack (printf "%.6f" valueInTokens) <> " @ 0x" <> Bal.snTokenAddress note

-- | Print transaction result with status
printTxResult :: BlocTransactionResult -> IO ()
printTxResult result = do
  let status = blocTransactionStatus result
      txHash = T.pack $ keccak256ToHex $ blocTransactionHash result
  case status of
    Bloc.Success -> TIO.putStrLn $ "  Transaction " <> txHash <> ": SUCCESS"
    Bloc.Failure -> TIO.putStrLn $ "  Transaction " <> txHash <> ": FAILED"
    Bloc.Pending -> TIO.putStrLn $ "  Transaction " <> txHash <> ": PENDING"

-- | Convert hex string to ByteString
hexToBytes :: T.Text -> BS.ByteString
hexToBytes hex = 
  let cleanHex = if "0x" `T.isPrefixOf` T.toLower hex then T.drop 2 hex else hex
  in case B16.decode (TE.encodeUtf8 cleanHex) of
    Right bs -> bs
    Left _ -> BS.empty
