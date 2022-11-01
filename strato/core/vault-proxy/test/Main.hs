module Main (main) where

import           Test.Hspec

import qualified VaultProxySpec as VP

main :: IO ()
main = hspec $ do
  VP.spec