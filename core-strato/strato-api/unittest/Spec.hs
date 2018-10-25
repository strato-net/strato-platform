{-# OPTIONS_GHC -fno-warn-missing-fields #-}
import ClassyPrelude
import Control.Concurrent.Async.Lifted
import Foundation

import Test.Hspec.Core.Runner
import Test.Hspec.Core.Spec
import Test.Hspec.Expectations.Lifted

main :: IO ()
main = hspec spec

runTestM :: ReaderT App IO () -> IO ()
runTestM mv = do
  ref <- initialMaxNonce
  runReaderT mv App{appFaucetNonce = ref}

spec :: Spec
spec = describe "acquireNewMaxNonce" $ do
  it "allocates distinct" . runTestM $
    replicateM 100 (acquireNewMaxNonce 0) `shouldReturn` [0..99]

  it "will give a nonce larger than min nonce" . runTestM $
    acquireNewMaxNonce 2007 `shouldReturn` 2007

  it "is thread safe" . runTestM $ do
    nonces <- replicateConcurrently 100 (acquireNewMaxNonce 100)
    nonces `shouldMatchList` [100..199]

  it "gives the minimum allowable" . runTestM $ do
    acquireNewMaxNonce 400 `shouldReturn` 400
    acquireNewMaxNonce 420 `shouldReturn` 420
    acquireNewMaxNonce 420 `shouldReturn` 421
    acquireNewMaxNonce 422 `shouldReturn` 422
