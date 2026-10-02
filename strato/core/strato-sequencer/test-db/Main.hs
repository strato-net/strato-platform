{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}

-- | The dependent-block DB stages writes until 'commitDependentBlockDB', so
-- what it records as emitted can never outlive the output that record is for.
module Main (main) where

import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Strato.Model.Keccak256 (Keccak256, hash)
import Control.Monad.Composable.Base (Eff, InternalState, provide, runEff, withResources)
import Data.Maybe (isJust, isNothing)
import System.IO.Temp (withSystemTempDirectory)
import Test.Hspec

main :: IO ()
main = hspec spec

-- | Like 'runWithDependentBlockDB', but without the commit at the end.
withoutCommit :: FilePath -> Eff '[DependentBlockDB, InternalState] a -> IO a
withoutCommit dbPath action = runEff . withResources $ do
  db <- openDependentBlockDB dbPath 0
  provide db action

block :: Keccak256
block = hash "a block"

spec :: Spec
spec = around (withSystemTempDirectory "dependent-block-db") $ do
  it "reads back a staged write before it is committed" $ \dir -> do
    seen <- withoutCommit dir $ bootstrapGenesisBlock block >> lookupDependentBlockDB block
    seen `shouldSatisfy` isJust

  it "drops an uncommitted write when the DB is reopened" $ \dir -> do
    withoutCommit dir $ bootstrapGenesisBlock block
    seen <- withoutCommit dir $ lookupDependentBlockDB block
    seen `shouldSatisfy` isNothing

  it "keeps a committed write across a reopen" $ \dir -> do
    runWithDependentBlockDB dir 0 $ bootstrapGenesisBlock block
    seen <- withoutCommit dir $ lookupDependentBlockDB block
    seen `shouldSatisfy` isJust

  it "hides a committed value behind a staged delete until that is committed" $ \dir -> do
    runWithDependentBlockDB dir 0 $ bootstrapGenesisBlock block
    hidden <- withoutCommit dir $ deleteDependentBlockDB block >> lookupDependentBlockDB block
    hidden `shouldSatisfy` isNothing
    stillThere <- withoutCommit dir $ lookupDependentBlockDB block
    stillThere `shouldSatisfy` isJust
    runWithDependentBlockDB dir 0 $ deleteDependentBlockDB block
    gone <- withoutCommit dir $ lookupDependentBlockDB block
    gone `shouldSatisfy` isNothing
