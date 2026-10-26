{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Main where

import BlockApps.Logging (runLogging)
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromSource)
import Blockchain.SolidVM.Simple hiding (name)
import Blockchain.VMContext (runMemContextM)
import Blockchain.VMOptions ()
import Blockchain.Strato.Model.Options ()
import Blockchain.Wiring ()
import Control.Lens
import Control.Monad (forM_, unless, void)
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString as B
import Data.Either (isLeft)
import qualified Data.Map.Strict as Map
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import HFlags
import qualified SolidVM.Compile as Native
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.Value
import qualified SolidVM.Source as Source

source :: T.Text
source = T.unlines
  [ "interface CreatedView { function value() external returns (uint); }"
  , "contract TypedBuiltins { uint counter; struct Pair { uint z; uint a; }"
  , "function creation() returns (bool) { address a = create(\"Made\",\"contract Made { uint public value; constructor(uint n) { value = n; } }\",7); address b = create2(\"typed-salt\",\"Made\",\"contract Made { uint public value; constructor(uint n) { value = n; } }\",9); return CreatedView(a).value() == 7 && CreatedView(b).value() == 9; }"
  , "function recovery() returns (bool) { return ecrecover(hex\"0000000000000000000000000000000000000000000000000000000000000000\",27,\"0x0\",0) == address(0); }"
  , "function modular() returns (bool) { return addmod(7,5,3) == 0 && mulmod(7,5,3) == 2; }"
  , "function hashes() returns (bool) { variadic args = variadic(1,\"abc\"); return keccak256(1,\"abc\") == keccak256(args); }"
  , "function abiValues() returns (bool) { variadic args = variadic(7,true,\"abc\",hex\"0102\"); return abi.encode(7,true,\"abc\",hex\"0102\") == abi.encode(args) && abi.encodePacked(7,true,\"abc\",hex\"0102\") == abi.encodePacked(args); }"
  , "function abiArrays() returns (bool) { uint[] values = [1,2,3]; variadic args = variadic(values); return abi.encode(values) == abi.encode(args) && abi.encodePacked(values) == abi.encodePacked(args); }"
  , "function structFields() returns (bool) { Pair pair = Pair(3,5); variadic args = variadic(pair); uint[] values = [1,2,3]; variadic arrayArgs = variadic(values); return keccak256(pair) == keccak256(args) && keccak256(values) == keccak256(arrayArgs); }"
  , "function casts() returns (bool) { return int(decimal(\"2.75\")) == 3 && address(\"0xabc\") == address(0xabc) && string(255,16,2) == \"0x00ff\" && string(hex\"616263\",\"raw\") == \"abc\"; }"
  , "function castArguments() returns (bool) { variadic value = variadic(42); variadic number = variadic(255,16,2); return int(value) == 42 && string(number) == string(255,16,2); }"
  , "function invalidValue() returns (bool) { bool caught = false; try { string(1,2); } catch { caught = true; } return caught; }"
  , "function invalidEncoding() returns (bool) { bool caught = false; try { string(hex\"ff\",\"utf-8\"); } catch { caught = true; } return caught; }"
  , "function argumentOrder() returns (bool) { bool caught = false; try { addmod(counter++,counter++,0); } catch { caught = true; } return caught && counter == 2; }"
  , "}"
  ]

staticSource :: B.ByteString
staticSource = TE.encodeUtf8 $ T.unlines
  [ "contract TypedStatic {"
  , "function modular(uint a,uint b,uint m) returns (uint) { return addmod(a,b,m); }"
  , "function hash(uint a) returns (string) { return keccak256(a,\"abc\"); }"
  , "function encode(uint a) returns (bytes) { return abi.encode(a,true,\"abc\"); }"
  , "function cast(decimal a) returns (uint) { return uint(a); }"
  , "function castAddress(bytes a) returns (address) { return address(a); }"
  , "function castDecimal(int a) returns (decimal) { return decimal(a); }"
  , "function castString(bytes a) returns (string) { return string(a); }"
  , "function recover(string h,int v,string r,string s) returns (address) { return ecrecover(h,v,r,s); }"
  , "function destroy(address a) returns (bool) { return selfdestruct(a); }"
  , "}"
  ]

simpleSource :: B.ByteString
simpleSource = TE.encodeUtf8 $ T.unlines
  [ "contract SimpleCalls {"
  , "function add(int x,int y) internal returns (int) { return x+y; }"
  , "function positive(int x) internal returns (bool) { return x>0; }"
  , "function decimalAdd(decimal x,decimal y) internal returns (decimal) { return x+y; }"
  , "function echo(string value) internal returns (string) { return value; }"
  , "function echoBytes(bytes value) internal returns (bytes) { return value; }"
  , "function echoAddress(address value) internal returns (address) { return value; }"
  , "function divide(int x,int y) internal returns (int) { return x/y; }"
  , "function run() returns (bool) { return add(7,5)==12 && positive(1) && !positive(-1) && decimalAdd(decimal(2),decimal(3))==decimal(5) && echo(\"abc\")==\"abc\" && echoBytes(hex\"0102\")==hex\"0102\" && echoAddress(address(1))==address(1); }"
  , "function errors() returns (bool) { try { divide(1,0); } catch { return true; } return false; }"
  , "}"
  ]

