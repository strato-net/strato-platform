{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE TemplateHaskell #-}

module Main where

import Control.Monad
import Control.Monad.Identity 

import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import Control.Monad.Trans.State
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Default
import Data.Functor
import Data.List
import qualified Data.Map as M
import Data.Monoid
import qualified Database.LevelDB as LD
import Blockchain.VM.VMState
import Blockchain.Output
import Blockchain.VMContext
import Control.Monad.Logger

import Control.Monad.Trans.Class
import Numeric

import System.Directory
import System.Exit
import Test.Framework
import Test.Framework.Providers.HUnit
import Test.HUnit
import Data.Aeson
import Data.Maybe
import Data.Either
import Data.List
import HFlags

import TestEthereum
import TestFiles
import qualified TestDescriptions as TD

doTests :: [(String, TD.Test)] -> IO ()
doTests tests = do
  results <- flip runLoggingT noLog $ runContextM $ forM tests $ \(n, test) -> do
    result <- runTest test 
    return $ (n, result)
  let a = fst results :: [(String, Either String String)]
  _ <- liftIO $ runTestTT $ TestList $ map f a 
  return ()
    where
  f :: (String, Either a b) -> Test.HUnit.Test 
  f (n, r) = TestLabel n (TestCase $ assertBool n (isRight $ r))

doTests' :: [(String, TD.Test)] -> ContextM Counts
doTests' tests = do
  results <- forM tests $ \(n, test) -> do
    result <- runTest test 
    return $ (n, result)
  let a = results :: [(String, Either String String)]
  liftIO $ runTestTT $ TestList $ map f a 
    where
  f :: (String, Either a b) -> Test.HUnit.Test 
  f (n, r) = TestLabel n (TestCase $ assertBool n (isRight $ r))

doTests'' :: [(String, TD.Test)] -> ContextM Test.HUnit.Test 
doTests'' tests = do
  results <- forM tests $ \(n, test) -> do
    result <- runTest test 
    return $ (n, result)
  let a = results :: [(String, Either String String)]
  return $ TestList $ map f a 
    where
  f :: (String, Either a b) -> Test.HUnit.Test 
  f (n, r) = TestLabel n (TestCase $ assertBool n (isRight $ r))

main::IO ()
main = do
  args <- $initHFlags "The Ethereum Test program"
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
  
  let a = tests :: [ContextM Test.HUnit.Test] 
  let g f mas = (fmap f) <$> sequence mas -- :: (Monad m, Traversable t) => (a -> b) -> t (m a) -> m (t b)
  let b = g id tests
  --(fmap TestList) <$> sequence tests :: _ 
  
  r <- do 
    flip runLoggingT noLog $ runContextM $ b

  let rr = fst r :: [Test.HUnit.Test]
  runTestTT $ TestList $ rr
   
  -- res <- forM testFiles $ \theFileName -> do
  --   theFile <- BL.readFile theFileName
  --   putStrLn $ "\n#### Running tests in file: " ++ theFileName
  --   case fmap fromJSON $ eitherDecode theFile::Either String (Result TD.Tests) of
  --         -- Left err ->  putStrLn ("error: " ++ err)
  --         Right val ->
  --           case val of
  --             --Error err' -> putStrLn ("error': " ++ err')
  --             Success tests -> doTests (M.toList tests) -- doTests 
  --   return ()

  -- let a = res :: [[(String, TD.Test)]]
  -- let b = join a :: [(String, TD.Test)]
  -- flip runLoggingT noLog $ runContextM $ doTests' b  

  return ()

