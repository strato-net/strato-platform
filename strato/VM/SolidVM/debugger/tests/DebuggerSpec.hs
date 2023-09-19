module DebuggerSpec where

import Data.Aeson as Aeson
import Debugger
import Test.Hspec
import Test.QuickCheck

jsonRT :: (ToJSON a, FromJSON a) => a -> a
jsonRT = either (error . ("Failed jsonRT: " ++)) id . Aeson.eitherDecode . Aeson.encode

jsonCheck :: (Eq a, Show a, ToJSON a, FromJSON a) => a -> Expectation
jsonCheck x = jsonRT x `shouldBe` x

breakpointJSON :: Spec
breakpointJSON = do
  it "should convert a Breakpoint to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: Breakpoint))

debugOperationJSON :: Spec
debugOperationJSON = do
  it "should convert a DebugOperation to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: DebugOperation))

debugStateJSON :: Spec
debugStateJSON = do
  it "should convert a DebugState to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: DebugState))

debuggerStatusJSON :: Spec
debuggerStatusJSON = do
  it "should convert a DebuggerStatus to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: DebuggerStatus))

spec :: Spec
spec = do
  describe "JSON roundtrips" $ do
    breakpointJSON
    debugOperationJSON
    debugStateJSON
    debuggerStatusJSON
