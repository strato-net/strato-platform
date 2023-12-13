{-# LANGUAGE BangPatterns      #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module Main where

import Control.Monad.Logger
import Control.Monad.Reader
import Data.ByteString    as DB
import Data.Text          as T
import Data.Text.Encoding as DTE
import System.FilePath (takeExtension)
--import qualified Blockchain.Data.AlternateTransaction as E
--import Blockchain.Strato.Model.Address
--import Blockchain.Strato.Model.Secp256k1
--import Clockwork
--import Crypto.Random.Entropy
--import qualified Crypto.Secp256k1 as SEC
--import qualified Data.ByteString as B
--import qualified Data.ByteString.Char8 as C8
--import Data.Maybe
--import qualified LabeledError
--import System.IO.Unsafe
import Test.Hspec

import Blockchain.Strato.Model.Keccak256

--dummy test string for testing
testbytestring :: DB.ByteString
testbytestring = DTE.encodeUtf8 $ T.pack "BlockApps rules!"

--dummy test file name for testing.
testfilename :: T.Text
testfilename = T.pack "test.txt"

data HighwayContext = HighwayContext
  { _bs       :: DB.ByteString
  , _filename :: T.Text
  }

type HighwayContextM = ReaderT HighwayContext (NoLoggingT IO)

runHighwayContextWithEnv :: HighwayContext
                         -> HighwayContextM a
                         -> IO a
runHighwayContextWithEnv env x =
  runNoLoggingT $ runReaderT x env

main :: IO ()
main = do
  let testenv = HighwayContext testbytestring
                               testfilename
  runHighwayContextWithEnv testenv testFileUpload

testFileUpload :: ReaderT HighwayContext (NoLoggingT IO) ()
testFileUpload = do
  bs                 <- asks _bs
  filename           <- asks _filename
  liftIO $
    hspec $ do
      describe "highway" $ do
        describe "server" $ do
          it "can take a file and its contents, return a url, and then grab the file by that url." $ do
            let contentHash    = T.pack $ keccak256ToHex $ hash bs
                extension      = T.pack . takeExtension . T.unpack $ filename
                uploadfilename = contentHash <> extension
            uploadfilename `shouldBe` contentHash <> extension
