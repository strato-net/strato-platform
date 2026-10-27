{-# LANGUAGE OverloadedStrings #-}

module Main where

import Blockchain.Model.SyncState (BestBlock (..))
import Blockchain.PeerClaims
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Keccak256 (zeroHash)
import Test.Hspec

-- | Connection @c@, from @host@, claiming height @n@.
says :: Int -> Host -> Integer -> PeerClaims Int -> PeerClaims Int
says c host n = claim c host (BestBlock zeroHash n)

world :: PeerClaims Int -> Maybe Integer
world = fmap bestBlockNumber . worldBest

main :: IO ()
main = hspec . describe "peer claims" $ do
  it "has no world best until a peer claims one" $
    world noClaims `shouldBe` Nothing

  it "takes the highest claim while fewer than three hosts are connected" $ do
    world (says 1 "a" 100 noClaims) `shouldBe` Just 100
    world (says 2 "b" 90 $ says 1 "a" 100 noClaims) `shouldBe` Just 100

  it "takes the median from three hosts up, so a minority overstating does not move it" $ do
    let honest = says 3 "c" 99 . says 2 "b" 101 . says 1 "a" 100
    world (honest noClaims) `shouldBe` Just 100
    world (says 4 "liar" 1000000000 $ honest noClaims) `shouldBe` Just 100
    world (says 5 "liar2" 1000000000 . says 4 "liar" 1000000000 $ honest noClaims) `shouldBe` Just 101

  it "counts a host once however many connections it holds" $ do
    let honest = says 3 "c" 99 . says 2 "b" 101 . says 1 "a" 100
        flood = foldr (\c -> says c "liar" 1000000000) (honest noClaims) [10 .. 40]
    world flood `shouldBe` Just 100

  it "comes back down when the connection that raised it ends" $ do
    let claims = says 2 "liar" 1000000000 $ says 1 "a" 100 noClaims
    world claims `shouldBe` Just 1000000000
    world (withdraw 2 claims) `shouldBe` Just 100
    world (withdraw 1 $ withdraw 2 claims) `shouldBe` Nothing

  it "keeps each connection's own claim, which is what that peer is asked for" $ do
    let claims = says 3 "c" 99 . says 2 "liar" 1000000000 $ says 1 "a" 100 noClaims
    fmap bestBlockNumber (claimOf 2 claims) `shouldBe` Just 1000000000
    fmap bestBlockNumber (claimOf 1 claims) `shouldBe` Just 100
    claimOf 7 claims `shouldBe` Nothing
    -- a peer that turned out to have nothing is marked down, and the rest stand
    fmap bestBlockNumber (claimOf 2 $ says 2 "liar" 50 claims) `shouldBe` Just 50
    world (says 2 "liar" 50 claims) `shouldBe` Just 99
