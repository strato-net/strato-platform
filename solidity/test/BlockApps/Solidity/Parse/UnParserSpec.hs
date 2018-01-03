{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Parse.UnParserSpec where

import           Test.Hspec
import qualified Data.Map.Strict as Map
-- import           Text.Parsec                          hiding (parse)
import BlockApps.Solidity.Parse.UnParser (unparseFunc)
import BlockApps.Solidity.Xabi.Type
import BlockApps.Solidity.Xabi

{-# ANN module ("HLint: ignore Redundant do" :: String) #-}
{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: Spec
spec = do
  describe "UnParser - unparseFunc" $ do
    it "should unparse a function that returns a pair 'returns (int, uint)'" $ do
      let func = Func Map.empty
                      (Map.fromList [("#0", intIndexedType), ("#1", uintIndexedType)])
                      (Just "")
                      Nothing
                      Nothing
                      Nothing
                      Nothing
      putStrLn $ unparseFunc ("test", func)
      pending

printLeft :: Either String a -> IO ()
printLeft (Left msg) = putStrLn msg
printLeft (Right _) = return ()

intIndexedType :: IndexedType
intIndexedType = IndexedType 0 (Int (Just True) Nothing)

uintIndexedType :: IndexedType
uintIndexedType = IndexedType 0 (Int Nothing Nothing)
