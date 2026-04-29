module Main where

import qualified BuiltinsAuditFixSpec as BAS
import qualified SetGetAuditFixSpec as SGAS
import Test.Hspec

main :: IO ()
main = hspec $ do
  BAS.spec
  SGAS.spec
