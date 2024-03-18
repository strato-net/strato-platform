{-# LANGUAGE LambdaCase #-}

module FaucetKey
  ( getFaucetKey,
  )
where

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Control.Monad (when)
import Control.Monad.Except
import Control.Monad.IO.Class
import qualified Data.ByteString.Base64 as Base64
import qualified Data.ByteString.Char8 as BC
import Data.Either.Extra
import System.Environment
import System.Exit
import System.FilePath
import Text.Format

getGlobalKey :: IO (Maybe PrivateKey)
getGlobalKey = fmap importPrivateKey . BC.readFile $ "config" </> "priv"

getLocalKey :: IO (Maybe PrivateKey)
getLocalKey =
  eitherExtractNodeKey >>= \case
    Left "NODEKEY not set" -> return Nothing
    Left err -> die err
    Right prvKey -> return $ Just prvKey

eitherExtractNodeKey :: IO (Either String PrivateKey)
eitherExtractNodeKey = runExceptT $ do
  mKey <- liftEither =<< maybeToEither "NODEKEY not set" <$> liftIO (lookupEnv "NODEKEY")
  when (null mKey) $
    throwError "NODEKEY not set"
  bytes <- liftEither . Base64.decode . BC.pack $ mKey
  liftEither . maybeToEither "Invalid NODEKEY" . importPrivateKey $ bytes

-- | The @main@ function for an executable running this site.
getFaucetKey :: IO (Maybe PrivateKey)
getFaucetKey = do
  localKey <- getLocalKey
  globalKey <- getGlobalKey
  case (localKey, globalKey) of
    (Just k, _) -> do
      putStrLn $ "Using local faucet: " ++ format (fromPrivateKey k)
      return localKey
    (_, Just k) -> do
      putStrLn $ "Using global faucet: " ++ format (fromPrivateKey k)
      return globalKey
    _ -> do
      putStrLn "No faucet key found; faucets are disabled"
      return Nothing
