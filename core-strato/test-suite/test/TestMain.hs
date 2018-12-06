{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Main where

import           Control.Monad
import           Control.Monad.Logger
import           Data.Aeson
import qualified Data.ByteString                as B
import qualified Data.Map                       as M
import           Executable.EVMFlags            ()
import           HFlags
import           System.Directory

import           Blockchain.Output
import qualified Blockchain.VM.TestDescriptions as TD
import           Blockchain.VM.TestEthereum
import           Blockchain.VM.TestFiles
import           Blockchain.VMContext
import           Blockchain.VMOptions           ()

main::IO ()
main = do
  _ <- $initHFlags "The ethereum-test test-suite"
  testsExist <- doesDirectoryExist "tests"
  unless testsExist $
    error "You need to clone the git repository at https://github.com/ethereum/tests.git"

  putStrLn "\nRunning ethereum tests\n"
  forM_ testFiles $ \theFileName -> do
    here <- getCurrentDirectory
    putStrLn $ "I am " ++ here
    theFile <- B.readFile theFileName
    putStrLn $ "\n - Running tests from " ++ theFileName
    case fromJSON <$> eitherDecodeStrict theFile::Either String (Result TD.Tests) of
        Right val ->
          case val of
            Success tests -> flip runLoggingT printLogMsg $ runTestContextM $ runTests (M.toList tests)
            x             -> error $ "hit Failure for " ++ show x
        Left err -> error $ "unable to decode json: " ++ show err
