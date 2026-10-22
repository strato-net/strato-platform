-- | The node key of a @--localKey@ validator: a secp256k1 private key kept
-- in the node directory as @secrets/node_key.pem@ (an unencrypted
-- @EC PRIVATE KEY@ PEM, mode 0600, the file @openssl ecparam -name secp256k1
-- -genkey@ writes) instead of in a Vault. strato-setup creates or imports it
-- here; the processes read it through
-- "Control.Monad.Composable.Vault.NodeKeyFile", which owns the format.
module Blockchain.Init.NodeKey
  ( nodeKeyFileName
  , nodeAddressFileName
  , nodeKeyEnvVar
  , setupLocalNodeKey
  , writeNodeKeyFile
  ) where

import Blockchain.Strato.Model.Address (Address, fromPrivateKey)
import Blockchain.Strato.Model.Secp256k1 (PrivateKey, newPrivateKey)
import Control.Monad.Composable.Vault.NodeKeyFile (parseNodeKey, readNodeKeyFile, renderNodeKeyPem)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import Data.Char (isSpace)
import System.Environment (lookupEnv)
import System.FilePath ((</>))
import System.Posix.Files (setFileMode)
import UnliftIO.Directory (doesFileExist)

-- | Where the key lives, relative to the node directory; written to
-- @urlConfig.nodeKeyFile@.
nodeKeyFileName :: FilePath
nodeKeyFileName = "secrets" </> "node_key.pem"

-- | The node's address, for operators and tooling (world-readable).
nodeAddressFileName :: FilePath
nodeAddressFileName = "secrets" </> "node_address"

-- | Holds a key to import, as PEM text or 64 hex characters.
nodeKeyEnvVar :: String
nodeKeyEnvVar = "STRATO_NODE_KEY"

-- | Make sure the node directory has its key, and say what it is.
--
-- A key file already in place is kept (a @--regenerate@, or a file the
-- operator copied in before setup); 'nodeKeyEnvVar' may then only repeat the
-- same key, never silently replace the identity. Without a file, the key in
-- 'nodeKeyEnvVar' is imported, or a new one generated. Either way the key is
-- never printed; the address is, and is also written to
-- 'nodeAddressFileName'.
setupLocalNodeKey :: IO Address
setupLocalNodeKey = do
  exists <- doesFileExist nodeKeyFileName
  offered <- (>>= nonBlank) <$> lookupEnv nodeKeyEnvVar
  key <-
    if exists
      then do
        key <- readNodeKeyFile nodeKeyFileName >>= either (error . (("existing node key is unusable: " ++))) return
        case parseNodeKey . C8.pack <$> offered of
          Nothing -> return ()
          Just (Left err) -> error $ nodeKeyEnvVar ++ ": " ++ err
          Just (Right key')
            | key' /= key -> error $ nodeKeyFileName ++ " already holds a different key than " ++ nodeKeyEnvVar ++ "; remove the file first to give this validator another identity"
            | otherwise -> return ()
        putStrLn $ "  ✓ Node key: " ++ nodeKeyFileName ++ " (local, kept), address " ++ showAddress key
        return key
      else case offered of
        Just given -> do
          key <- either (error . ((nodeKeyEnvVar ++ ": ") ++)) return (parseNodeKey (C8.pack given))
          writeNodeKeyFile nodeKeyFileName key
          putStrLn $ "  ✓ Node key: imported from " ++ nodeKeyEnvVar ++ " into " ++ nodeKeyFileName ++ ", address " ++ showAddress key
          return key
        Nothing -> do
          key <- newPrivateKey
          writeNodeKeyFile nodeKeyFileName key
          putStrLn $ "  ✓ Node key: generated " ++ nodeKeyFileName ++ ", address " ++ showAddress key
          putStrLn $ "  Back up " ++ nodeKeyFileName ++ ": it is the only copy of this validator's identity (snapshots never include secrets/)"
          return key
  let address = fromPrivateKey key
  writeFile nodeAddressFileName (show address ++ "\n")
  setFileMode nodeAddressFileName 0o644
  return address
  where
    nonBlank s = if all isSpace s then Nothing else Just s
    showAddress = ("0x" ++) . show . fromPrivateKey

-- | Write the key as PEM with mode 0600, set before any key byte lands in
-- the file.
writeNodeKeyFile :: FilePath -> PrivateKey -> IO ()
writeNodeKeyFile path key = do
  B.writeFile path B.empty
  setFileMode path 0o600
  B.writeFile path (renderNodeKeyPem key)
