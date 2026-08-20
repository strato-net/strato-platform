module SyncTaskSpec (spec) where

import Blockchain.SyncDB
import Test.Hspec

-- Drive the shipped assignment predicate the same way getNewSyncTask
-- chooses INSERT vs steal vs promote. A 15-peer handshake must not
-- create more than maxInFlightChiliads Assigned chiliads.
assign15New :: Int -> [Bool]
assign15New start =
  let step (assigned, acc) =
        let ok = shouldAssignChiliad InsertNew assigned
            assigned' = if ok then assigned + 1 else assigned
         in (assigned', acc ++ [ok])
   in snd $ iterate step (start, []) !! 15

spec :: Spec
spec = describe "shouldAssignChiliad in-flight cap" $ do
  it "lets at most maxInFlightChiliads new chiliads become Assigned" $ do
    let decisions = assign15New 0
    length (filter id decisions) `shouldBe` maxInFlightChiliads
    length decisions `shouldBe` 15
    take maxInFlightChiliads decisions `shouldBe` replicate maxInFlightChiliads True
    drop maxInFlightChiliads decisions `shouldBe` replicate (15 - maxInFlightChiliads) False

  it "still allows stealing a stale Assigned chiliad at the cap" $
    shouldAssignChiliad StealStaleAssigned maxInFlightChiliads `shouldBe` True

  it "does not promote NotReady once the cap is reached" $
    shouldAssignChiliad PromoteNotReady maxInFlightChiliads `shouldBe` False

  it "allows a new insert after one Assigned chiliad finishes" $
    shouldAssignChiliad InsertNew (maxInFlightChiliads - 1) `shouldBe` True
