{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

import           Control.Monad
import           Blockchain.Output
import           HFlags
import           System.Directory

import           Blockchain.VM.TestEthereum
import           Blockchain.VMContext
import           Blockchain.VMOptions       ()

main::IO ()
main = do
  args <- $initHFlags "The Ethereum Test program"
  putStrLn $ "ethereum-test with args: " ++ unlines args
  testsExist <- doesDirectoryExist "tests"
  when (not testsExist) $
    error "You need to clone the git repository at https://github.com/ethereum/tests.git"

  let (maybeFileName, maybeTestName) =
        case args of
          []     -> (Nothing, Nothing)
          [x]    -> (Just x, Nothing)
          [x, y] -> (Just x, Just y)
          _      -> error "You can only supply 2 parameters"

  _ <- flip runLoggingT noLog $ runContextM $ do
    runAllTests maybeFileName maybeTestName

  return ()
