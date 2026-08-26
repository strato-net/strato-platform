{-# LANGUAGE OverloadedStrings #-}

module FastUIntIRSpec where

import Blockchain.SolidVM.CodeCollectionDB (compileSourceWithAnnotationsWithoutImports)
import Blockchain.SolidVM.FastUIntIR (StorageHooks (..), funcFallbackCount, funcLowers, runAnyStorageIR, runAnyUIntIR)
import Control.Lens ((^.))
import Data.IORef (modifyIORef', newIORef, readIORef)
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString (stringToLabel)
import Test.Hspec

compileCC :: T.Text -> T.Text -> CC.CodeCollection
compileCC name source =
  case compileSourceWithAnnotationsWithoutImports True True (M.singleton name source) of
    Left err -> error ("compile failed: " ++ show err)
    Right cc -> cc

irRun :: T.Text -> String -> String -> [Integer] -> Maybe ([Integer], Integer)
irRun source cname fname args =
  let cc = compileCC "bench.sol" source
      contract =
        M.findWithDefault
          (error $ "missing " ++ cname)
          (stringToLabel cname)
          (cc ^. CC.contracts)
      func =
        M.findWithDefault
          (error $ "missing " ++ fname)
          (stringToLabel fname)
          (contract ^. CC.functions)
   in runAnyUIntIR cc contract func args

irCost :: Int -> Integer
irCost n =
  case irRun (loopSource n) "LoopGas" "it_loop" [] of
    Just (_, cost) -> cost
    Nothing -> error "IR miss"

mustHit :: T.Text -> String -> String -> [Integer] -> [Integer]
mustHit source cname fname args =
  case irRun source cname fname args of
    Just (values, _) -> values
    Nothing -> error $ "IR miss on " ++ cname ++ "." ++ fname

loopSource :: Int -> T.Text
loopSource n =
  T.unlines
    [ "contract LoopGas {",
      "    function it_loop() {",
      "        uint digest = 0;",
      "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
      "            digest = digest + i;",
      "        }",
      "        if (1 > 0) require(digest >= 0);",
      "    }",
      "}"
    ]

-- Flattened exact-input / target-not-reached kernel from svm_swap_math_flat_template.sol.
flatComputeBody :: [T.Text]
flatComputeBody =
  [ "        bool zeroForOne = current >= target;",
    "        uint lessFee = (amountRemaining * (1000000 - feePips)) / 1000000;",
    "        uint numerator1 = liquidity << 96;",
    "        uint q = 79228162514264337593543950336;",
    "        if (zeroForOne) {",
    "            uint first = (numerator1 * (current - target) + current - 1) / current;",
    "            uint targetAmountIn = (first + target - 1) / target;",
    "            require(lessFee < targetAmountIn, \"flat path reached target\");",
    "            uint denominator = numerator1 + lessFee * current;",
    "            next = (numerator1 * current + denominator - 1) / denominator;",
    "            first = (numerator1 * (current - next) + current - 1) / current;",
    "            amountIn = (first + next - 1) / next;",
    "            amountOut = (liquidity * (current - next)) / q;",
    "        } else {",
    "            uint targetAmountIn = (liquidity * (target - current) + q - 1) / q;",
    "            require(lessFee < targetAmountIn, \"flat path reached target\");",
    "            next = current + ((lessFee << 96) / liquidity);",
    "            amountIn = (liquidity * (next - current) + q - 1) / q;",
    "            amountOut = ((numerator1 * (next - current)) / next) / current;",
    "        }",
    "        feeAmount = amountRemaining - amountIn;"
  ]

libraryAndCompute :: T.Text
libraryAndCompute =
  T.unlines $
    [ "library FlatSwapMath {",
      "    function compute(",
      "        uint current,",
      "        uint target,",
      "        uint liquidity,",
      "        uint amountRemaining,",
      "        uint feePips",
      "    ) internal pure returns (uint next, uint amountIn, uint amountOut, uint feeAmount) {"
    ]
      ++ flatComputeBody
      ++ [ "    }",
           "}"
         ]

predeclaredLoop :: Int -> T.Text
predeclaredLoop n =
  libraryAndCompute
    <> T.unlines
      [ "contract Describe_FlatSwapMathBench {",
        "    uint constant Q96 = 79228162514264337593543950336;",
        "    uint constant MIN_SQRT = 4295128740;",
        "    uint constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;",
        "    uint constant LIQUIDITY = 2000000000000000000000;",
        "    function it_compute_flat_swap_step_loop() {",
        "        uint current = Q96 + (" <> T.pack (show n) <> " % 1000);",
        "        uint digest = 0;",
        "        uint next = 0;",
        "        uint amountIn = 0;",
        "        uint amountOut = 0;",
        "        uint feeAmount = 0;",
        "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
        "            bool zeroForOne = i % 2 == 0;",
        "            uint target = zeroForOne ? MIN_SQRT : MAX_SQRT;",
        "            (next, amountIn, amountOut, feeAmount) = FlatSwapMath.compute(",
        "                current, target, LIQUIDITY, 1000000000000000 + (i % 1000), 500",
        "            );",
        "            current = next;",
        "            digest = digest + amountIn + amountOut + feeAmount;",
        "        }",
        "        if (" <> T.pack (show n) <> " > 0) require(digest > 0, \"empty result\");",
        "    }",
        "}"
      ]

declaredLoop :: Int -> T.Text
declaredLoop n =
  libraryAndCompute
    <> T.unlines
      [ "contract Describe_FlatSwapMathBench {",
        "    uint constant Q96 = 79228162514264337593543950336;",
        "    uint constant MIN_SQRT = 4295128740;",
        "    uint constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;",
        "    uint constant LIQUIDITY = 2000000000000000000000;",
        "    function it_compute_flat_swap_step_loop() {",
        "        uint current = Q96 + (" <> T.pack (show n) <> " % 1000);",
        "        uint digest = 0;",
        "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
        "            bool zeroForOne = i % 2 == 0;",
        "            uint target = zeroForOne ? MIN_SQRT : MAX_SQRT;",
        "            (uint next, uint amountIn, uint amountOut, uint feeAmount) = FlatSwapMath.compute(",
        "                current, target, LIQUIDITY, 1000000000000000 + (i % 1000), 500",
        "            );",
        "            current = next;",
        "            digest = digest + amountIn + amountOut + feeAmount;",
        "        }",
        "        if (" <> T.pack (show n) <> " > 0) require(digest > 0, \"empty result\");",
        "    }",
        "}"
      ]

assertMatchesLoop :: Int -> T.Text
assertMatchesLoop n =
  libraryAndCompute
    <> T.unlines
      [ "contract Describe_FlatSwapMathBench {",
        "    uint constant Q96 = 79228162514264337593543950336;",
        "    uint constant MIN_SQRT = 4295128740;",
        "    uint constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;",
        "    uint constant LIQUIDITY = 2000000000000000000000;",
        "    function assertMatches(uint current, uint target, uint amount) internal {",
        "        (uint n2, uint i2, uint o2, uint f2) = FlatSwapMath.compute(",
        "            current, target, LIQUIDITY, amount, 500",
        "        );",
        "        require(n2 > 0 && i2 > 0 && o2 >= 0 && f2 >= 0, \"flat result mismatch\");",
        "    }",
        "    function it_compute_flat_swap_step_loop() {",
        "        assertMatches(Q96 + (" <> T.pack (show n) <> " % 1000), MIN_SQRT, 1000000000000000);",
        "        uint current = Q96 + (" <> T.pack (show n) <> " % 1000);",
        "        uint digest = 0;",
        "        uint next = 0;",
        "        uint amountIn = 0;",
        "        uint amountOut = 0;",
        "        uint feeAmount = 0;",
        "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
        "            bool zeroForOne = i % 2 == 0;",
        "            uint target = zeroForOne ? MIN_SQRT : MAX_SQRT;",
        "            (next, amountIn, amountOut, feeAmount) = FlatSwapMath.compute(",
        "                current, target, LIQUIDITY, 1000000000000000 + (i % 1000), 500",
        "            );",
        "            current = next;",
        "            digest = digest + amountIn + amountOut + feeAmount;",
        "        }",
        "        if (" <> T.pack (show n) <> " > 0) require(digest > 0, \"empty result\");",
        "    }",
        "}"
      ]

storeLoopSource :: Int -> T.Text
storeLoopSource n =
  T.unlines
    [ "contract Store {",
      "    mapping(address => uint256) private slots;",
      "    event Wrote(address indexed who, uint256 value);",
      "    function it_loop() {",
      "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
      "            address a = msg.sender;",
      "            slots[a] = slots[a] + 1;",
      "            emit Wrote(a, slots[a]);",
      "        }",
      "    }",
      "}"
    ]

storeSender, storeThis :: Integer
storeSender = 0xabc
storeThis = 0xdef

runStoreLoop :: Int -> IO (Integer, Integer, Int)
runStoreLoop n = do
  store <- newIORef (M.empty :: M.Map (Integer, String, Integer) Integer)
  evs <- newIORef ([] :: [(String, [Integer])])
  let cc = compileCC "store.sol" (storeLoopSource n)
      contract = M.findWithDefault (error "missing Store") (stringToLabel "Store") (cc ^. CC.contracts)
      func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      readStore addr name key = M.findWithDefault 0 (addr, name, key) <$> readIORef store
      writeStore addr name key val = modifyIORef' store (M.insert (addr, name, key) val)
      hooks =
        StorageHooks
          { shSender = pure storeSender,
            shThis = pure storeThis,
            shTimestamp = pure 1000000,
            shNumber = pure 1,
            shMapGet = \name key _ -> readStore storeThis name key,
            shMapSet = \name key val _ -> writeStore storeThis name key val,
            shMapGetAt = \addr name key _ -> readStore addr name key,
            shMapSetAt = \addr name key val _ -> writeStore addr name key val,
            shMapGet2At = \_ _ _ _ _ _ -> pure 0,
            shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
            shSloadAddr = \_ -> pure 0,
            shSloadAt = \_ _ -> pure 0,
            shSstore = \_ _ -> pure (),
            shSstoreAt = \_ _ _ -> pure (),
            shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
            shEmitMany = \ps -> modifyIORef' evs (ps ++)
          }
  result <- runAnyStorageIR hooks cc contract func []
  case result of
    Nothing -> error "storage IR miss on Store.it_loop"
    Just (_, cost) -> do
      m <- readIORef store
      logged <- readIORef evs
      let val = M.findWithDefault 0 (storeThis, "slots", storeSender) m
      pure (cost, val, length logged)

storageLoopCost :: Int -> IO Integer
storageLoopCost n = do
  (cost, _, _) <- runStoreLoop n
  pure cost

storageLoopResult :: Int -> IO (Integer, Int)
storageLoopResult n = do
  (_, val, nEvents) <- runStoreLoop n
  pure (val, nEvents)

boxLoopSource :: Int -> T.Text
boxLoopSource n =
  T.unlines
    [ "contract BaseBox {",
      "    mapping(address => uint256) private slots;",
      "    event Wrote(address indexed who, uint256 value);",
      "    function write(address a, uint256 v) public virtual returns (bool) {",
      "        address from = msg.sender;",
      "        slots[a] = slots[a] + v;",
      "        emit Wrote(from, v);",
      "        return true;",
      "    }",
      "}",
      "contract Box is BaseBox {",
      "    bool private locked;",
      "    modifier whenOpen() {",
      "        if (locked) {",
      "            require(!locked, \"locked\");",
      "        }",
      "        _;",
      "    }",
      "    function write(address a, uint256 v) public override whenOpen returns (bool) {",
      "        return super.write(a, v);",
      "    }",
      "    function it_loop() {",
      "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
      "            write(msg.sender, 1);",
      "        }",
      "    }",
      "}"
    ]

runBoxLoop :: Int -> IO (Integer, Integer, Int)
runBoxLoop n = do
  store <- newIORef (M.empty :: M.Map (Integer, String, Integer) Integer)
  evs <- newIORef ([] :: [(String, [Integer])])
  scalars <- newIORef (M.empty :: M.Map (Integer, String) Integer)
  let cc = compileCC "box.sol" (boxLoopSource n)
      contract = M.findWithDefault (error "missing Box") (stringToLabel "Box") (cc ^. CC.contracts)
      func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      readStore addr name key = M.findWithDefault 0 (addr, name, key) <$> readIORef store
      writeStore addr name key val = modifyIORef' store (M.insert (addr, name, key) val)
      hooks =
        StorageHooks
          { shSender = pure storeSender,
            shThis = pure storeThis,
            shTimestamp = pure 1000000,
            shNumber = pure 1,
            shMapGet = \name key _ -> readStore storeThis name key,
            shMapSet = \name key val _ -> writeStore storeThis name key val,
            shMapGetAt = \addr name key _ -> readStore addr name key,
            shMapSetAt = \addr name key val _ -> writeStore addr name key val,
            shMapGet2At = \_ _ _ _ _ _ -> pure 0,
            shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
            shSloadAddr = \field -> M.findWithDefault 0 (storeThis, field) <$> readIORef scalars,
            shSloadAt = \addr field -> M.findWithDefault 0 (addr, field) <$> readIORef scalars,
            shSstore = \field val -> modifyIORef' scalars (M.insert (storeThis, field) val),
            shSstoreAt = \addr field val -> modifyIORef' scalars (M.insert (addr, field) val),
            shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
            shEmitMany = \ps -> modifyIORef' evs (ps ++)
          }
  result <- runAnyStorageIR hooks cc contract func []
  case result of
    Nothing -> error "storage IR miss on Box.it_loop"
    Just (_, cost) -> do
      m <- readIORef store
      logged <- readIORef evs
      let val = M.findWithDefault 0 (storeThis, "slots", storeSender) m
      pure (cost, val, length logged)

boxLoopCost :: Int -> IO Integer
boxLoopCost n = do
  (cost, _, _) <- runBoxLoop n
  pure cost

boxLoopResult :: Int -> IO (Integer, Int)
boxLoopResult n = do
  (_, val, nEvents) <- runBoxLoop n
  pure (val, nEvents)

coinLoopSource :: Int -> T.Text
coinLoopSource n =
  T.unlines
    [ "contract Ctx {",
      "    function _msgSender() internal view returns (address) { return msg.sender; }",
      "}",
      "contract Coin is Ctx {",
      "    mapping(address => uint256) private slots;",
      "    uint256 private supply;",
      "    event Wrote(address indexed from, address indexed to, uint256 value);",
      "    address constant dest = address(0x1);",
      "    function pay(address to, uint256 value) public returns (bool) {",
      "        address from = _msgSender();",
      "        require(from != address(0) || to != address(0));",
      "        if (from == address(0)) { supply += value; }",
      "        else {",
      "            uint256 fromBalance = slots[from];",
      "            require(fromBalance >= value);",
      "            slots[from] = fromBalance - value;",
      "        }",
      "        if (to == address(0)) { supply -= value; }",
      "        else { slots[to] += value; }",
      "        emit Wrote(from, to, value);",
      "        return true;",
      "    }",
      "    function it_loop() {",
      "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
      "            pay(dest, 1);",
      "        }",
      "    }",
      "}"
    ]

runCoinLoop :: Int -> IO (Integer, Integer, Integer)
runCoinLoop n = do
  store <- newIORef (M.singleton (storeThis, "slots", storeSender) 1000)
  evs <- newIORef ([] :: [(String, [Integer])])
  scalars <- newIORef (M.empty :: M.Map (Integer, String) Integer)
  let cc = compileCC "coin.sol" (coinLoopSource n)
      contract = M.findWithDefault (error "missing Coin") (stringToLabel "Coin") (cc ^. CC.contracts)
      func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      readStore addr name key = M.findWithDefault 0 (addr, name, key) <$> readIORef store
      writeStore addr name key val = modifyIORef' store (M.insert (addr, name, key) val)
      hooks =
        StorageHooks
          { shSender = pure storeSender,
            shThis = pure storeThis,
            shTimestamp = pure 1000000,
            shNumber = pure 1,
            shMapGet = \name key _ -> readStore storeThis name key,
            shMapSet = \name key val _ -> writeStore storeThis name key val,
            shMapGetAt = \addr name key _ -> readStore addr name key,
            shMapSetAt = \addr name key val _ -> writeStore addr name key val,
            shMapGet2At = \_ _ _ _ _ _ -> pure 0,
            shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
            shSloadAddr = \field -> M.findWithDefault 0 (storeThis, field) <$> readIORef scalars,
            shSloadAt = \addr field -> M.findWithDefault 0 (addr, field) <$> readIORef scalars,
            shSstore = \field val -> modifyIORef' scalars (M.insert (storeThis, field) val),
            shSstoreAt = \addr field val -> modifyIORef' scalars (M.insert (addr, field) val),
            shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
            shEmitMany = \ps -> modifyIORef' evs (ps ++)
          }
  result <- runAnyStorageIR hooks cc contract func []
  case result of
    Nothing -> error "storage IR miss on Coin.it_loop"
    Just (_, cost) -> do
      m <- readIORef store
      let toBal = M.findWithDefault 0 (storeThis, "slots", 1) m
          fromBal = M.findWithDefault 0 (storeThis, "slots", storeSender) m
      pure (cost, toBal, fromBal)

coinLoopCost :: Int -> IO Integer
coinLoopCost n = do
  (cost, _, _) <- runCoinLoop n
  pure cost

coinLoopResult :: Int -> IO (Integer, Integer)
coinLoopResult n = do
  (_, toBal, fromBal) <- runCoinLoop n
  pure (toBal, fromBal)

-- Storage-typed receiver + _msgSender + inherited mapping + modifier
-- try/catch + address(0) mint/burn. Same shape as the token bench loop
-- without those contract/function names.
holderThis, holderCoin :: Integer
holderThis = 0xdef
holderCoin = 0x1234

holderLoopSource :: Int -> T.Text
holderLoopSource n =
  T.unlines
    [ "contract Ctx {",
      "    function _msgSender() internal view returns (address) { return msg.sender; }",
      "}",
      "contract BaseCoin is Ctx {",
      "    mapping(address => uint256) private slots;",
      "    uint256 private supply;",
      "    event Wrote(address indexed from, address indexed to, uint256 value);",
      "    function pay(address to, uint256 value) public virtual returns (bool) {",
      "        address from = _msgSender();",
      "        require(from != address(0) || to != address(0));",
      "        if (from == address(0)) { supply += value; }",
      "        else {",
      "            uint256 fromBalance = slots[from];",
      "            require(fromBalance >= value);",
      "            slots[from] = fromBalance - value;",
      "        }",
      "        if (to == address(0)) { supply -= value; }",
      "        else { slots[to] += value; }",
      "        emit Wrote(from, to, value);",
      "        return true;",
      "    }",
      "    function read(address a) public view returns (uint256) { return slots[a]; }",
      "}",
      "contract Coin is BaseCoin {",
      "    bool private locked;",
      "    address private admin;",
      "    modifier whenOpen() {",
      "        if (locked) {",
      "            try { require(admin == _msgSender()); } catch { require(false); }",
      "        }",
      "        _;",
      "    }",
      "    function pay(address to, uint256 value) public override whenOpen returns (bool) {",
      "        return super.pay(to, value);",
      "    }",
      "}",
      "contract Describe_Z {",
      "    Coin c;",
      "    address to;",
      "    function it_loop() {",
      "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
      "            c.pay(to, 1);",
      "        }",
      "        require(BaseCoin(c).read(to) == " <> T.pack (show n) <> ");",
      "    }",
      "}"
    ]

runHolderLoop :: Int -> IO (Integer, Integer, Integer)
runHolderLoop n = do
  store <- newIORef (M.singleton (holderCoin, "slots", holderThis) 1000)
  evs <- newIORef ([] :: [(String, [Integer])])
  scalars <-
    newIORef
      ( M.fromList
          [ ((holderThis, "c"), holderCoin),
            ((holderThis, "to"), 1)
          ] ::
          M.Map (Integer, String) Integer
      )
  let cc = compileCC "holder.sol" (holderLoopSource n)
      contract = M.findWithDefault (error "missing Describe_Z") (stringToLabel "Describe_Z") (cc ^. CC.contracts)
      func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      readStore addr name key = M.findWithDefault 0 (addr, name, key) <$> readIORef store
      writeStore addr name key val = modifyIORef' store (M.insert (addr, name, key) val)
      hooks =
        StorageHooks
          { shSender = pure storeSender,
            shThis = pure holderThis,
            shTimestamp = pure 1000000,
            shNumber = pure 1,
            shMapGet = \name key _ -> readStore holderThis name key,
            shMapSet = \name key val _ -> writeStore holderThis name key val,
            shMapGetAt = \addr name key _ -> readStore addr name key,
            shMapSetAt = \addr name key val _ -> writeStore addr name key val,
            shMapGet2At = \_ _ _ _ _ _ -> pure 0,
            shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
            shSloadAddr = \field -> M.findWithDefault 0 (holderThis, field) <$> readIORef scalars,
            shSloadAt = \addr field -> M.findWithDefault 0 (addr, field) <$> readIORef scalars,
            shSstore = \field val -> modifyIORef' scalars (M.insert (holderThis, field) val),
            shSstoreAt = \addr field val -> modifyIORef' scalars (M.insert (addr, field) val),
            shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
            shEmitMany = \ps -> modifyIORef' evs (ps ++)
          }
  result <- runAnyStorageIR hooks cc contract func []
  case result of
    Nothing -> error "storage IR miss on Describe_Z.it_loop"
    Just (_, cost) -> do
      m <- readIORef store
      let toBal = M.findWithDefault 0 (holderCoin, "slots", 1) m
          fromBal = M.findWithDefault 0 (holderCoin, "slots", holderThis) m
      pure (cost, toBal, fromBal)

holderLoopCost :: Int -> IO Integer
holderLoopCost n = do
  (cost, _, _) <- runHolderLoop n
  pure cost

holderLoopResult :: Int -> IO (Integer, Integer)
holderLoopResult n = do
  (_, toBal, fromBal) <- runHolderLoop n
  pure (toBal, fromBal)

waveLoopSource :: Int -> T.Text
waveLoopSource n =
  T.unlines
    [ "library Bits {",
      "    function msb(uint x) internal pure returns (uint) {",
      "        require(x > 0);",
      "        uint r = 0;",
      "        if (x >= 16) { x >>= 4; r += 4; }",
      "        if (x >= 4) { x >>= 2; r += 2; }",
      "        if (x >= 2) r += 1;",
      "        return r;",
      "    }",
      "}",
      "library Words {",
      "    function nextOn(mapping(int => uint) storage self, int tick) internal view returns (int next, bool on) {",
      "        int wordPos = tick >> 8;",
      "        uint masked = self[wordPos];",
      "        on = masked != 0;",
      "        next = on ? int(Bits.msb(masked)) : tick;",
      "    }",
      "}",
      "contract Wave {",
      "    mapping(int => uint) private words;",
      "    mapping(address => uint256) private slots;",
      "    uint public price;",
      "    bool private locked;",
      "    struct Cache { uint start; int tick; bool flag; }",
      "    event Wrote(address indexed who, uint value);",
      "    modifier whenOpen() {",
      "        require(!locked);",
      "        locked = true;",
      "        _;",
      "        locked = false;",
      "    }",
      "    function bump(address to, uint value) public whenOpen returns (int a0, int a1) {",
      "        Cache memory cache;",
      "        cache.start = price;",
      "        cache.tick = 0;",
      "        while (cache.start != 0 && value > 0) {",
      "            (int nxt, bool on) = Words.nextOn(words, cache.tick);",
      "            if (on) { cache.tick = nxt; }",
      "            cache.start = block.timestamp;",
      "            value = 0;",
      "        }",
      "        slots[to] += 1;",
      "        price = cache.start;",
      "        emit Wrote(to, slots[to]);",
      "        a0 = int(1);",
      "        a1 = -int(1);",
      "        return (a0, a1);",
      "    }",
      "}",
      "contract Describe_Z {",
      "    Wave w;",
      "    address to;",
      "    function it_loop() {",
      "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
      "            w.bump(to, 1);",
      "        }",
      "    }",
      "}"
    ]

runWaveLoop :: Int -> IO (Integer, Integer)
runWaveLoop n = do
  store <- newIORef (M.empty :: M.Map (Integer, String, Integer) Integer)
  evs <- newIORef ([] :: [(String, [Integer])])
  scalars <-
    newIORef
      ( M.fromList
          [ ((holderThis, "w"), holderCoin),
            ((holderThis, "to"), 1),
            ((holderCoin, "price"), 1)
          ] ::
          M.Map (Integer, String) Integer
      )
  let cc = compileCC "wave.sol" (waveLoopSource n)
      contract = M.findWithDefault (error "missing Describe_Z") (stringToLabel "Describe_Z") (cc ^. CC.contracts)
      func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      readStore addr name key = M.findWithDefault 0 (addr, name, key) <$> readIORef store
      writeStore addr name key val = modifyIORef' store (M.insert (addr, name, key) val)
      hooks =
        StorageHooks
          { shSender = pure storeSender,
            shThis = pure holderThis,
            shTimestamp = pure 1000000,
            shNumber = pure 1,
            shMapGet = \name key _ -> readStore holderThis name key,
            shMapSet = \name key val _ -> writeStore holderThis name key val,
            shMapGetAt = \addr name key _ -> readStore addr name key,
            shMapSetAt = \addr name key val _ -> writeStore addr name key val,
            shMapGet2At = \_ _ _ _ _ _ -> pure 0,
            shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
            shSloadAddr = \field -> M.findWithDefault 0 (holderThis, field) <$> readIORef scalars,
            shSloadAt = \addr field -> M.findWithDefault 0 (addr, field) <$> readIORef scalars,
            shSstore = \field val -> modifyIORef' scalars (M.insert (holderThis, field) val),
            shSstoreAt = \addr field val -> modifyIORef' scalars (M.insert (addr, field) val),
            shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
            shEmitMany = \ps -> modifyIORef' evs (ps ++)
          }
  result <- runAnyStorageIR hooks cc contract func []
  case result of
    Nothing -> error "storage IR miss on Describe_Z.it_loop wave"
    Just (_, cost) -> do
      m <- readIORef store
      let nTo = M.findWithDefault 0 (holderCoin, "slots", 1) m
      pure (cost, nTo)

waveLoopCost :: Int -> IO Integer
waveLoopCost n = fst <$> runWaveLoop n

waveLoopResult :: Int -> IO Integer
waveLoopResult n = snd <$> runWaveLoop n

-- Two unrelated contracts both expose `pay`. A locally typed receiver must
-- pick CoinA (not most-derived-name lookup, which is ambiguous).
typedPaySource :: Int -> T.Text
typedPaySource n =
  T.unlines
    [ "contract CoinA {",
      "    mapping(address => uint256) private slots;",
      "    event Wrote(address indexed who, uint256 value);",
      "    function pay(address to, uint256 v) public returns (bool) {",
      "        slots[to] += v;",
      "        emit Wrote(to, slots[to]);",
      "        return true;",
      "    }",
      "}",
      "contract CoinB {",
      "    mapping(address => uint256) private slots;",
      "    function pay(address to, uint256 v) public returns (bool) {",
      "        slots[to] += v * 100;",
      "        return true;",
      "    }",
      "}",
      "contract Describe_Z {",
      "    CoinA c;",
      "    address to;",
      "    function it_loop() {",
      "        CoinA x = c;",
      "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
      "            x.pay(to, 1);",
      "        }",
      "    }",
      "}"
    ]

runTypedPay :: Int -> IO (Integer, Integer)
runTypedPay n = do
  store <- newIORef (M.empty :: M.Map (Integer, String, Integer) Integer)
  evs <- newIORef ([] :: [(String, [Integer])])
  scalars <-
    newIORef
      ( M.fromList
          [ ((holderThis, "c"), holderCoin),
            ((holderThis, "to"), 1)
          ] ::
          M.Map (Integer, String) Integer
      )
  let cc = compileCC "typed.sol" (typedPaySource n)
      contract = M.findWithDefault (error "missing Describe_Z") (stringToLabel "Describe_Z") (cc ^. CC.contracts)
      func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      readStore addr name key = M.findWithDefault 0 (addr, name, key) <$> readIORef store
      writeStore addr name key val = modifyIORef' store (M.insert (addr, name, key) val)
      hooks =
        StorageHooks
          { shSender = pure storeSender,
            shThis = pure holderThis,
            shTimestamp = pure 1000000,
            shNumber = pure 1,
            shMapGet = \name key _ -> readStore holderThis name key,
            shMapSet = \name key val _ -> writeStore holderThis name key val,
            shMapGetAt = \addr name key _ -> readStore addr name key,
            shMapSetAt = \addr name key val _ -> writeStore addr name key val,
            shMapGet2At = \_ _ _ _ _ _ -> pure 0,
            shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
            shSloadAddr = \field -> M.findWithDefault 0 (holderThis, field) <$> readIORef scalars,
            shSloadAt = \addr field -> M.findWithDefault 0 (addr, field) <$> readIORef scalars,
            shSstore = \field val -> modifyIORef' scalars (M.insert (holderThis, field) val),
            shSstoreAt = \addr field val -> modifyIORef' scalars (M.insert (addr, field) val),
            shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
            shEmitMany = \ps -> modifyIORef' evs (ps ++)
          }
  result <- runAnyStorageIR hooks cc contract func []
  case result of
    Nothing -> error "storage IR miss on typed CoinA.pay"
    Just (_, cost) -> do
      m <- readIORef store
      pure (cost, M.findWithDefault 0 (holderCoin, "slots", 1) m)

-- Nested inlined call: bump() on Box must appear as msg.sender inside Coin.pay.
nestBox, nestCoin :: Integer
nestBox = 0x1234
nestCoin = 0x5678

nestedSenderSource :: Int -> T.Text
nestedSenderSource n =
  T.unlines
    [ "contract Coin {",
      "    mapping(address => uint256) private slots;",
      "    event Wrote(address indexed who, uint256 value);",
      "    function pay(uint256 v) public returns (bool) {",
      "        address from = msg.sender;",
      "        slots[from] += v;",
      "        emit Wrote(from, slots[from]);",
      "        return true;",
      "    }",
      "}",
      "contract Box {",
      "    Coin c;",
      "    function bump(uint256 v) public returns (bool) {",
      "        return c.pay(v);",
      "    }",
      "}",
      "contract Describe_Z {",
      "    Box b;",
      "    function it_loop() {",
      "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
      "            b.bump(1);",
      "        }",
      "    }",
      "}"
    ]

runNestedSender :: Int -> IO (Integer, Integer, Integer)
runNestedSender n = do
  store <- newIORef (M.empty :: M.Map (Integer, String, Integer) Integer)
  evs <- newIORef ([] :: [(String, [Integer])])
  scalars <-
    newIORef
      ( M.fromList
          [ ((holderThis, "b"), nestBox),
            ((nestBox, "c"), nestCoin)
          ] ::
          M.Map (Integer, String) Integer
      )
  let cc = compileCC "nested.sol" (nestedSenderSource n)
      contract = M.findWithDefault (error "missing Describe_Z") (stringToLabel "Describe_Z") (cc ^. CC.contracts)
      func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      readStore addr name key = M.findWithDefault 0 (addr, name, key) <$> readIORef store
      writeStore addr name key val = modifyIORef' store (M.insert (addr, name, key) val)
      hooks =
        StorageHooks
          { shSender = pure storeSender,
            shThis = pure holderThis,
            shTimestamp = pure 1000000,
            shNumber = pure 1,
            shMapGet = \name key _ -> readStore holderThis name key,
            shMapSet = \name key val _ -> writeStore holderThis name key val,
            shMapGetAt = \addr name key _ -> readStore addr name key,
            shMapSetAt = \addr name key val _ -> writeStore addr name key val,
            shMapGet2At = \_ _ _ _ _ _ -> pure 0,
            shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
            shSloadAddr = \field -> M.findWithDefault 0 (holderThis, field) <$> readIORef scalars,
            shSloadAt = \addr field -> M.findWithDefault 0 (addr, field) <$> readIORef scalars,
            shSstore = \field val -> modifyIORef' scalars (M.insert (holderThis, field) val),
            shSstoreAt = \addr field val -> modifyIORef' scalars (M.insert (addr, field) val),
            shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
            shEmitMany = \ps -> modifyIORef' evs (ps ++)
          }
  result <- runAnyStorageIR hooks cc contract func []
  case result of
    Nothing -> error "storage IR miss on nested msg.sender"
    Just (_, cost) -> do
      m <- readIORef store
      let creditedBox = M.findWithDefault 0 (nestCoin, "slots", nestBox) m
          creditedZ = M.findWithDefault 0 (nestCoin, "slots", holderThis) m
      pure (cost, creditedBox, creditedZ)

libMapReadSource :: T.Text
libMapReadSource =
  T.unlines
    [ "library Words {",
      "    function nextOn(mapping(int => uint) storage self, int tick) internal view returns (int next, bool on) {",
      "        int wordPos = tick >> 8;",
      "        uint masked = self[wordPos];",
      "        on = masked != 0;",
      "        next = on ? tick + 1 : tick;",
      "    }",
      "}",
      "contract Wave {",
      "    mapping(int => uint) private words;",
      "    function probe() public returns (int n, bool on) {",
      "        words[0] = 1;",
      "        return Words.nextOn(words, 0);",
      "    }",
      "}"
    ]

runLibMapRead :: IO (Integer, Integer)
runLibMapRead = do
  store <- newIORef (M.empty :: M.Map (Integer, String, Integer) Integer)
  evs <- newIORef ([] :: [(String, [Integer])])
  let cc = compileCC "libmap.sol" libMapReadSource
      contract = M.findWithDefault (error "missing Wave") (stringToLabel "Wave") (cc ^. CC.contracts)
      func = M.findWithDefault (error "missing probe") (stringToLabel "probe") (contract ^. CC.functions)
      readStore addr name key = M.findWithDefault 0 (addr, name, key) <$> readIORef store
      writeStore addr name key val = modifyIORef' store (M.insert (addr, name, key) val)
      hooks =
        StorageHooks
          { shSender = pure storeSender,
            shThis = pure holderThis,
            shTimestamp = pure 1000000,
            shNumber = pure 1,
            shMapGet = \name key _ -> readStore holderThis name key,
            shMapSet = \name key val _ -> writeStore holderThis name key val,
            shMapGetAt = \addr name key _ -> readStore addr name key,
            shMapSetAt = \addr name key val _ -> writeStore addr name key val,
            shMapGet2At = \_ _ _ _ _ _ -> pure 0,
            shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
            shSloadAddr = \_ -> pure 0,
            shSloadAt = \_ _ -> pure 0,
            shSstore = \_ _ -> pure (),
            shSstoreAt = \_ _ _ -> pure (),
            shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
            shEmitMany = \ps -> modifyIORef' evs (ps ++)
          }
  result <- runAnyStorageIR hooks cc contract func []
  case result of
    Nothing -> error "storage IR miss on library mapping read"
    Just (vs, _) -> case vs of
      [n, on] -> pure (n, on)
      other -> error $ "bad probe result: " ++ show other

computeArgs :: [Integer]
computeArgs =
  [ 79228162514264337593543950336,
    4295128740,
    2000000000000000000000,
    1000000000000000,
    500
  ]

spec :: Spec
spec = do
  describe "FastUIntIR gas" $ do
    it "grows with loop trip count, not with register count" $ do
      let c10 = irCost 10
          c40 = irCost 40
      c10 `shouldSatisfy` (> 0)
      -- N=40 executes the body 4x as often as N=10. Register count is unchanged
      -- (the bound is a single literal). A nregs-based cost would be ~equal.
      c40 `shouldSatisfy` (> 2 * c10)

  describe "FastUIntIR flat swap-math kernel" $ do
    it "lowers the library compute helper" $ do
      let values = mustHit libraryAndCompute "FlatSwapMath" "compute" computeArgs
      length values `shouldBe` 4

    it "lowers a loop that declares the compute tuple" $ do
      irRun (declaredLoop 4) "Describe_FlatSwapMathBench" "it_compute_flat_swap_step_loop" []
        `shouldSatisfy` (/= Nothing)

    it "lowers a loop that assigns a predeclared compute tuple" $ do
      irRun (predeclaredLoop 4) "Describe_FlatSwapMathBench" "it_compute_flat_swap_step_loop" []
        `shouldSatisfy` (/= Nothing)

    it "lowers a loop with an assertMatches helper around compute" $ do
      irRun (assertMatchesLoop 4) "Describe_FlatSwapMathBench" "it_compute_flat_swap_step_loop" []
        `shouldSatisfy` (/= Nothing)

    it "lowers assertMatches that also calls a signed-int library helper" $ do
      let source =
            libraryAndCompute
              <> T.unlines
                [ "library OtherMath {",
                  "    function step(uint a, uint b, uint c, int d, uint e) internal pure returns (uint n, uint i, uint o, uint f) {",
                  "        n = a;",
                  "        i = b;",
                  "        o = c;",
                  "        f = uint(d) + e;",
                  "    }",
                  "}",
                  "contract Describe_FlatSwapMathBench {",
                  "    uint constant Q96 = 79228162514264337593543950336;",
                  "    uint constant MIN_SQRT = 4295128740;",
                  "    uint constant LIQUIDITY = 2000000000000000000000;",
                  "    function assertMatches(uint current, uint target, uint amount) internal {",
                  "        (uint n1, uint i1, uint o1, uint f1) = OtherMath.step(",
                  "            current, target, LIQUIDITY, int(amount), 500",
                  "        );",
                  "        (uint n2, uint i2, uint o2, uint f2) = FlatSwapMath.compute(",
                  "            current, target, LIQUIDITY, amount, 500",
                  "        );",
                  "        require(n1 > 0 && n2 > 0 && i1 >= 0 && i2 >= 0 && o1 >= 0 && o2 >= 0 && f1 >= 0 && f2 >= 0);",
                  "    }",
                  "    function it_compute_flat_swap_step_loop() {",
                  "        assertMatches(Q96, MIN_SQRT, 1000000000000000);",
                  "        uint digest = 0;",
                  "        for (uint i = 0; i < 2; i++) {",
                  "            (uint next, uint amountIn, uint amountOut, uint feeAmount) = FlatSwapMath.compute(",
                  "                Q96, MIN_SQRT, LIQUIDITY, 1000000000000000, 500",
                  "            );",
                  "            digest = digest + next + amountIn + amountOut + feeAmount;",
                  "        }",
                  "        require(digest > 0, \"empty result\");",
                  "    }",
                  "}"
                ]
      irRun source "Describe_FlatSwapMathBench" "it_compute_flat_swap_step_loop" []
        `shouldSatisfy` (/= Nothing)

    it "lowers TickMath.getTickAtSqrtRatio" $ do
      bitMath <- T.pack <$> readFile "/Users/kierenjameslubin/software/clean-clone-ii/strato-platform-solidvm-ir/app/contracts/libraries/PoolV3/BitMath.sol"
      tickMath <- T.pack <$> readFile "/Users/kierenjameslubin/software/clean-clone-ii/strato-platform-solidvm-ir/app/contracts/libraries/PoolV3/TickMath.sol"
      let stripImports =
            T.unlines
              . filter
                ( \ln ->
                    not ("import " `T.isPrefixOf` T.stripStart ln)
                      && not ("// SPDX" `T.isPrefixOf` T.stripStart ln)
                )
              . T.lines
          source = T.unlines [stripImports bitMath, stripImports tickMath]
          cc = compileCC "tick.sol" source
          contract = M.findWithDefault (error "missing TickMath") (stringToLabel "TickMath") (cc ^. CC.contracts)
          func = M.findWithDefault (error "missing getTickAtSqrtRatio") (stringToLabel "getTickAtSqrtRatio") (contract ^. CC.functions)
      funcLowers cc contract func `shouldBe` True
      funcFallbackCount cc contract func `shouldBe` 0
      irRun source "TickMath" "getTickAtSqrtRatio" [79228162514264337593543950336]
        `shouldSatisfy` (/= Nothing)

    it "lowers the real SwapMath.computeSwapStep bench loop" $ do
      fullMath <- T.pack <$> readFile "/Users/kierenjameslubin/software/clean-clone-ii/strato-platform-solidvm-ir/app/contracts/libraries/PoolV3/FullMath.sol"
      fixed <- T.pack <$> readFile "/Users/kierenjameslubin/software/clean-clone-ii/strato-platform-solidvm-ir/app/contracts/libraries/PoolV3/FixedPoint96.sol"
      sqrtMath <- T.pack <$> readFile "/Users/kierenjameslubin/software/clean-clone-ii/strato-platform-solidvm-ir/app/contracts/libraries/PoolV3/SqrtPriceMath.sol"
      swapMath <- T.pack <$> readFile "/Users/kierenjameslubin/software/clean-clone-ii/strato-platform-solidvm-ir/app/contracts/libraries/PoolV3/SwapMath.sol"
      let stripImports =
            T.unlines
              . filter
                ( \ln ->
                    not ("import " `T.isPrefixOf` T.stripStart ln)
                      && not ("// SPDX" `T.isPrefixOf` T.stripStart ln)
                )
              . T.lines
          bench =
            T.unlines
              [ "contract Describe_SwapMathBench {",
                "    uint constant Q96 = 79228162514264337593543950336;",
                "    uint constant MIN_SQRT = 4295128740;",
                "    uint constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;",
                "    uint constant LIQUIDITY = 2000000000000000000000;",
                "    function it_compute_swap_step_loop() {",
                "        uint current = Q96 + (4 % 1000);",
                "        uint digest = 0;",
                "        for (uint i = 0; i < 4; i++) {",
                "            bool zeroForOne = i % 2 == 0;",
                "            uint target = zeroForOne ? MIN_SQRT : MAX_SQRT;",
                "            (uint next, uint amountIn, uint amountOut, uint feeAmount) = SwapMath.computeSwapStep(",
                "                current, target, LIQUIDITY, int(1000000000000000 + (i % 1000)), 500",
                "            );",
                "            current = next;",
                "            digest = digest + amountIn + amountOut + feeAmount;",
                "        }",
                "        if (4 > 0) require(digest > 0, \"empty result\");",
                "    }",
                "}"
              ]
          source = T.unlines [stripImports fullMath, stripImports fixed, stripImports sqrtMath, stripImports swapMath, bench]
      irRun source "Describe_SwapMathBench" "it_compute_swap_step_loop" []
        `shouldSatisfy` (/= Nothing)

    it "predeclared-loop cost grows with trip count" $ do
      let cost n =
            case irRun (predeclaredLoop n) "Describe_FlatSwapMathBench" "it_compute_flat_swap_step_loop" [] of
              Just (_, c) -> c
              Nothing -> error "IR miss on predeclared loop"
          c2 = cost 2
          c8 = cost 8
      c8 `shouldSatisfy` (> 2 * c2)

  describe "FastUIntIR mapping/address transfer kernel" $ do
    it "lowers a mapping(address=>uint) transfer body" $ do
      let source =
            T.unlines
              [ "contract Token {",
                "    mapping(address => uint) private _balances;",
                "    event Transfer(address indexed from, address indexed to, uint value);",
                "    function transfer(address to, uint value) public returns (bool) {",
                "        address from = msg.sender;",
                "        require(from != address(0), \"from zero\");",
                "        require(to != address(0), \"to zero\");",
                "        uint fromBalance = _balances[from];",
                "        require(fromBalance >= value, \"insufficient\");",
                "        _balances[from] = fromBalance - value;",
                "        _balances[to] += value;",
                "        emit Transfer(from, to, value);",
                "        return true;",
                "    }",
                "}"
              ]
          cc = compileCC "token.sol" source
          contract = M.findWithDefault (error "missing Token") (stringToLabel "Token") (cc ^. CC.contracts)
          func = M.findWithDefault (error "missing transfer") (stringToLabel "transfer") (contract ^. CC.functions)
      funcLowers cc contract func `shouldBe` True

  describe "FastUIntIR storage IR billed cost" $ do
    it "mapping+emit+msg.sender loop cost grows with trip count, not register count" $ do
      c10 <- storageLoopCost 10
      c40 <- storageLoopCost 40
      c10 `shouldSatisfy` (> 0)
      c40 `shouldSatisfy` (> 2 * c10)
      (finalVal, nEvents) <- storageLoopResult 40
      finalVal `shouldBe` 40
      nEvents `shouldBe` 40

  describe "FastUIntIR modifier+super storage IR billed cost" $ do
    it "inherited mapping write behind a modifier grows with trip count" $ do
      c10 <- boxLoopCost 10
      c40 <- boxLoopCost 40
      c10 `shouldSatisfy` (> 0)
      c40 `shouldSatisfy` (> 2 * c10)
      (finalVal, nEvents) <- boxLoopResult 40
      finalVal `shouldBe` 40
      nEvents `shouldBe` 40

    it "lowers a loop that calls write on a storage contract receiver" $ do
      let source =
            T.unlines
              [ "contract BaseBox {",
                "    mapping(address => uint256) private slots;",
                "    event Wrote(address indexed who, uint256 value);",
                "    function write(address a, uint256 v) public virtual returns (bool) {",
                "        slots[a] = slots[a] + v;",
                "        emit Wrote(a, v);",
                "        return true;",
                "    }",
                "    function read(address a) public view returns (uint256) {",
                "        return slots[a];",
                "    }",
                "}",
                "contract Box is BaseBox {",
                "    bool private locked;",
                "    modifier whenOpen() {",
                "        if (locked) { require(!locked, \"locked\"); }",
                "        _;",
                "    }",
                "    function write(address a, uint256 v) public override whenOpen returns (bool) {",
                "        return super.write(a, v);",
                "    }",
                "}",
                "contract Describe_Z {",
                "    Box b;",
                "    address to;",
                "    function it_loop() {",
                "        for (uint i = 0; i < 4; i++) {",
                "            b.write(to, 1);",
                "        }",
                "        require(BaseBox(b).read(to) == 4, \"bad\");",
                "    }",
                "}"
              ]
          cc = compileCC "box.sol" source
          contract = M.findWithDefault (error "missing Describe_Z") (stringToLabel "Describe_Z") (cc ^. CC.contracts)
          func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      funcLowers cc contract func `shouldBe` True

    it "msg-sender plus address(0) mint/burn branches lower and grow with trips" $ do
      c10 <- coinLoopCost 10
      c40 <- coinLoopCost 40
      c10 `shouldSatisfy` (> 0)
      c40 `shouldSatisfy` (> 2 * c10)
      (finalTo, finalFrom) <- coinLoopResult 40
      finalTo `shouldBe` 40
      finalFrom `shouldBe` 1000 - 40

    it "storage receiver plus _msgSender plus modifier try/catch grows with trips" $ do
      c10 <- holderLoopCost 10
      c40 <- holderLoopCost 40
      c10 `shouldSatisfy` (> 0)
      c40 `shouldSatisfy` (> 2 * c10)
      (finalTo, finalFrom) <- holderLoopResult 40
      finalTo `shouldBe` 40
      finalFrom `shouldBe` 1000 - 40

    it "while plus memory struct plus library mapping plus timestamp grows with trips" $ do
      c10 <- waveLoopCost 10
      c40 <- waveLoopCost 40
      c10 `shouldSatisfy` (> 0)
      c40 `shouldSatisfy` (> 2 * c10)
      n <- waveLoopResult 40
      n `shouldBe` 40

    it "tuple-assigns into memory-struct fields and storage scalars" $ do
      let source n =
            T.unlines
              [ "library Words {",
                "    function pair(uint a, uint b) internal pure returns (uint x, uint y) {",
                "        x = a + 1;",
                "        y = b + 2;",
                "    }",
                "}",
                "contract Wave {",
                "    uint public left;",
                "    uint public right;",
                "    struct Cache { uint start; uint tick; }",
                "    function bump() public returns (uint s, uint t) {",
                "        Cache memory cache;",
                "        (cache.start, cache.tick) = Words.pair(left, right);",
                "        (left, right) = Words.pair(cache.start, cache.tick);",
                "        s = cache.start;",
                "        t = cache.tick;",
                "        return (s, t);",
                "    }",
                "}",
                "contract Describe_Z {",
                "    Wave w;",
                "    function it_loop() {",
                "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
                "            w.bump();",
                "        }",
                "    }",
                "}"
              ]
      evs <- newIORef ([] :: [(String, [Integer])])
      scalars <-
        newIORef
          ( M.fromList
              [ ((holderThis, "w"), holderCoin),
                ((holderCoin, "left"), 3),
                ((holderCoin, "right"), 5)
              ] ::
              M.Map (Integer, String) Integer
          )
      let cc = compileCC "tuple.sol" (source (4 :: Int))
          contract = M.findWithDefault (error "missing Describe_Z") (stringToLabel "Describe_Z") (cc ^. CC.contracts)
          func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
          wave = M.findWithDefault (error "missing Wave") (stringToLabel "Wave") (cc ^. CC.contracts)
          bump = M.findWithDefault (error "missing bump") (stringToLabel "bump") (wave ^. CC.functions)
          hooks =
            StorageHooks
              { shSender = pure storeSender,
                shThis = pure holderThis,
                shTimestamp = pure 1000000,
                shNumber = pure 1,
                shMapGet = \_ _ _ -> pure 0,
                shMapSet = \_ _ _ _ -> pure (),
                shMapGetAt = \_ _ _ _ -> pure 0,
                shMapSetAt = \_ _ _ _ _ -> pure (),
                shMapGet2At = \_ _ _ _ _ _ -> pure 0,
                shMapSet2At = \_ _ _ _ _ _ _ -> pure (),
                shSloadAddr = \field -> M.findWithDefault 0 (holderThis, field) <$> readIORef scalars,
                shSloadAt = \addr field -> M.findWithDefault 0 (addr, field) <$> readIORef scalars,
                shSstore = \field val -> modifyIORef' scalars (M.insert (holderThis, field) val),
                shSstoreAt = \addr field val -> modifyIORef' scalars (M.insert (addr, field) val),
                shEmit = \nm vs -> modifyIORef' evs ((nm, vs) :),
                shEmitMany = \ps -> modifyIORef' evs (ps ++)
              }
      funcLowers cc wave bump `shouldBe` True
      funcLowers cc contract func `shouldBe` True
      funcFallbackCount cc wave bump `shouldBe` 0
      result <- runAnyStorageIR hooks cc contract func []
      case result of
        Nothing -> error "storage IR miss on struct-field tuple assign"
        Just (_, cost) -> do
          cost `shouldSatisfy` (> 0)
          left <- M.findWithDefault 0 (holderCoin, "left") <$> readIORef scalars
          right <- M.findWithDefault 0 (holderCoin, "right") <$> readIORef scalars
          -- each bump: (left,right) := (left+2, right+4). Four bumps from (3,5).
          left `shouldBe` 11
          right `shouldBe` 21

    it "local contract-typed receiver picks the typed pay among name collisions" $ do
      let cc = compileCC "typed.sol" (typedPaySource 4)
          contract = M.findWithDefault (error "missing Describe_Z") (stringToLabel "Describe_Z") (cc ^. CC.contracts)
          func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
      funcLowers cc contract func `shouldBe` True
      (c10, v10) <- runTypedPay 10
      (c40, v40) <- runTypedPay 40
      v10 `shouldBe` 10
      v40 `shouldBe` 40
      c10 `shouldSatisfy` (> 0)
      c40 `shouldSatisfy` (> 2 * c10)

    it "nested inlined call credits msg.sender as the inner caller, not the outer this" $ do
      (c10, box10, z10) <- runNestedSender 10
      (c40, box40, z40) <- runNestedSender 40
      box10 `shouldBe` 10
      box40 `shouldBe` 40
      z10 `shouldBe` 0
      z40 `shouldBe` 0
      c10 `shouldSatisfy` (> 0)
      c40 `shouldSatisfy` (> 2 * c10)

    it "library mapping reads use the aliased storage map, not the formal name" $ do
      (n, on) <- runLibMapRead
      on `shouldBe` 1
      n `shouldBe` 1

    it "lowers a swap-shaped loop with a locally typed token among name collisions" $ do
      let source :: Int -> T.Text
          source n =
            T.unlines
              [ "library Words {",
                "    function nextOn(mapping(int => uint) storage self, int tick) internal view returns (int next, bool on) {",
                "        uint masked = self[tick >> 8];",
                "        on = masked != 0;",
                "        next = on ? tick + 1 : tick;",
                "    }",
                "}",
                "contract CoinA {",
                "    mapping(address => uint256) private slots;",
                "    mapping(address => mapping(address => uint256)) private allowed;",
                "    event Wrote(address indexed from, address indexed to, uint256 value);",
                "    function transfer(address to, uint256 v) public returns (bool) {",
                "        address from = msg.sender;",
                "        require(slots[from] >= v);",
                "        slots[from] -= v;",
                "        slots[to] += v;",
                "        emit Wrote(from, to, v);",
                "        return true;",
                "    }",
                "    function transferFrom(address from, address to, uint256 v) public returns (bool) {",
                "        address spender = msg.sender;",
                "        uint256 cur = allowed[from][spender];",
                "        require(cur >= v);",
                "        allowed[from][spender] = cur - v;",
                "        require(slots[from] >= v);",
                "        slots[from] -= v;",
                "        slots[to] += v;",
                "        emit Wrote(from, to, v);",
                "        return true;",
                "    }",
                "}",
                "contract CoinB {",
                "    function transfer(address to, uint256 v) public returns (bool) { to = to; v = v; return false; }",
                "    function transferFrom(address from, address to, uint256 v) public returns (bool) { from = from; to = to; v = v; return false; }",
                "}",
                "contract Wave {",
                "    mapping(int => uint) private words;",
                "    CoinA token0;",
                "    CoinA token1;",
                "    uint public price;",
                "    int public tick;",
                "    uint public liq;",
                "    bool private locked;",
                "    struct Cache { uint start; int tick; bool flag; }",
                "    modifier whenOpen() { require(!locked); locked = true; _; locked = false; }",
                "    function swap(address recipient, bool zeroForOne, int amountSpecified, uint lim, uint amountLimit, uint deadline) public whenOpen returns (int a0, int a1) {",
                "        require(amountSpecified != 0);",
                "        require(amountLimit > 0);",
                "        require(block.timestamp <= deadline);",
                "        require(recipient != address(0));",
                "        Cache memory cache;",
                "        cache.start = liq;",
                "        cache.tick = tick;",
                "        while (amountSpecified != 0 && price != lim) {",
                "            (int nxt, bool on) = Words.nextOn(words, cache.tick);",
                "            if (on) { cache.tick = nxt; }",
                "            amountSpecified = 0;",
                "            price = cache.start;",
                "        }",
                "        CoinA inputToken = zeroForOne ? token0 : token1;",
                "        CoinA outputToken = zeroForOne ? token1 : token0;",
                "        require(inputToken.transferFrom(msg.sender, address(this), 1));",
                "        require(outputToken.transfer(recipient, 1));",
                "        a0 = int(1);",
                "        a1 = -int(1);",
                "        return (a0, a1);",
                "    }",
                "}",
                "contract Describe_Z {",
                "    Wave w;",
                "    function it_loop() {",
                "        for (uint i = 0; i < " <> T.pack (show n) <> "; i++) {",
                "            w.swap(address(this), i % 2 == 0, 1000, 0, 1, block.timestamp + 3600);",
                "        }",
                "    }",
                "}"
              ]
          cc = compileCC "swapshaped.sol" (source 4)
          contract = M.findWithDefault (error "missing Describe_Z") (stringToLabel "Describe_Z") (cc ^. CC.contracts)
          func = M.findWithDefault (error "missing it_loop") (stringToLabel "it_loop") (contract ^. CC.functions)
          wave = M.findWithDefault (error "missing Wave") (stringToLabel "Wave") (cc ^. CC.contracts)
          swapF = M.findWithDefault (error "missing swap") (stringToLabel "swap") (wave ^. CC.functions)
      funcLowers cc wave swapF `shouldBe` True
      funcLowers cc contract func `shouldBe` True
      funcFallbackCount cc wave swapF `shouldBe` 0
      funcFallbackCount cc contract func `shouldBe` 0

    it "lowers TickBitmap.nextInitializedTickWithinOneWord through a mapping caller" $ do
      bitMath <- T.pack <$> readFile "/Users/kierenjameslubin/software/clean-clone-ii/strato-platform-solidvm-ir/app/contracts/libraries/PoolV3/BitMath.sol"
      tickBitmap <- T.pack <$> readFile "/Users/kierenjameslubin/software/clean-clone-ii/strato-platform-solidvm-ir/app/contracts/libraries/PoolV3/TickBitmap.sol"
      let stripImports =
            T.unlines
              . filter
                ( \ln ->
                    not ("import " `T.isPrefixOf` T.stripStart ln)
                      && not ("// SPDX" `T.isPrefixOf` T.stripStart ln)
                )
              . T.lines
          bench =
            T.unlines
              [ "contract Wave {",
                "    mapping(int => uint) private words;",
                "    function probe() public returns (int next, bool on) {",
                "        return TickBitmap.nextInitializedTickWithinOneWord(words, 0, 1, true);",
                "    }",
                "}"
              ]
          source = T.unlines [stripImports bitMath, stripImports tickBitmap, bench]
          cc = compileCC "bitmap.sol" source
          contract = M.findWithDefault (error "missing Wave") (stringToLabel "Wave") (cc ^. CC.contracts)
          func = M.findWithDefault (error "missing probe") (stringToLabel "probe") (contract ^. CC.functions)
      funcLowers cc contract func `shouldBe` True
      funcFallbackCount cc contract func `shouldBe` 0




