{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE TemplateHaskell #-}

module Main where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           System.Directory
import           Test.HUnit
import           Data.Aeson
import           Data.Either
import           HFlags
import qualified Blockchain.VM.TestDescriptions as TD
import qualified Data.Map as M
import qualified Data.ByteString.Lazy as BL

import           Blockchain.VMOptions()
import           Blockchain.VMContext
import           Blockchain.VM.TestEthereum
import           Blockchain.VM.TestFiles

doTests :: [(String, TD.Test)] -> IO ()
doTests tests = do
  results <- flip runLoggingT noLog $ runContextM $ forM tests $ \(n, t) -> do
    result <- runTest t 
    return $ (n, result)
  let a = fst results :: [(String, Either String String)]
  _ <- liftIO $ runTestTT $ TestList $ map f a 
  return ()
    where
  f :: (String, Either a b) -> Test.HUnit.Test 
  f (n, r) = TestLabel n (TestCase $ assertBool n (isRight $ r))

doTests' :: [(String, TD.Test)] -> ContextM Counts
doTests' tests = do
  results <- forM tests $ \(n, t) -> do
    result <- runTest t 
    return $ (n, result)
  let a = results :: [(String, Either String String)]
  liftIO $ runTestTT $ TestList $ map f a 
    where
  f :: (String, Either a b) -> Test.HUnit.Test 
  f (n, r) = TestLabel n (TestCase $ assertBool n (isRight $ r))

doTests'' :: [(String, TD.Test)] -> ContextM Test.HUnit.Test 
doTests'' tests = do
  results <- forM tests $ \(n, t) -> do
    result <- runTest t
    return $ (n, result)
  let a = results :: [(String, Either String String)]
  return $ TestList $ map f a 
    where
  f :: (String, Either a b) -> Test.HUnit.Test 
  f (n, r) = TestLabel n (TestCase $ assertBool n (isRight $ r))

main::IO ()
main = do
  _ <- $initHFlags "The ethereum-test test-suite"
  testsExist <- doesDirectoryExist "tests"
  when (not testsExist) $
    error "You need to clone the git repository at https://github.com/ethereum/tests.git"

  putStrLn $ "\nRunning ethereum tests\n"
  tests <- forM testFiles $ \theFileName -> do
    theFile <- BL.readFile theFileName
    putStrLn $ "\n - Running tests from " ++ theFileName
    return $ case fmap fromJSON $ eitherDecode theFile::Either String (Result TD.Tests) of
        Right val ->
          case val of
            Success tests -> TestLabel theFileName <$> (doTests'' (M.toList tests))
            _ -> error $ "hit Failure for " ++ show theFileName 
        Left _ -> error "hit Left"

  let g f mas = (fmap f) <$> sequence mas -- :: (Monad m, Traversable t) => (a -> b) -> t (m a) -> m (t b)
  let b = g id tests
  
  r <- do 
    flip runLoggingT noLog $ runContextM $ b

  let rr = fst r :: [Test.HUnit.Test]
  void $ runTestTT $ TestList $ rr
  
  return ()

