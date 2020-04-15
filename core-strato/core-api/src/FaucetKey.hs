
module FaucetKey (
  getFaucetKey
  ) where

import           Control.Monad.Except
import           Data.Binary                    as Bin
import qualified Data.ByteString.Base64         as Base64
import qualified Data.ByteString.Char8          as BC
import qualified Data.ByteString.Lazy           as BL
import           Data.Either.Extra
import qualified Network.Haskoin.Crypto         as H
import           System.Environment
import           System.Exit
import           System.FilePath

import           Text.Format

import           Blockchain.Strato.Model.Address

getGlobalKey :: IO (Maybe H.PrvKey)
getGlobalKey = fmap (H.makePrvKey . Bin.decode . BL.fromStrict) . BC.readFile $ "config" </> "priv"

getLocalKey :: IO (Maybe H.PrvKey)
getLocalKey = eitherExtractNodeKey >>= \case
  Left "NODEKEY not set" -> return Nothing
  Left err -> die err
  Right prvKey -> return $ Just prvKey

eitherExtractNodeKey :: IO (Either String H.PrvKey)
eitherExtractNodeKey = runExceptT $ do
  mKey <- liftEither =<< maybeToEither "NODEKEY not set" <$> liftIO (lookupEnv "NODEKEY")
  when (null mKey) $
    throwError "NODEKEY not set"
  bytes <- liftEither . Base64.decode . BC.pack $ mKey
  liftEither . maybeToEither "Invalid NODEKEY" . H.decodePrvKey H.makePrvKey $ bytes


-- | The @main@ function for an executable running this site.
getFaucetKey :: IO (Maybe H.PrvKey)
getFaucetKey = do
  localKey <- getLocalKey
  globalKey <- getGlobalKey
  case (localKey, globalKey) of
    (Just k, _) -> do
      putStrLn $ "Using local faucet: " ++ format (prvKey2Address k)
      return localKey
    (_, Just k) -> do
      putStrLn $ "Using global faucet: " ++ format (prvKey2Address k)
      return globalKey
    _ -> do
      putStrLn "No faucet key found; faucets are disabled"
      return Nothing