main :: IO ()
main = do
  void $ $initHFlags "typed native builtin binding checks"
  void $ runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $ do
    deployed <- create $ def & createNewAddress .~ 0x3900 & createContractName .~ "TypedBuiltins" & createCode .~ Code source
    liftIO $ unless (show (erException deployed) == "Nothing") $ fail $ show $ erException deployed
    forM_ ["creation", "recovery", "modular", "hashes", "abiValues", "abiArrays", "structFields", "casts", "castArguments", "invalidValue", "invalidEncoding", "argumentOrder"] $ \function -> do
      result <- call $ def & callCodeAddress .~ 0x3900 & callFuncName .~ function
      liftIO $ do
        unless (show (erException result, erReturnVal result) == show (Nothing :: Maybe String, Just $ SBool True)) $
          fail $ T.unpack function ++ ": " ++ show (erException result, erReturnVal result)
        putStrLn $ "TYPED " ++ T.unpack function ++ " passed"
    destroyed <- create $ def & createNewAddress .~ 0x3910 & createContractName .~ "DestroyProbe"
      & createCode .~ Code "contract DestroyProbe { function remove() returns (bool) { return selfdestruct(address(0xabc)); } }"
    liftIO $ unless (show (erException destroyed) == "Nothing") $ fail $ show $ erException destroyed
    removed <- call $ def & callCodeAddress .~ 0x3910 & callFuncName .~ "remove"
    liftIO $ case (erException removed, erReturnVal removed) of
      (Nothing, Just (SBool _)) -> putStrLn "TYPED selfdestruct passed"
      _ -> fail $ show (erException removed, erReturnVal removed)
    simple <- create $ def & createNewAddress .~ 0x3920 & createContractName .~ "SimpleCalls" & createCode .~ Code (TE.decodeUtf8 simpleSource)
    liftIO $ unless (show (erException simple) == "Nothing") $ fail $ show $ erException simple
    forM_ ["run", "errors"] $ \function -> do
      result <- call $ def & callCodeAddress .~ 0x3920 & callFuncName .~ function
      liftIO $ unless (show (erException result, erReturnVal result) == show (Nothing :: Maybe String, Just $ SBool True)) $
        fail $ "scalar call " ++ T.unpack function ++ ": " ++ show (erException result, erReturnVal result)
    (_, simpleCollection) <- codeCollectionFromSource False True simpleSource
    simpleRendered <- liftIO $ Source.renderContract "SimpleCalls" simpleCollection
    liftIO $ case simpleRendered of
      Left errors -> fail $ show errors
      Right code -> do
        writeFile "/tmp/strato-simple-typed-calls-generated.hs" $ T.unpack code
        unless ("linkScalar" `T.isInfixOf` code) $ fail "scalar calls did not use the typed link"
        let functionCode name = T.unlines $ takeWhile
              (\line -> not ("simpleCalls_" `T.isPrefixOf` line) || (name <> " ") `T.isPrefixOf` line)
              (dropWhile (not . T.isPrefixOf (name <> " ::")) (T.lines code))
        forM_ ["add", "positive", "decimalAdd", "echo", "echoBytes", "echoAddress", "divide", "run"] $ \name -> do
          let body = functionCode ("simpleCalls_" <> name)
          unless (not (T.null body) && not ("Dyn" `T.isInfixOf` body)) $ fail $ "scalar function retains Dyn: " ++ T.unpack name
        forM_ ["internalFrame", "typedReturns", "fromDyn"] $ \helper ->
          unless (not $ helper `T.isInfixOf` code) $ fail $ "scalar calls retain dynamic machinery: " ++ T.unpack helper
        putStrLn "TYPED scalar calls use no dynamic arguments or returns"
    (_, collection) <- codeCollectionFromSource False True staticSource
    rendered <- liftIO $ Source.renderContract "TypedStatic" collection
    liftIO $ case rendered of
      Left errors -> fail $ show errors
      Right code -> do
        writeFile "/tmp/strato-typed-builtin-generated.hs" $ T.unpack code
        unless ("addmodValue" `T.isInfixOf` code) $ fail "typed builtin missing from generated source"
        unless (not $ "fromDyn" `T.isInfixOf` code) $ fail "static builtin result uses dynamic decoding"
        forM_ ["integerValue", "decimalValue", "addressValue", "stringValue", "hashValue", "recoverValue", "destroyValue"] $ \helper ->
          unless (not $ helper `T.isInfixOf` code) $ fail $ "static builtin retains runtime type dispatch: " ++ T.unpack helper
        putStrLn "TYPED generated source uses typed bindings"
    (_, missing) <- codeCollectionFromSource False True "contract Missing { function run(bytes value) returns (bytes) { return bls12381DecompressG1(value); } }"
    let contract = (missing ^. CC.contracts) Map.! "Missing"
    liftIO $ unless (isLeft $ Native.compileContractChecked missing contract) $ fail "a missing builtin was enabled"
    liftIO $ putStrLn "TYPED missing builtin remains unavailable"
    (_, invalid) <- codeCollectionFromSource False False "contract InvalidCall { function take(int value) internal returns (int) { return value; } function run() returns (int) { return take(true); } }"
    let invalidContract = (invalid ^. CC.contracts) Map.! "InvalidCall"
    liftIO $ case Native.compileContractChecked invalid invalidContract of
      Left errors -> do
        unless (any (T.isInfixOf "expected int, got bool" . Native.showErr . snd) errors) $ fail $ show errors
        putStrLn "TYPED native compilation rejects mismatched arguments without the frontend typechecker"
      Right _ -> fail "native compilation accepted mismatched arguments"
