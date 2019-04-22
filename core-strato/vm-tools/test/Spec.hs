{-# LANGUAGE TemplateHaskell #-}
import Control.Monad
import HFlags
import Test.Hspec (hspec, describe, Spec)
import qualified Test.Hspec as HS
import Test.Hspec.Expectations.Lifted

import Blockchain.Output
import Blockchain.VMContext
import Executable.EVMFlags ()
import Blockchain.VMOptions ()

it :: String -> ContextM () -> HS.SpecWith ()
it qual act = HS.it qual . void . runNoLoggingT . runTestContextM $ act

main :: IO ()
main = do
  void $ $initHFlags "VMContext testing"
  hspec spec

spec :: Spec
spec = describe "VMContext" $ do
  it "has pending 0s without a queue" $ do
    peekPendingVote `shouldReturn` (0, 0)

  it "has a pending vote after an enqueue" $ do
    queuePendingVote 0xdeadbeef True
    peekPendingVote `shouldReturn` (0xdeadbeef, maxBound)

  it "keeps a pending vote after peeking" $ do
    queuePendingVote 0xdeadbeef False
    peekPendingVote `shouldReturn` (0xdeadbeef, 0)
    peekPendingVote `shouldReturn` (0xdeadbeef, 0)
