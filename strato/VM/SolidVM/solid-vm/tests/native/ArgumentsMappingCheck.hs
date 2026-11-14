{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import BlockApps.Logging (runLogging)
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
  [ "contract ArgumentsMappingProbe {"
  , " constructor(uint, string, bool) { require(msg.data[0] == 4); require(msg.data[1] == \"hi\"); require(msg.data[2] == true); }"
  , " function unnamed(uint, string, bool) returns (variadic) { return msg.data; }"
  , " function tail(uint, variadic) returns (variadic) { return msg.data; }"
  , " function empty() returns (variadic) { return msg.data; }"
  , " function inner(uint, string) returns (variadic) { return msg.data; }"
  , " function nested(uint, string, bool) returns (variadic) { inner(99, \"nested\"); return msg.data; }"
  , " function changed(uint value, string) returns (variadic) { value = 9; return msg.data; }"
  , " modifier observed() { require(msg.data[0] == 4); _; }"
  , " function modified(uint, string, bool) observed returns (variadic) { return msg.data; }"
  , " function defaults() returns (bool) {"
  , "   mapping(uint => uint) amounts; mapping(uint => int) signedAmounts;"
  , "   mapping(uint => bool) flags; mapping(uint => string) texts; mapping(uint => address) addresses;"
  , "   require(amounts[7] == 0); require(signedAmounts[7] == 0); require(flags[7] == false);"
  , "   require(texts[7] == \"\"); require(addresses[7] == address(0));"
  , "   amounts[1] = 8; require(amounts[7] == 0); require(amounts[1] == 8);"
  , "   return true;"
  , " }"
  , " enum Kind { First, Second } struct Cell { uint value; bool flag; }"
  , " function compoundDefaults() returns (bool) {"
  , "   mapping(uint => Cell) cells; mapping(uint => Kind) kinds; mapping(uint => uint[]) arrays;"
  , "   require(cells[7].value == 0); require(cells[7].flag == false);"
  , "   require(kinds[7] == Kind.First); require(arrays[7].length == 0); return true;"
  , " }"
  , "}"
  ]

equal :: Value -> Value -> Bool
equal (SVariadic a) (SVariadic b) = length a == length b && and (zipWith equal a b)
equal a b = a == b

main :: IO ()
main = do
  void $ $initHFlags "ordered arguments and mapping defaults"
  void $ runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $ do
    let expect label result = do
          liftIO $ unless (erException result == Nothing) $ fail $ label ++ ": " ++ show (erException result)
          pure result
        invoke function args = call (def & callCodeAddress .~ 0x7600 & callFuncName .~ function & callArgs . argsArgs .~ args) >>= expect (T.unpack function)
        arguments = ["4", "\"hi\"", "true"]
        values = [SInteger 4, SString "hi", SBool True]
    create (def & createNewAddress .~ 0x7600 & createContractName .~ "ArgumentsMappingProbe" & createCode .~ Code source & createArgs . argsArgs .~ arguments) >>= void . expect "constructor msg.data"
    forM_ ["unnamed", "nested", "modified"] $ \function -> do
      result <- invoke function arguments
      liftIO $ unless (maybe False (`equal` SVariadic values) (erReturnVal result)) $ fail $ show (function, erReturnVal result)
    forM_ [("tail", arguments, SVariadic [SInteger 4, SVariadic [SString "hi", SBool True]]), ("empty", [], SVariadic []), ("changed", ["4", "\"hi\""], SVariadic [SInteger 9, SString "hi"])] $ \(function, args, expected) -> do
      result <- invoke function args
      liftIO $ unless (maybe False (`equal` expected) (erReturnVal result)) $ fail $ show (function, erReturnVal result)
    forM_ ["defaults", "compoundDefaults"] $ \function -> do
      result <- invoke function []
      liftIO $ unless (erReturnVal result == Just (SBool True)) $ fail $ show (function, erReturnVal result)
    liftIO $ putStrLn "PASS ordered arguments and mapping defaults"
