{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

-- A/B check through the real transaction and storage runtime, using fresh
-- in-memory chain state. Run in separate processes with SOLIDVM_NATIVE=0/1.
module Main where

import BlockApps.Logging (runLogging)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.SolidVM.Simple hiding (name)
import Blockchain.VMContext (runMemContextM, GasCap (..), ContextState)
import qualified Control.Monad.Change.Modify as Mod
import Blockchain.VMOptions ()
import Blockchain.Strato.Model.Options ()
import Blockchain.Wiring ()
import Control.Lens
import Control.Monad
import Control.Monad.Composable.Base (runEff)
import Control.Monad.IO.Class
import qualified Data.Text as T
import qualified Data.Text.IO as T
import Data.Time.Clock.POSIX (posixSecondsToUTCTime)
import Data.Vector (fromList)
import HFlags
import Prometheus (exportMetricsAsText)
import SolidVM.Model.Value
import System.Environment (lookupEnv)
import UnliftIO (throwIO)

gasSource :: T.Text
gasSource = T.unlines
  [ "contract GasBase { function baseLeaf(uint x) internal returns (uint) { return x; } constructor() {} }"
  , "library GasLib { uint constant C = 3; function plus(uint x, uint y) internal returns (uint) { return x + y; } }"
  , "contract GasProbe is GasBase { using GasLib for uint;"
  , " uint value = 7; uint public publicValue = 11; uint constant C = 7; enum E { A, B } uint[] array; struct Holder { uint[] values; } Holder holder; struct Pair { uint a; uint b; } Pair pair; mapping(uint => uint) map;"
  , " constructor() { array.push(3); holder.values.push(5); pair.a = 8; map[1] = 9; }"
  , " modifier guard() { require(true); _; }"
  , " modifier withArgs(uint a, uint b) { require(a < b); _; }"
  , " function guardedArgs() withArgs(1,2) returns (uint) { return 3; }"
  , " function aliasIndex() returns (uint) { Holder h = holder; return h.values[0]; }"
  , " function aliasIndexWrite() returns (uint) { Holder h = holder; h.values[0] = 9; return h.values[0]; }"
  , " function aliasIncrement() returns (uint) { Pair p = pair; p.a++; return p.a; }"
  , " function storageIncrement() returns (uint) { array[0]++; return array[0]; }"
  , " function libraryConstant() returns (uint) { return GasLib.C; }"
  , " function qualifiedCall() returns (uint) { return GasLib.plus(2,3); }"
  , " function usingCall() returns (uint) { uint x = 2; return x.plus(3); }"
  , " function superCall() returns (uint) { return super.baseLeaf(3); }"
  , " function decimalCompound() returns (decimal) { decimal x = decimal(\"1.25\"); x *= decimal(\"2.00\"); x /= decimal(\"3.00\"); return x; }"
  , " function tupleAssign() returns (uint) { uint a; uint b; (a,b) = (3,4); return a + b; }"
  , " function aliasRebind() returns (uint) { Pair p = pair; p = Pair(3,4); return p.a; }"
  , " function message() returns (address) { return msg.sender; }"
  , " function blockNumber() returns (uint) { return block.number; }"
  , " function constantRead() returns (uint) { return C; }"
  , " function enumRead() returns (uint) { return uint(E.B); }"
  , " function externalCall() returns (uint) { return GasProbe(address(this)).leaf(); }"
  , " function scalarWrite() returns (uint) { value = 9; return value; }"
  , " function memberWrite() returns (uint) { pair.a = 9; return pair.a; }"
  , " function indexWrite() returns (uint) { array[0] = 9; return array[0]; }"
  , " function mappingWrite() returns (uint) { map[1] = 9; return map[1]; }"
  , " function copyStorage() returns (uint) { map[1] = value; return map[1]; }"
  , " function push() returns (uint) { array.push(4); return array.length; }"
  , " function memoryIndexWrite() returns (uint) { uint[] a = [1,2]; a[0] = 9; return a[0]; }"
  , " function aliasWrite() returns (uint) { Pair p = pair; p.a = 9; return p.a; }"
  , " function stringAdd() returns (string) { string a = \"hello\"; return a + \" world\"; }"
  , " function bytesAdd() returns (bytes) { bytes a = hex\"0102\"; return a + hex\"0304\"; }"
  , " function abiEncode() returns (bytes) { return abi.encodePacked(1); }"
  , " function shifts() returns (uint) { uint x = 1; x = x << 260; return x >> 2; }"
  , " function bigMultiply() returns (uint) { uint x = 1; x = x << 260; return x * x; }"
  , " function decimalDivide() returns (decimal) { decimal x = decimal(\"1.25\"); return x / decimal(\"2.00\"); }"
  , " function compare() returns (bool) { uint x = 1; return x > 0 && x < 2; }"
  , " function leaf() returns (uint) { return 4; }"
  , " function literal() returns (uint) { return 3; }"
  , " function local() returns (uint) { uint x = 1; x = 2; return x; }"
  , " function storageRead() returns (uint) { return value; }"
  , " function member() returns (uint) { return pair.a; }"
  , " function index() returns (uint) { return array[0]; }"
  , " function mappingRead() returns (uint) { return map[1]; }"
  , " function callInternal() returns (uint) { return leaf(); }"
  , " function castContract() returns (address) { return address(GasProbe(address(this))); }"
  , " function arithmetic() returns (uint) { uint a = 7; uint b = 3; return (a + b) * a - b; }"
  , " function divide() returns (uint) { uint x = 2; return 20 / x++; }"
  , " function modulo() returns (uint) { uint x = 2; return 20 % x++; }"
  , " function compound() returns (uint) { uint x = 2; x += 3; x *= 4; x /= 2; return x; }"
  , " function decimalMath() returns (decimal) { decimal x = decimal(\"1.25\"); return x * decimal(\"2.00\") + decimal(1); }"
  , " function loop() returns (uint) { uint x = 0; for(uint i = 0; i < 3; i++) { x += i; } return x; }"
  , " function breakLoop() returns (uint) { uint x = 0; for(; x < 3; x++) { break; } return x; }"
  , " function whileLoop() returns (uint) { uint x = 0; while(x < 3) { x++; } return x; }"
  , " function doLoop() returns (uint) { uint x = 0; do { x++; } while(x < 3); return x; }"
  , " function tuple() returns (uint,uint) { return (1,2); }"
  , " function arrayLiteral() returns (uint[]) { uint[] x = [1,2]; return x; }"
  , " function guarded() guard returns (uint) { return 3; }"
  , " function catchGas() { try { while(true) {} } catch {} }"
  , " function catchGasBody() { try { while(true) {} } catch { uint x = 1; } }"
  , "}"
  ]

source :: T.Text
source = T.unlines
  [ "contract ProbeA { int x; function ping() returns (int) { return 42; } }"
  , "contract CN4 { function getName(address a) public returns (string) { return getUserCert(a)[\"commonName\"]; } }"
  , "contract Exploit2 { function attack(address target) public { (bool ok,) = target.delegatecall(hex\"40c10f19\"); } }"
  , "contract NativeLegacyProbe { function failures(address cert, address exploit) public returns (bool) { bool a = false; bool b = false; try { CN4(cert).getName(msg.sender); } catch { a = true; } try { Exploit2(exploit).attack(cert); } catch { b = true; } return a && b; } }"
  , "interface NativeStoreView { function configs(address account) external view returns (uint, bool); }"
  , "contract NativeStore { struct Config { uint minReserve; bool enabled; } mapping(address => Config) public configs; }"
  , "contract NativeProbe {"
  , "  struct Params { uint number; bool enabled; }"
  , "  enum Choice { First, Second }"
  , "  struct Selection { Choice choice; uint number; }"
  , "  function readSelection(Selection memory s) public returns (uint) { require(s.choice == Choice.Second); return s.number; }"
  , "  function readSelections(Selection[] memory values) public returns (uint) { uint total = 0; for (uint i = 0; i < values.length; i++) { total += readSelection(values[i]); } return total; }"
  , "  uint public counter;"
  , "  uint[] public numbers;"
  , "  function setNumbers(uint[] values) public { numbers = values; }"
  , "  event Changed(uint value);"
  , "  constructor() {}"
  , "  function sum(uint n) public returns (uint) {"
  , "    uint s = 0; for (uint i = 0; i < n; i++) { s = s + i; }"
  , "    counter = s; emit Changed(s); return s;"
  , "  }"
  , "  function nested(uint n) public returns (uint) { return NativeProbe(address(this)).sum(n); }"
  , "  function named() public returns (uint result) { result = 17; }"
  , "  function namedPair() public returns (uint a, bool b) { a = 23; b = true; }"
  , "  function namedInternal() public returns (uint) { return named(); }"
  , "  function signedDivision(int a, int b) public returns (int, int) { return (a / b, a % b); }"
  , "  function readParams(Params memory p) public returns (uint) { require(p.enabled); return p.number; }"
  , "  function nestedAt(address impl, uint n) public returns (uint) { return NativeProbe(impl).sum(n); }"
  , "  function defaults(address impl) public returns (uint) {"
  , "    (uint reserve, bool enabled) = NativeStoreView(impl).configs(address(this)); require(!enabled); return reserve;"
  , "  }"
  , "  function structGetter(address impl) public returns (uint) { (uint reserve, bool enabled) = NativeStore(impl).configs(address(this)); require(!enabled); return reserve; }"
  , "  function fail() public { counter = 999; require(false, \"probe\"); }"
  , "  function catchFail() public returns (bool) {"
  , "    try { NativeProbe(address(this)).fail(); } catch { return counter != 999; } return false;"
  , "  }"
  , "}"
  , "contract NativeNamedCaller {"
  , "  enum Choice { First, Second }"
  , "  struct Selection { Choice choice; uint number; }"
  , "  function forward(address proxy) public returns (uint) { Selection memory s = Selection(Choice.Second, 43); return NativeProbe(proxy).readSelection(s); }"
  , "  function forwardArray(address proxy) public returns (uint) { Selection[] memory values = [Selection(Choice.Second, 17), Selection(Choice.Second, 23)]; return NativeProbe(proxy).readSelections(values); }"
  , "}"
  , "contract NativeDelegateProbe {"
  , "  uint public counter;"
  , "  function run(address impl, uint n) public returns (uint) {"
  , "    impl.delegatecall(\"sum\", n); return counter;"
  , "  }"
  , "}"
  , "contract FallbackProbe {"
  , "  decimal unsupported;"
  , "  function ok() public returns (bool) { return true; }"
  , "}"
  , "contract NativeProxy {"
  , "  address public impl; constructor(address target) { impl = target; }"
  , "  fallback(variadic args) external returns (variadic) { return impl.delegatecall(msg.sig, args); }"
  , "}"
  , "contract NativeVotingAdmin {"
  , "  uint public votes;"
  , "  function castVoteOnIssue(address sender, string sig, variadic args) public returns (bool, variadic) { votes++; return (true, args); }"
  , "}"
  , "contract NativeOwnerBase {"
  , "  address public owner; constructor(address account) { owner = account; }"
  , "  modifier onlyOwner() { try { require(owner == msg.sender, string(owner)); _; } catch {"
  , "    address sender = msg.sender; if (owner == this) { sender = this; }"
  , "    (bool executed, variadic ret) = NativeVotingAdmin(owner).castVoteOnIssue(sender, msg.sig, msg.data); return ret;"
  , "  } }"
  , "}"
  , "contract NativeOwnerProbe is NativeOwnerBase, NativeVotingAdmin {"
  , "  uint public counter; uint public post; constructor(address account) NativeOwnerBase(account) {}"
  , "  modifier after() { _; post++; }"
  , "  function setCount(uint value) public onlyOwner { counter = value; }"
  , "  function setAfter(uint value) public after onlyOwner { counter = value; }"
  , "  function internalCall() public returns (uint) { setCount(33); return counter + 1; }"
  , "}"
  , "contract NativeConstructorMutation is NativeCreatedBase { uint public finalValue; constructor(uint n) NativeCreatedBase(n++) { finalValue = n; } }"
  , "contract NativeCreatedBase { uint public seed; constructor(uint initial) { seed = initial; } }"
  , "contract NativeCreated is NativeCreatedBase {"
  , "  uint public value; address public owner;"
  , "  event Created(uint value, address creator);"
  , "  constructor(uint number, address account) NativeCreatedBase(number + 1) { value = number; owner = account; emit Created(number, msg.sender); }"
  , "}"
  , "contract NativeFailingCreated { uint public value; constructor() { value = 99; require(false, \"constructor failed\"); } }"
  , "contract NativeCreationProbe {"
  , "  function deploy(uint number) public returns (bool) { NativeCreated child = new NativeCreated(number, msg.sender); return child.value() == number && child.seed() == number + 1 && child.owner() == msg.sender; }"
  , "  function childArg() internal returns (uint) { NativeCreated child = new NativeCreated(23, msg.sender); return child.value() + 1; }"
  , "  function nestedDeployment() public returns (bool) { NativeCreated child = new NativeCreated(childArg(), msg.sender); return child.value() == 24; }"
  , "  function failureThenDeploy() public returns (bool) { try { new NativeFailingCreated(); } catch { NativeCreated child = new NativeCreated(37, msg.sender); return child.value() == 37; } return false; }"
  , "  function saltedDeployment() public returns (bool) { address expected = this.derive(\"native-salt\", \"NativeCreated\", 19, msg.sender); NativeCreated child = new NativeCreated{salt: \"native-salt\"}(19, msg.sender); return address(child) == expected && child.value() == 19; }"
  , "  function nestedSaltedDeployment() public returns (bool) { NativeCreated child = new NativeCreated{salt: string(childArg())}(childArg(), msg.sender); return child.value() == 24; }"
  , "}"
  , "contract NativeFeatures {"
  , " decimal public ratio; mapping(uint => Pair) public pairs;"
  , " struct Pair { uint a; uint b; }"
  , " uint public copied; mapping(uint => uint) public zeroValues;"
  , " function unsetStorageCopy() public returns (uint) { copied = 42; zeroValues[1] = 0; copied = zeroValues[1]; return copied; }"
  , " function variadicTransaction(uint first, variadic rest) public returns (variadic) { return rest; }"
  , " modifier rawAfter() { _; copied++; }"
  , " function rawScalar() public rawAfter returns (variadic) { variadic value = this.call(\"amount\", false); return value; }"
  , " function rawTypedUint() public returns (uint) { return this.call(\"amount\", false); }"
  , " function innerMetadata(uint value) internal returns (string) { return keccak256(msg.sig, msg.data); }"
  , " function outerMetadata(uint value) public returns (string) { return innerMetadata(value + 1); }"
  , " function rawPair() public returns (variadic) { variadic value = this.call(\"twoValues\"); return value; }"
  , " function twoValues() public returns (uint, bool) { return (19, true); }"
  , " function rawInternal() public returns (variadic) { return rawPair(); }"
  , " function rawExternal() public returns (variadic) { return NativeFeatures(this).rawPair(); }"
  , " function rawVariadic() public returns (variadic) { variadic value = this.call(\"variadicTransaction\", 2, 3, 5); return value; }"
  , " function tupleCarrier() public returns (bool, variadic) { variadic value = this.call(\"twoValues\"); return (true, value); }"
  , " function tupleReceive() public returns (variadic) { (bool ok, variadic value) = NativeFeatures(this).tupleCarrier(); require(ok); return value; }"
  , " function increments() public returns (uint, uint, uint, uint) { uint value = 1; uint a = value++; uint b = ++value; uint c = value--; uint d = --value; return (a, b, c, d); }"
  , " function requestNumber() public returns (uint) { copied = 1; uint requestId = copied++; zeroValues[requestId] = 17; return requestId; }"
  , " function decimalMath() public returns (decimal) { ratio = decimal(\"1.25\"); ratio *= decimal(\"2.00\"); ratio /= decimal(\"3.00\"); return ratio + decimal(1); }"
  , " function hashes() public returns (string) { return keccak256(\"abc\", uint(7), address(0xabc)); }"
  , " function hexString() public returns (string) { return string(255, 16, 2); }"
  , " function castAddress() public returns (address) { return address(\"0xabc\"); }"
  , " function tupleStruct() public returns (uint) { Pair p = Pair(13, 17); return p.a + p.b; }"
  , " function storageAlias() public returns (uint) { pairs[1] = Pair(13, 17); Pair p = pairs[1]; p.a = 41; return pairs[1].a; }"
  , " function rebindAlias() public returns (bool) { Pair p = pairs[1]; p = Pair(3, 5); return pairs[1].a == 41 && p.a == 3; }"
  , " function amount(bool fails) public returns (uint) { require(!fails, \"failure\"); return 43; }"
  , " function typedTry(bool fails) public returns (uint) { try NativeFeatures(this).amount(fails) returns (uint result) { return result; } catch { return 47; } }"
  , "}"
  , "contract NativeEventBase { event ParentEvent(uint value); function hook() internal virtual returns (uint) { return 3; } function parentCall() internal returns (uint) { uint value = hook(); emit ParentEvent(value); return value; } function parentMetadata(uint value) internal returns (string) { return keccak256(msg.sig, msg.data); } }"
  , "contract NativeEventDerived is NativeEventBase { function hook() internal override returns (uint) { return 5; } function runParent() public returns (uint) { return super.parentCall(); } function runMetadata(uint value) public returns (string) { return super.parentMetadata(value + 1); } }"
  , "contract NativeVaultAsset { mapping(address => uint) public balanceOf; constructor() { balanceOf[address(0xabc)] = 1000; } function transfer(address to, uint amount) public returns (bool) { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; } function transferFrom(address from, address to, uint amount) public returns (bool) { balanceOf[from] -= amount; balanceOf[to] += amount; return true; } }"
  ]

check :: ExecResults -> IO ()
check result = case erException result of
  Just e -> throwIO $ userError $ show e
  Nothing -> pure ()

main :: IO ()
main = do
  void $ $initHFlags "native integration correctness and timing check"
  strictProbe <- lookupEnv "SOLIDVM_NATIVE_STRICT_PROBE"
  when (strictProbe == Just "1") $ void $ runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $ do
    result <- create $ def & createNewAddress .~ 0x1000 & createContractName .~ "NativeUnsupported" & createCode .~ Code "contract NativeUnsupported { function probe() public returns (string) { return sha256(\"x\"); } }"
    liftIO $ check result
  gasCheck <- (== Just "1") <$> lookupEnv "SOLIDVM_NATIVE_GAS_CHECK"
  when gasCheck $ void $ runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $ do
    emptyContext <- Mod.get (Mod.Proxy :: Mod.Proxy ContextState)
    forM_ [0..1100] $ \limit -> do
      Mod.put (Mod.Proxy :: Mod.Proxy ContextState) emptyContext
      Mod.put (Mod.Proxy :: Mod.Proxy GasCap) (GasCap (Gas limit))
      result <- create $ def & createNewAddress .~ 0x2100 & createContractName .~ "GasProbe" & createCode .~ Code gasSource
      liftIO $ putStrLn $ "GAS constructor " ++ show limit ++ " " ++ show (erException result, erReturnVal result)
    Mod.put (Mod.Proxy :: Mod.Proxy ContextState) emptyContext
    Mod.put (Mod.Proxy :: Mod.Proxy GasCap) (GasCap (Gas 100000000))
    deployment <- create $ def & createNewAddress .~ 0x2100 & createContractName .~ "GasProbe" & createCode .~ Code gasSource
    liftIO $ check deployment
    savedContext <- Mod.get (Mod.Proxy :: Mod.Proxy ContextState)
    forM_ ["aliasIndex", "aliasIndexWrite", "aliasIncrement", "storageIncrement", "guardedArgs", "libraryConstant", "qualifiedCall", "usingCall", "superCall", "decimalCompound", "tupleAssign", "aliasRebind", "message", "blockNumber", "constantRead", "enumRead", "externalCall", "scalarWrite", "memberWrite", "indexWrite", "mappingWrite", "copyStorage", "push", "memoryIndexWrite", "aliasWrite", "stringAdd", "bytesAdd", "abiEncode", "shifts", "bigMultiply", "decimalDivide", "compare", "literal", "local", "storageRead", "member", "index", "mappingRead", "callInternal", "castContract", "arithmetic", "divide", "modulo", "compound", "decimalMath", "loop", "breakLoop", "whileLoop", "doLoop", "tuple", "arrayLiteral", "guarded", "catchGas", "catchGasBody"] $ \fn ->
      forM_ [0..1100] $ \limit -> do
        Mod.put (Mod.Proxy :: Mod.Proxy ContextState) savedContext
        Mod.put (Mod.Proxy :: Mod.Proxy GasCap) (GasCap (Gas limit))
        result <- call $ def & callCodeAddress .~ 0x2100 & callFuncName .~ fn
        liftIO $ putStrLn $ "GAS " ++ T.unpack fn ++ " " ++ show limit ++ " " ++ show (erException result, erReturnVal result)
    Mod.put (Mod.Proxy :: Mod.Proxy ContextState) savedContext
  oracleSource <- traverse T.readFile =<< lookupEnv "SOLIDVM_ORACLE_SOURCE"
  genesisSource <- traverse T.readFile =<< lookupEnv "SOLIDVM_GENESIS_SOURCE"
  stableSource <- traverse T.readFile =<< lookupEnv "SOLIDVM_STABLE_SOURCE"
  poolSource <- traverse T.readFile =<< lookupEnv "SOLIDVM_POOL_SOURCE"
  selfDestructSource <- traverse T.readFile =<< lookupEnv "SOLIDVM_SELFDESTRUCT_SOURCE"
  vaultSource <- traverse T.readFile =<< lookupEnv "SOLIDVM_VAULT_SOURCE"
  rewardsSource <- traverse T.readFile =<< lookupEnv "SOLIDVM_REWARDS_SOURCE"
  void $ runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $ do
    forM_ [(0x2000, "NativeProbe"), (0x2001, "NativeDelegateProbe"), (0x2002, "FallbackProbe"), (0x2003, "NativeStore"), (0x2004, "NativeProxy"), (0x2005, "NativeNamedCaller"), (0x2006, "CN4"), (0x2007, "Exploit2"), (0x2008, "NativeLegacyProbe")] $ \(addr, name) -> do
      let ctorArgs = if name == "NativeProxy" then ["0x0000000000000000000000000000000000002000"] else []
      result <- create $ def & createNewAddress .~ addr & createContractName .~ name & createCode .~ Code source & createArgs . argsArgs .~ ctorArgs
      liftIO $ check result
    noConstructor <- create $ def & createNewAddress .~ 0x2009 & createContractName .~ "ProbeA" & createCode .~ Code source & createArgs . argsArgs .~ ["0"]
    liftIO $ check noConstructor
    let invokeAt timestamp caller addr name args = do
          result <- call $ def & callCodeAddress .~ addr & callFuncName .~ name & callArgs . argsArgs .~ args & callArgs . argsSender .~ caller & callArgs . argsOrigin .~ caller
            & callArgs . argsBlockData %~ (\header -> header {BlockHeader.timestamp = posixSecondsToUTCTime timestamp})
          liftIO $ check result
          pure result
        invokeAs = invokeAt 1
        invoke = invokeAs 0
        observe name expected result = do
          unless (show (erReturnVal result) == show (expected :: Maybe Value)) $ liftIO $ throwIO $ userError $ "unexpected return from " ++ T.unpack name ++ ": " ++ show (erReturnVal result)
          liftIO $ putStrLn $ "CHECK " ++ T.unpack name ++ " " ++ show (erReturnVal result, erEvents result, erAction result)
        expect addr name args value = do
          result <- invoke addr name args
          observe name (Just value) result
    expect 0x2000 "sum" ["10"] (SInteger 45)
    expect 0x2000 "nested" ["10"] (SInteger 45)
    expect 0x2000 "named" [] (SInteger 17)
    expect 0x2000 "namedPair" [] (STuple $ fromList [Constant $ SInteger 23, Constant $ SBool True])
    expect 0x2000 "namedInternal" [] (SInteger 17)
    invoke 0x2000 "setNumbers" ["[3,4,5]"] >>= observe "setNumbers" Nothing
    invoke 0x2000 "setNumbers" ["[7]"] >>= observe "shrinkNumbers" Nothing
    expect 0x2000 "numbers" ["0"] (SInteger 7)
    forM_ [("-7", "3", -3, -1), ("-7", "-3", 2, -1), ("7", "-3", -3, 1)] $ \(a, b, quotient, remainder) ->
      expect 0x2000 "signedDivision" [a, b] (STuple $ fromList [Constant $ SInteger quotient, Constant $ SInteger remainder])
    expect 0x2009 "ping" [] (SInteger 42)
    expect 0x2008 "failures" ["0x2006", "0x2007"] (SBool True)
    expect 0x2000 "readParams" ["{number:31,enabled:true}"] (SInteger 31)
    expect 0x2004 "readParams" ["{number:31,enabled:true}"] (SInteger 31)
    expect 0x2005 "forward" ["0x2004"] (SInteger 43)
    expect 0x2005 "forwardArray" ["0x2004"] (SInteger 40)
    expect 0x2000 "defaults" ["0x0000000000000000000000000000000000002003"] (SInteger 0)
    expect 0x2000 "structGetter" ["0x0000000000000000000000000000000000002003"] (SInteger 0)
    expect 0x2000 "nestedAt" ["0x0000000000000000000000000000000000002004", "10"] (SInteger 45)
    expect 0x2000 "catchFail" [] (SBool True)
    expect 0x2000 "counter" [] (SInteger 45)
    expect 0x2001 "run" ["0x0000000000000000000000000000000000002000", "10"] (SInteger 45)
    expect 0x2002 "ok" [] (SBool True)
    forM_ [(0x2100, "NativeVotingAdmin", []), (0x2101, "NativeOwnerProbe", ["0x2100"]), (0x2102, "NativeOwnerProbe", ["0x2102"])] $ \(addr, name, args) -> do
      result <- create $ def & createNewAddress .~ addr & createContractName .~ name & createCode .~ Code source & createArgs . argsArgs .~ args
      liftIO $ check result
    expect 0x2101 "setCount" ["77"] (SVariadic [SInteger 77])
    expect 0x2101 "counter" [] (SInteger 0)
    expect 0x2101 "setAfter" ["88"] (SVariadic [SInteger 88])
    expect 0x2101 "post" [] (SInteger 1)
    expect 0x2101 "internalCall" [] (SInteger 1)
    expect 0x2100 "votes" [] (SInteger 3)
    expect 0x2102 "setCount" ["99"] (SVariadic [SInteger 99])
    expect 0x2102 "votes" [] (SInteger 1)
    invokeAs 0x2100 0x2101 "setCount" ["42"] >>= observe "ownerSetCount" Nothing
    expect 0x2101 "counter" [] (SInteger 42)
    forM_ [(0x2600, "NativeCreationProbe", []), (0x2601, "NativeProxy", ["0x2600"])] $ \(addr, name, args) -> do
      result <- create $ def & createNewAddress .~ addr & createContractName .~ name & createCode .~ Code source & createArgs . argsArgs .~ args
      liftIO $ check result
    forM_ [0x2600, 0x2601] $ \addr -> do
      expect addr "deploy" ["19"] (SBool True)
      expect addr "nestedDeployment" [] (SBool True)
      expect addr "failureThenDeploy" [] (SBool True)
      expect addr "saltedDeployment" [] (SBool True)
      expect addr "nestedSaltedDeployment" [] (SBool True)
    mutation <- create $ def & createNewAddress .~ 0x2700 & createContractName .~ "NativeConstructorMutation" & createCode .~ Code source & createArgs . argsArgs .~ ["7"]
    liftIO $ check mutation
    expect 0x2700 "seed" [] (SInteger 7)
    expect 0x2700 "finalValue" [] (SInteger 8)
    featureDeployment <- create $ def & createNewAddress .~ 0x2800 & createContractName .~ "NativeFeatures" & createCode .~ Code source
    liftIO $ check featureDeployment
    parentDeployment <- create $ def & createNewAddress .~ 0x2b00 & createContractName .~ "NativeEventDerived" & createCode .~ Code source
    liftIO $ check parentDeployment
    expect 0x2b00 "runParent" [] (SInteger 3)
    forM_ [(0x2800, "outerMetadata"), (0x2b00, "runMetadata")] $ \(addr, name) -> do
      metadata <- invoke addr name ["9"]
      observe name (erReturnVal metadata) metadata
    expect 0x2800 "decimalMath" [] (SDecimal 1.83)
    expect 0x2800 "ratio" [] (SDecimal 0.83)
    expect 0x2800 "hexString" [] (SString "0x00ff")
    expect 0x2800 "castAddress" [] (SAddress 0xabc False)
    expect 0x2800 "tupleStruct" [] (SInteger 30)
    expect 0x2800 "storageAlias" [] (SInteger 41)
    expect 0x2800 "unsetStorageCopy" [] (SInteger 42)
    expect 0x2800 "variadicTransaction" ["2", "3", "5"] (SVariadic [SInteger 3, SInteger 5])
    expect 0x2800 "rawScalar" [] (SInteger 43)
    expect 0x2800 "rawTypedUint" [] (SInteger 43)
    expect 0x2800 "rawPair" [] (STuple $ fromList [Constant $ SInteger 19, Constant $ SBool True])
    expect 0x2800 "rawInternal" [] (STuple $ fromList [Constant $ SInteger 19, Constant $ SBool True])
    expect 0x2800 "rawExternal" [] (STuple $ fromList [Constant $ SInteger 19, Constant $ SBool True])
    expect 0x2800 "rawVariadic" [] (SVariadic [SInteger 3, SInteger 5])
    expect 0x2800 "tupleReceive" [] (STuple $ fromList [Constant $ SInteger 19, Constant $ SBool True])
    expect 0x2800 "increments" [] (STuple $ fromList [Constant $ SInteger 1, Constant $ SInteger 3, Constant $ SInteger 3, Constant $ SInteger 1])
    expect 0x2800 "requestNumber" [] (SInteger 1)
    expect 0x2800 "rebindAlias" [] (SBool True)
    expect 0x2800 "typedTry" ["false"] (SInteger 43)
    expect 0x2800 "typedTry" ["true"] (SInteger 47)
    hashed <- invoke 0x2800 "hashes" []
    case erReturnVal hashed of
      Just value@(SString hashValue) | length hashValue == 64 -> observe "hashes" (Just value) hashed
      _ -> liftIO $ throwIO $ userError "unexpected multi-value hash"
    forM_ oracleSource $ \code -> do
      result <- create $ def & createNewAddress .~ 0x2200 & createContractName .~ "PriceOracle" & createCode .~ Code code & createArgs . argsArgs .~ ["0xabc"]
      liftIO $ check result
      let oracleCall name args = invokeAs 0xabc 0x2200 name args >>= observe name Nothing
          oracleExpect name args value = invokeAs 0xabc 0x2200 name args >>= observe name (Just value)
      oracleCall "initialize" []
      forM_ [100, 200, 300, 400, 500, 600 :: Integer] $ \price -> oracleCall "setAssetPrice" ["0x3001", T.pack (show price)]
      oracleExpect "getAssetPrice" ["0x3001"] (SInteger 600)
      oracleExpect "getAssetPriceTwap" ["0x3001"] (SInteger 400)
      oracleCall "setTwapQueueSize" ["1"]
      oracleCall "setAssetPrice" ["0x3001", "700"]
      oracleExpect "getAssetPriceTwap" ["0x3001"] (SInteger 600)
      oracleCall "setTwapQueueSize" ["3"]
      forM_ [800, 900, 1000 :: Integer] $ \price -> oracleCall "setAssetPrice" ["0x3001", T.pack (show price)]
      oracleExpect "getAssetPriceTwap" ["0x3001"] (SInteger 700)
      oracleCall "setAssetPrices" ["[0x3001,0x3002]", "[1100,2200]"]
      oracleExpect "getAssetPrice" ["0x3002"] (SInteger 2200)
      oracleExpect "isPriceFresh" ["0x3001", "0"] (SBool True)
      forM_ [(10, 100), (20, 200), (40, 400)] $ \(timestamp, price) ->
        invokeAt timestamp 0xabc 0x2200 "setAssetPrice" ["0x3003", T.pack (show (price :: Integer))] >>= observe "timedPrice" Nothing
      let timedExpect name args value = invokeAt 60 0xabc 0x2200 name args >>= observe name (Just value)
          pair a b = STuple $ fromList [Constant $ SInteger a, Constant $ SInteger b]
      timedExpect "getAssetPriceTwap" ["0x3003"] (SInteger 260)
      timedExpect "getAssetPriceTwapWithTimestamp" ["0x3003"] (pair 260 40)
      timedExpect "getAssetPriceWithTimestamp" ["0x3003"] (pair 400 40)
      timedExpect "isPriceFresh" ["0x3003", "19"] (SBool False)
      timedExpect "isPriceFresh" ["0x3003", "20"] (SBool True)
    forM_ genesisSource $ \code -> do
      forM_ [(0x2400, "AdminRegistry", []), (0x2401, "PriceOracle", ["0x2400"]), (0x2402, "Proxy", ["0x2401", "0x2400"]), (0x2403, "Proxy", ["0x2400", "0x2403"])] $ \(addr, name, args) -> do
        result <- create $ def & createNewAddress .~ addr & createContractName .~ name & createCode .~ Code code & createArgs . argsArgs .~ args
        liftIO $ check result
      invokeAs 0xabc 0x2400 "initialize" ["[0xabc]"] >>= observe "adminInitialize" Nothing
      invokeAs 0xabc 0x2400 "addWhitelist" ["0x2402", "\"setAssetPrices\"", "0xdef"] >>= observe "oracleWhitelist" Nothing
      invokeAs 0xdef 0x2402 "setAssetPrices" ["[0x3001,0x3002]", "[1100,2200]"] >>= observe "governedPrices" Nothing
      invokeAs 0xdef 0x2402 "getAssetPrice" ["0x3002"] >>= observe "governedPrice" (Just $ SInteger 2200)
      invokeAs 0xabc 0x2403 "initialize" ["[0xabc]"] >>= observe "selfAdminInitialize" Nothing
      invokeAs 0xabc 0x2403 "setLogicContract" ["0x2400"] >>= observe "selfAdminUpgrade" Nothing
      let createdSource = "contract NativeBuiltinCreated { address public owner; uint public value; constructor(address account, uint number) { owner = account; value = number; } }" :: String
      created <- invokeAs 0xabc 0x2400 "createContract" ["\"NativeBuiltinCreated\"", T.pack (show createdSource), "0xabc", "7"]
      case erReturnVal created of
        Just returned -> do
          observe "governedCreate" (Just returned) created
          let addressValue (SAddress address _) = Just address
              addressValue (SVariadic [value]) = addressValue value
              addressValue _ = Nothing
          case addressValue returned of
            Just address -> do
              expect address "owner" [] (SAddress 0xabc False)
              expect address "value" [] (SInteger 7)
            Nothing -> liftIO $ throwIO $ userError "unexpected create return"
        Nothing -> liftIO $ throwIO $ userError "create returned no address"
      salted <- invokeAs 0xabc 0x2400 "createSaltedContract" ["\"native-builtin-salt\"", "\"NativeBuiltinCreated\"", T.pack (show createdSource), "0xabc", "11"]
      case erReturnVal salted of
        Just value@(SAddress address _) -> do
          observe "governedSaltedCreate" (Just value) salted
          expect address "owner" [] (SAddress 0xabc False)
          expect address "value" [] (SInteger 11)
        _ -> liftIO $ throwIO $ userError "unexpected salted create return"
    forM_ stableSource $ \code -> do
      result <- create $ def & createNewAddress .~ 0x2900 & createContractName .~ "StablePool" & createCode .~ Code code & createArgs . argsArgs .~ ["0xabc"]
      liftIO $ check result
      invokeAs 0xabc 0x2900 "initialize" ["100", "30000000", "10000000000", "1", "[0x3001,0x3002]", "[1000000000000000000,1000000000000000000]", "[1,1]", "[0,0]", "0x3003"] >>= observe "stableInitialize" Nothing
      invokeAs 0xabc 0x2900 "updateRateOracles" ["0x3ea", "0x3ea"] >>= observe "stableRateOracles" Nothing
    forM_ poolSource $ \code -> do
      result <- create $ def & createNewAddress .~ 0x2a00 & createContractName .~ "Pool" & createCode .~ Code code & createArgs . argsArgs .~ ["0xabc"]
      liftIO $ check result
      forM_ [("1000000000000000000", "3000000000000000000"), ("1327143761983746592", "9898765433120399911"), ("0", "0")] $ \(a, b) ->
        invokeAs 0xabc 0x2a00 "probeRatios" [a, b] >>= observe "poolRatios" Nothing
    forM_ selfDestructSource $ \code -> do
      result <- create $ def & createNewAddress .~ 0x2c00 & createContractName .~ "SelfDestructTest" & createCode .~ Code code
      liftIO $ check result
      invoke 0x2c00 "destroy" [] >>= observe "selfDestruct" Nothing
    forM_ vaultSource $ \code -> do
      asset <- create $ def & createNewAddress .~ 0x2d01 & createContractName .~ "NativeVaultAsset" & createCode .~ Code source
      liftIO $ check asset
      vault <- create $ def & createNewAddress .~ 0x2d00 & createContractName .~ "YieldVault" & createCode .~ Code code & createArgs . argsArgs .~ ["0xabc"]
      liftIO $ check vault
      invokeAs 0xabc 0x2d00 "initialize" ["0x2d01", "\"Native Vault\"", "\"NVT\""] >>= observe "vaultInitialize" Nothing
      invokeAs 0xabc 0x2d00 "deposit" ["100", "0xabc"] >>= observe "vaultDeposit" (Just $ SInteger 100)
      invokeAs 0xabc 0x2d00 "setStrategyApproval" ["0xabc", "true"] >>= observe "vaultStrategy" Nothing
      invokeAs 0xabc 0x2d00 "deployCapital" ["0xabc", "50"] >>= observe "vaultDeploy" Nothing
      invokeAs 0xabc 0x2d00 "redeemOrQueue" ["80", "0xabc", "0xabc"] >>= observe "vaultQueue" (Just $ STuple $ fromList [Constant $ SInteger 0, Constant $ SInteger 1])
      expect 0x2d00 "nextRequestId" [] (SInteger 2)
    forM_ rewardsSource $ \code -> do
      forM_ [(0x2e00, "AdminRegistry", []), (0x2e01, "Rewards", ["0x2e00"])] $ \(addr, name, args) -> do
        result <- create $ def & createNewAddress .~ addr & createContractName .~ name & createCode .~ Code code & createArgs . argsArgs .~ args
        liftIO $ check result
      invokeAs 0xabc 0x2e00 "initialize" ["[0xabc,0xdef,0xeee]"] >>= observe "rewardsAdmins" Nothing
      voted <- invokeAs 0xabc 0x2e01 "setPositionActivityEvents" ["27", "[{actionType:0,eventName:\"Deposit\"},{actionType:1,eventName:\"Withdraw\"},{actionType:1,eventName:\"QueueProcessed\"}]"]
      observe "rewardsEventVote" (erReturnVal voted) voted
      rewards <- create $ def & createNewAddress .~ 0x2e02 & createContractName .~ "Rewards" & createCode .~ Code code & createArgs . argsArgs .~ ["0xabc"]
      liftIO $ check rewards
      invokeAs 0xabc 0x2e02 "initialize" ["0x3000"] >>= observe "rewardsInitialize" Nothing
      activity <- invokeAs 0xabc 0x2e02 "addPositionActivity" ["\"Native activity\"", "0", "0x4000", "[{actionType:0,eventName:\"Deposit\"},{actionType:1,eventName:\"Withdraw\"}]"]
      observe "rewardsNumericEvents" (Just $ SInteger 1) activity
      invokeAs 0xabc 0x2e02 "addPositionActivitySimple" ["\"Named enum activity\"", "0", "0x4001", "\"Deposit\"", "\"Withdraw\""] >>= observe "rewardsNamedEvents" (Just $ SInteger 2)
  metrics <- exportMetricsAsText
  print metrics
