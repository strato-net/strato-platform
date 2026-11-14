{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import BlockApps.Logging (runLogging)
import qualified Blockchain.Data.BlockHeader as Header
import Blockchain.SolidVM.Simple hiding (name)
import Blockchain.VM.SolidException (SolidException (ArithmeticException))
import Blockchain.VMContext (runMemContextM, GasCap (..))
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Blockchain.Wiring ()
import qualified Control.Monad.Change.Modify as Mod
import Control.Lens
import Control.Monad
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class
import qualified Data.Text as T
import HFlags
import SolidVM.Model.Value

source :: T.Text
source = T.unlines
  [ "contract UnsignedExpressionProbe {"
  , " uint public stored = 3; uint unset; mapping(uint => Cell) cells; struct Cell { uint value; } Cell cell; uint[] entries; mapping(uint => uint) values;"
  , " constructor() { cell.value = 3; entries.push(3); values[0] = 3; }"
  , " function leaf() returns (uint) { return 1; }"
  , " function referenceConditional(bool flag) returns (bool) { uint[] storage pointer = entries; flag ? pointer : entries; return true; }"
  , " function good() returns (bool) { uint a = 7; uint b = 2;"
  , "   require(a + b == 9); require(a - b == 5); require(a * b == 14); require(a / b == 3); require(a % b == 1);"
  , "   require(a ** b == 49); require((a | b) == 7); require((a & b) == 2); require((a ^ b) == 5);"
  , "   require((a << b) == 28); require((a >> b) == 1); require(a + 2 == 9); require(2 + a == 9);"
  , "   int x = int(b) - int(a); require(x == -5); require(int(a) + x == 2);"
  , "   require((stored = 0) == 0); stored = 3; require((cell.value = 0) == 0); cell.value = 3;"
  , "   int y = int(a) + 1; require(y == 8); uint8 small = 256; require(small == 256); uint big = uint(1) << 300; require((big * big) >> 600 == 1); return true; }"
  , " function negative(uint which, bool flag) { uint a = 1; uint b = 2;"
  , "   if (which == 0) { a - b; }"
  , "   if (which == 1) { int x = int(a - b); }"
  , "   if (which == 2) { (a - b) + b; }"
  , "   if (which == 3) { uint(0) - a; }"
  , "   if (which == 4) { ~a; }"
  , "   if (which == 5) { (a + 1) - (b + 1); }"
  , "   if (which == 6) { (a * b) - (b * b); }"
  , "   if (which == 7) { (a / b) - a; }"
  , "   if (which == 8) { (a % a) - a; }"
  , "   if (which == 9) { (a ** b) - b; }"
  , "   if (which == 10) { (a & b) - a; }"
  , "   if (which == 11) { (a | b) - (b + b); }"
  , "   if (which == 12) { (a ^ a) - a; }"
  , "   if (which == 13) { (a << b) - (b << b); }"
  , "   if (which == 14) { (a >> b) - a; }"
  , "   if (which == 15) { leaf() - b; }"
  , "   if (which == 16) { (flag ? a : 0) - b; }"
  , "   if (which == 17) { (flag ? 0 : a) - b; }"
  , "   if (which == 18) { ((a = 1) - b); }"
  , "   if (which == 19) { (a += 0) - b; }"
  , "   if (which == 20) { (a -= 0) - b; }"
  , "   if (which == 21) { (a++) - b; }"
  , "   if (which == 22) { (++a) - (b + 1); }"
  , "   if (which == 23) { (b--) - (b + 2); }"
  , "   if (which == 24) { (--b) - (b + 1); }"
  , "   if (which == 25) { stored - (stored + 1); }"
  , "   if (which == 26) { cell.value - (cell.value + 1); }"
  , "   if (which == 27) { entries[0] - (entries[0] + 1); }"
  , "   if (which == 28) { values[0] - (values[0] + 1); }"
  , "   if (which == 29) { a + (1 - 2); }"
  , "   if (which == 30) { unchecked { a - b; } }"
  , "   if (which == 31) { leaf() + (1 - 2); }"
  , "   if (which == 32) { (flag ? leaf() : 0) - b; }"
  , "   if (which == 33) { values[999] - 1; }"
  , "   if (which == 34) { cells[999].value - 1; }"
  , "   if (which == 35) { unset - 1; }"
  , "   if (which == 36) { (unset + 1) - 2; }"
  , "   if (which == 37) { uint c = 5; c += (1 - 2); }"
  , "   if (which == 38) { uint c = 5; c -= (1 - 2); }"
  , "   if (which == 39) { uint c = 5; c *= (1 - 2); }"
  , "   if (which == 40) { uint c = 0; c -= 1; }"
  , "   if (which == 41) { (a += leaf()) - (b + 1); }"
  , "   if (which == 42) { (stored = 1) - b; }"
  , "   if (which == 43) { (cell.value = 1) - b; }"
  , "   if (which == 44) { (entries[0] = 1) - b; }"
  , "   if (which == 45) { (values[0] = 1) - b; }"
  , "   if (which == 46) { a + address(this).call(\"signedLeaf\"); }"
  , "   if (which == 47) { address(this).call(\"signedLeaf\") + a; }"
  , " }"
  , " function signedLeaf() returns (int) { return -1; }"
  , " function dynamicArithmetic() returns (bool) { uint a = 3; return int(a + address(this).call(\"leaf\")) == 4 && int(address(this).call(\"leaf\") + a) == 4 && int(a) + int(address(this).call(\"signedLeaf\")) == 2; }"
  , " function dynamicConditional(bool flag) returns (bool) { uint a = 1; return int(flag ? a : address(this).call(\"signedLeaf\")) == (flag ? 1 : -1); }"
  , " function conditionalLazy(bool flag) returns (bool) { uint a = 1; try { flag ? a : (1 - 2); return flag; } catch { return !flag; } }"
  , " function catches(uint which, bool flag) returns (bool) { try { negative(which, flag); } catch { return true; } return false; }"
  , "}"
  ]

main :: IO ()
main = do
  void $ $initHFlags "unsigned expressions"
  void $ runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $ do
    Mod.put (Mod.Proxy :: Mod.Proxy GasCap) (GasCap (Gas 100000000))
    let at height h = h {Header.number = height}
        expect label result = do
          liftIO $ unless (erException result == Nothing) $ fail $ label ++ ": " ++ show (erException result)
          pure result
    forM_ (zip [0..] [0, 1, 1000000]) $ \(index, height) -> do
      let address = 0x7700 + index
          invoke function args = call (def & callCodeAddress .~ address & callFuncName .~ function & callArgs . argsArgs .~ args & callArgs . argsBlockData %~ at height) >>= expect (T.unpack function)
      create (def & createNewAddress .~ address & createContractName .~ "UnsignedExpressionProbe" & createCode .~ Code source & createArgs . argsBlockData %~ at height) >>= void . expect "deploy"
      dynamic <- invoke "dynamicArithmetic" []
      liftIO $ unless (erReturnVal dynamic == Just (SBool True)) $ fail "dynamic unsigned arithmetic changed"
      good <- invoke "good" []
      liftIO $ unless (erReturnVal good == Just (SBool True)) $ fail "valid arithmetic changed"
      forM_ [0..47 :: Int] $ \which -> forM_ [False, True] $ \flag -> do
        let args = [T.pack (show which), if flag then "true" else "false"]
        rejected <- call $ def & callCodeAddress .~ address & callFuncName .~ "negative" & callArgs . argsArgs .~ args & callArgs . argsBlockData %~ at height
        liftIO $ case erException rejected of
          Just (Left ArithmeticException{}) -> pure ()
          other -> fail $ "expected SolidVM underflow: " ++ show (height, which, flag, other)
        result <- invoke "catches" args
        liftIO $ unless (erReturnVal result == Just (SBool True)) $ fail $ "unsigned expression escaped: " ++ show (height, which, flag, erReturnVal result)
      forM_ ["true", "false"] $ \flag -> do
        reference <- invoke "referenceConditional" [flag]
        liftIO $ unless (erReturnVal reference == Just (SBool True)) $ fail "storage pointer conditional changed"
        raw <- invoke "dynamicConditional" [flag]
        liftIO $ unless (erReturnVal raw == Just (SBool True)) $ fail "dynamic conditional result changed"
        lazy <- invoke "conditionalLazy" [flag]
        liftIO $ unless (erReturnVal lazy == Just (SBool True)) $ fail "conditional branch was evaluated incorrectly"
      liftIO $ putStrLn $ "PASS unsigned expressions at " ++ show height
