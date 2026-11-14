{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import BlockApps.Logging (runLogging)
import qualified Blockchain.Data.BlockHeader as Header
import Blockchain.SolidVM.Simple hiding (name)
import Blockchain.VMContext (runMemContextM)
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Blockchain.Wiring ()
import Control.Lens
import Control.Monad
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class
import qualified Data.Text as T
import HFlags
import SolidVM.Model.Value

source :: T.Text
source = T.unlines
  [ "contract UIntProbe {"
  , " uint public stored; mapping(uint => uint) values; struct Box { uint value; } Box box;"
  , " constructor(uint, int signedValue, variadic) { require(signedValue == -3); }"
  , " function positive(uint, int signedValue, uint count, variadic) returns (bool) {"
  , "   uint x = count; x += 2; stored = x; box.value = x; values[0] = x;"
  , "   uint[] memory a = new uint[](1); a[0] = x;"
  , "   return stored == 7 && box.value == 7 && values[0] == 7 && a[0] == 7 && signedValue == -3;"
  , " }"
  , " function signedMath() returns (bool) { int x = -3; uint y = 2; int z = int(y) - 5; return x == z; }"
  , " function wide() returns (bool) { uint8 x = 256; return x == 256; }"
  , " function localNegative() { uint x = uint(0) - 1; }"
  , " function localAssignment() { uint x = 1; x = uint(0) - 1; }"
  , " function decrement() { uint x = 0; x--; }"
  , " function uncheckedNegative() { uint x; unchecked { x = uint(0) - 1; } }"
  , " function storageNegative() { stored = uint(0) - 1; }"
  , " function mappingNegative() { values[0] = uint(0) - 1; }"
  , " function structNegative() { box.value = uint(0) - 1; }"
  , " function arrayNegative() { uint[] memory a = new uint[](1); a[0] = uint(0) - 1; }"
  , " function castNegative() { uint(-1); }"
  , " function argument(uint, variadic) returns (bool) { return true; }"
  , "}"
  ]

main :: IO ()
main = do
  void $ $initHFlags "uint declarations"
  void $ runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $ do
    let at height h = h {Header.number = height}
        expect label success result = do
          liftIO $ unless ((erException result == Nothing) == success) $ fail $ label ++ ": " ++ show (erException result)
          pure result
        invoke address function args height = call $ def & callCodeAddress .~ address & callFuncName .~ function & callArgs . argsArgs .~ args & callArgs . argsBlockData %~ at height
    forM_ (zip [0..] [0, 1, 1000000]) $ \(index, height) -> do
      let address = 0x7500 + index
      deployed <- create $ def & createNewAddress .~ address & createContractName .~ "UIntProbe" & createCode .~ Code source & createArgs . argsArgs .~ ["0", "-3", "\"\""] & createArgs . argsBlockData %~ at height
      void $ expect "constructor arguments" True deployed
      forM_ [("positive", ["0", "-3", "5", "\"\""]), ("signedMath", []), ("wide", [])] $ \(function, args) -> do
        result <- invoke address function args height >>= expect (T.unpack function) True
        liftIO $ unless (erReturnVal result == Just (SBool True)) $ fail $ show (function, erReturnVal result)
      stored <- invoke address "stored" [] height >>= expect "storage getter" True
      liftIO $ unless (show (erReturnVal stored) == show (Just (SUnsigned 7))) $ fail "uint representation"
      forM_ ["localNegative", "localAssignment", "uncheckedNegative", "storageNegative", "mappingNegative", "structNegative", "arrayNegative", "castNegative"] $ \function ->
        void $ invoke address function [] height >>= expect (T.unpack function) False
      void $ invoke address "decrement" [] height >>= expect "decrement" False
      void $ invoke address "argument" ["-1", "\"\""] height >>= expect "anonymous argument" False
      liftIO $ putStrLn $ "PASS uint declarations at " ++ show height
