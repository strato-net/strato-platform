{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Interpreter for inline-assembly (Yul) blocks.
--
-- The interpreter runs on top of 'Blockchain.SolidVM.SM.MonadSM' and
-- uses the call frame's EVM-style memory (see "Blockchain.SolidVM.EvmMemory").
--
-- Name resolution inside an assembly block:
--
--   1. Yul @let@-declared variables (per-block scope stack).
--   2. Yul user-defined functions (per-block scope stack).
--   3. Builtins (dispatched by name in 'evalBuiltin').
--   4. Fallback: SolidVM locals (numeric types coerce to 'Word256';
--      reference types (string/bytes) are materialized into EVM memory
--      on first use, and the allocated pointer is returned).
--
-- Writes to an identifier that isn't in the Yul scope fall through to
-- the SolidVM local, coercing 'Word256' back to the Solidity type.
module Blockchain.SolidVM.Yul
  ( runInlineAssembly,
  )
where

import Blockchain.SolidVM.EvmMemory
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToWord256)
import Control.Monad (unless, void, when, zipWithM_)
import Control.Monad.IO.Class (liftIO)
import Data.Bits
  ( Bits (..),
    complement,
    shiftL,
    shiftR,
    testBit,
    xor,
    (.&.),
    (.|.),
  )
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.IORef (IORef, modifyIORef', newIORef, readIORef, writeIORef)
import qualified Data.Map as M
import Data.Maybe (listToMaybe)
import qualified Data.Text.Encoding as TE
import qualified Data.Text as T
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import SolidVM.Model.Value

-- ---------------------------------------------------------------------------
-- Interpreter state

type YulVarScope = M.Map SolidString (IORef Word256)

data YulFunc = YulFunc
  { yfParams :: [SolidString],
    yfReturns :: [SolidString],
    yfBody :: [CC.YulStatement]
  }

data YulEnv = YulEnv
  { -- | Per-block variable scopes. Head is the innermost.
    yeVarScopes :: IORef [YulVarScope],
    -- | Per-block function scopes. Head is the innermost.
    yeFuncScopes :: IORef [M.Map SolidString YulFunc],
    -- | Pointer cache for SolidVM reference-type locals already
    -- materialized into EVM memory during this assembly block.
    yeMaterialized :: IORef (M.Map SolidString Word256)
  }

-- | Non-local control flow out of a Yul statement.
data YulControl
  = YulNormal
  | YulBreak
  | YulContinue
  | YulLeave
  deriving (Eq)

-- ---------------------------------------------------------------------------
-- Entry point

runInlineAssembly :: MonadSM m => [CC.YulStatement] -> m ()
runInlineAssembly body = do
  env <- liftIO $ do
    vs <- newIORef [M.empty]
    fs <- newIORef [M.empty]
    mat <- newIORef M.empty
    pure $ YulEnv vs fs mat
  void $ runYulBody env body

-- ---------------------------------------------------------------------------
-- Block / statement evaluation

-- | Evaluate a block body without introducing a new lexical scope.
-- Function definitions within @body@ are hoisted so they can be called
-- before their textual position.
runYulBody :: MonadSM m => YulEnv -> [CC.YulStatement] -> m YulControl
runYulBody env body = do
  hoistYulFunctions env body
  let go [] = pure YulNormal
      go (s : rest) = do
        ctrl <- runYulStmt env s
        case ctrl of
          YulNormal -> go rest
          _ -> pure ctrl
  go body

-- | Run a block introducing a new scope frame for both variables and
-- functions, then pop both regardless of outcome.
runYulScopedBlock :: MonadSM m => YulEnv -> [CC.YulStatement] -> m YulControl
runYulScopedBlock env body = do
  pushScope env
  ctrl <- runYulBody env body
  popScope env
  pure ctrl

hoistYulFunctions :: MonadSM m => YulEnv -> [CC.YulStatement] -> m ()
hoistYulFunctions env body = do
  let fns = [(name, YulFunc (map CC.yulTypedName params) (map CC.yulTypedName rets) fbody)
            | CC.YulFunctionDef _ name params rets fbody <- body]
  unless (null fns) $ liftIO $ modifyIORef' (yeFuncScopes env) $ \case
    [] -> [M.fromList fns]
    (top : rest) -> (M.fromList fns `M.union` top) : rest

pushScope :: MonadSM m => YulEnv -> m ()
pushScope env = liftIO $ do
  modifyIORef' (yeVarScopes env) (M.empty :)
  modifyIORef' (yeFuncScopes env) (M.empty :)

popScope :: MonadSM m => YulEnv -> m ()
popScope env = liftIO $ do
  modifyIORef' (yeVarScopes env) (drop 1)
  modifyIORef' (yeFuncScopes env) (drop 1)

runYulStmt :: MonadSM m => YulEnv -> CC.YulStatement -> m YulControl
runYulStmt env = \case
  CC.YulBlock _ body -> runYulScopedBlock env body
  CC.YulLet _ names mInit -> do
    vals <- case mInit of
      Nothing -> pure (replicate (length names) 0)
      Just e -> do
        xs <- evalYulMulti env e
        when (length xs /= length names) $
          typeError "Yul let: arity mismatch between LHS and RHS" (show names)
        pure xs
    zipWithM_ (declareYul env) (map CC.yulTypedName names) vals
    pure YulNormal
  CC.YulAssign _ names e -> do
    vals <- evalYulMulti env e
    when (length vals /= length names) $
      typeError "Yul assign: arity mismatch between LHS and RHS" (show names)
    zipWithM_ (assignYul env) names vals
    pure YulNormal
  CC.YulIfStmt _ cond body -> do
    c <- evalYulSingle env cond
    if c /= 0 then runYulScopedBlock env body else pure YulNormal
  CC.YulSwitch _ scrut cases mDefault -> do
    v <- evalYulSingle env scrut
    let matching = listToMaybe [body | (lit, body) <- cases, litToWord lit == v]
    case matching of
      Just body -> runYulScopedBlock env body
      Nothing -> maybe (pure YulNormal) (runYulScopedBlock env) mDefault
  CC.YulFor _ initBlock cond post body -> runYulFor env initBlock cond post body
  CC.YulBreak _ -> pure YulBreak
  CC.YulContinue _ -> pure YulContinue
  CC.YulLeave _ -> pure YulLeave
  CC.YulExpressionStatement _ e -> do
    _ <- evalYulMulti env e
    pure YulNormal
  CC.YulFunctionDef {} -> pure YulNormal -- already hoisted

runYulFor ::
  MonadSM m =>
  YulEnv ->
  [CC.YulStatement] ->
  CC.YulExpression ->
  [CC.YulStatement] ->
  [CC.YulStatement] ->
  m YulControl
runYulFor env initBlock cond post body = do
  -- Yul 'for' scopes the init block variables to the entire loop.
  pushScope env
  _ <- runYulBody env initBlock
  let loop = do
        c <- evalYulSingle env cond
        if c == 0
          then pure YulNormal
          else do
            ctrl <- runYulScopedBlock env body
            case ctrl of
              YulBreak -> pure YulNormal
              YulLeave -> pure YulLeave
              _ -> do
                _ <- runYulScopedBlock env post
                loop
  result <- loop
  popScope env
  pure result

-- ---------------------------------------------------------------------------
-- Variable declaration / assignment / lookup

declareYul :: MonadSM m => YulEnv -> SolidString -> Word256 -> m ()
declareYul env name val = liftIO $ do
  ref <- newIORef val
  modifyIORef' (yeVarScopes env) $ \case
    [] -> [M.singleton name ref]
    (top : rest) -> M.insert name ref top : rest

-- | Write to a Yul identifier. If the name isn't in any Yul scope,
-- write the value back to the matching SolidVM local (with type
-- coercion).
assignYul :: MonadSM m => YulEnv -> SolidString -> Word256 -> m ()
assignYul env name val = do
  scopes <- liftIO $ readIORef (yeVarScopes env)
  case findInStack name scopes of
    Just ref -> liftIO $ writeIORef ref val
    Nothing -> writeBackSolidVM name val

-- | Read a Yul identifier, falling back to SolidVM locals with
-- coercion (and materialization for reference types).
lookupYul :: MonadSM m => YulEnv -> SolidString -> m Word256
lookupYul env name = do
  scopes <- liftIO $ readIORef (yeVarScopes env)
  case findInStack name scopes of
    Just ref -> liftIO $ readIORef ref
    Nothing -> readFromSolidVM env name

findInStack :: SolidString -> [YulVarScope] -> Maybe (IORef Word256)
findInStack _ [] = Nothing
findInStack name (frame : rest) = case M.lookup name frame of
  Just ref -> Just ref
  Nothing -> findInStack name rest

findFunction :: MonadSM m => YulEnv -> SolidString -> m (Maybe YulFunc)
findFunction env name = do
  scopes <- liftIO $ readIORef (yeFuncScopes env)
  pure $ go scopes
  where
    go [] = Nothing
    go (f : rest) = case M.lookup name f of
      Just fn -> Just fn
      Nothing -> go rest

-- ---------------------------------------------------------------------------
-- SolidVM value <-> Word256 bridge

readFromSolidVM :: MonadSM m => YulEnv -> SolidString -> m Word256
readFromSolidVM env name = do
  cached <- liftIO $ readIORef (yeMaterialized env)
  case M.lookup name cached of
    Just ptr -> pure ptr
    Nothing -> do
      var <- getVariableOfName name
      val <- getVar var
      coerceSolidValueForRead env name val

coerceSolidValueForRead :: MonadSM m => YulEnv -> SolidString -> Value -> m Word256
coerceSolidValueForRead env name = \case
  SInteger i -> pure $ fromInteger i
  SBool b -> pure (if b then 1 else 0)
  SAddress a _ -> pure $ fromInteger (toInteger a)
  SEnumVal _ _ w -> pure $ fromIntegral w
  SBytes bs -> materializeBytes env name bs
  SString s -> materializeBytes env name (TE.encodeUtf8 (T.pack s))
  SNULL -> pure 0
  v -> typeError "Yul: cannot read unsupported SolidVM value in assembly" (show v)

-- | Copy a dynamic byte string into EVM memory in Solidity's standard
-- layout (32-byte length word followed by zero-padded data) and cache
-- the starting pointer for subsequent reads of the same name.
materializeBytes :: MonadSM m => YulEnv -> SolidString -> BC.ByteString -> m Word256
materializeBytes env name bs = do
  let len = B.length bs
      paddedLen = ((len + 31) `div` 32) * 32
      totalLen = 32 + paddedLen
  ptr <- allocateMem totalLen
  mstore (fromIntegral ptr) (fromIntegral len)
  mstoreBytes (fromIntegral ptr + 32) bs
  liftIO $ modifyIORef' (yeMaterialized env) (M.insert name ptr)
  pure ptr

-- | Write a Yul value back to a SolidVM local, coercing to the local's
-- existing runtime shape.
writeBackSolidVM :: MonadSM m => SolidString -> Word256 -> m ()
writeBackSolidVM name val = do
  var <- getVariableOfName name
  current <- getVar var
  setVar var =<< coerceWordForWrite current val

coerceWordForWrite :: MonadSM m => Value -> Word256 -> m Value
coerceWordForWrite current val = case current of
  SInteger _ -> pure $ SInteger (toInteger val)
  SBool _ -> pure $ SBool (val /= 0)
  SBytes bs ->
    -- Preserve the Solidity byteN length. A bare SBytes with length /= 32
    -- is treated as a fixed-size slot and the low bytes of @val@ are used.
    let origLen = B.length bs
        packed = wordToBytes val
        truncated =
          if origLen == 0 || origLen == 32
            then packed
            else B.take origLen (B.drop (32 - origLen) packed)
     in pure $ SBytes truncated
  SAddress _ _ ->
    -- Truncate to 20 bytes (low 160 bits) per EVM address semantics.
    let mask = (1 `shiftL` 160) - 1 :: Integer
     in pure $ SAddress (fromInteger (toInteger val .&. mask)) False
  SNULL -> pure $ SInteger (toInteger val)
  SEnumVal k n _ -> pure $ SEnumVal k n (fromIntegral (val .&. 0xffffffff))
  other ->
    typeError
      "Yul: cannot assign to unsupported SolidVM value from assembly"
      (show other)

-- ---------------------------------------------------------------------------
-- Expressions

-- | Evaluate an expression that must produce exactly one value.
evalYulSingle :: MonadSM m => YulEnv -> CC.YulExpression -> m Word256
evalYulSingle env e = do
  xs <- evalYulMulti env e
  case xs of
    [x] -> pure x
    _ -> typeError "Yul: expression did not produce exactly one value" (show e)

-- | Evaluate an expression that may produce zero or more values.
-- Identifiers and literals always produce one; function calls may
-- produce any number depending on the function definition.
evalYulMulti :: MonadSM m => YulEnv -> CC.YulExpression -> m [Word256]
evalYulMulti env = \case
  CC.YulIdentifier _ name -> (: []) <$> lookupYul env name
  CC.YulLit _ lit -> pure [litToWord lit]
  CC.YulFunctionCall _ name args -> do
    vals <- mapM (evalYulSingle env) args
    callYulFunction env name vals

callYulFunction :: MonadSM m => YulEnv -> SolidString -> [Word256] -> m [Word256]
callYulFunction env name args = do
  mFn <- findFunction env name
  case mFn of
    Just fn -> runUserFunction env fn args
    Nothing -> evalBuiltin env name args

runUserFunction :: MonadSM m => YulEnv -> YulFunc -> [Word256] -> m [Word256]
runUserFunction env YulFunc {..} args = do
  when (length args /= length yfParams) $
    invalidArguments "Yul: user function arity mismatch" (show yfParams)
  pushScope env
  zipWithM_ (declareYul env) yfParams args
  mapM_ (\r -> declareYul env r 0) yfReturns
  _ <- runYulBody env yfBody -- a 'leave' inside becomes YulLeave which we ignore here
  scopes <- liftIO $ readIORef (yeVarScopes env)
  results <- mapM (readReturn scopes) yfReturns
  popScope env
  pure results
  where
    readReturn scopes n = case findInStack n scopes of
      Just ref -> liftIO $ readIORef ref
      Nothing -> internalError "Yul user function: return slot vanished" n

-- ---------------------------------------------------------------------------
-- Builtin dispatch
--
-- The subset below covers the arithmetic, comparison, bitwise, memory
-- and hashing opcodes. External-call and logging opcodes (CALL, LOG0..,
-- CREATE*, EXTCODE*, CHAINID, etc.) are intentionally omitted for now;
-- adding them only becomes useful once the EVM-storage bridge (step 7)
-- lands, since they all manipulate state that currently lives in
-- SolidVM's own shape.

evalBuiltin :: MonadSM m => YulEnv -> SolidString -> [Word256] -> m [Word256]
evalBuiltin _ name args = case (name, args) of
  -- Arithmetic
  ("add", [a, b]) -> one (a + b)
  ("sub", [a, b]) -> one (a - b)
  ("mul", [a, b]) -> one (a * b)
  ("div", [a, b]) -> one (if b == 0 then 0 else a `div` b)
  ("sdiv", [a, b]) -> one (signedBinOp quotSigned a b)
  ("mod", [a, b]) -> one (if b == 0 then 0 else a `mod` b)
  ("smod", [a, b]) -> one (signedBinOp remSigned a b)
  ("exp", [a, b]) -> one (a ^ toInteger b)
  ("addmod", [a, b, n]) ->
    one (if n == 0 then 0 else fromInteger ((toInteger a + toInteger b) `mod` toInteger n))
  ("mulmod", [a, b, n]) ->
    one (if n == 0 then 0 else fromInteger ((toInteger a * toInteger b) `mod` toInteger n))
  ("signextend", [b, x]) -> one (signextend b x)
  -- Comparison
  ("lt", [a, b]) -> one (boolWord (a < b))
  ("gt", [a, b]) -> one (boolWord (a > b))
  ("slt", [a, b]) -> one (boolWord (toSigned a < toSigned b))
  ("sgt", [a, b]) -> one (boolWord (toSigned a > toSigned b))
  ("eq", [a, b]) -> one (boolWord (a == b))
  ("iszero", [a]) -> one (boolWord (a == 0))
  -- Bitwise
  ("and", [a, b]) -> one (a .&. b)
  ("or", [a, b]) -> one (a .|. b)
  ("xor", [a, b]) -> one (a `xor` b)
  ("not", [a]) -> one (complement a)
  ("byte", [i, x]) -> one (byteAt i x)
  ("shl", [s, x]) -> one (if s >= 256 then 0 else x `shiftL` fromIntegral s)
  ("shr", [s, x]) -> one (if s >= 256 then 0 else x `shiftR` fromIntegral s)
  ("sar", [s, x]) -> one (sarWord s x)
  -- Memory
  ("mload", [off]) -> one =<< mload (fromIntegral off)
  ("mstore", [off, v]) -> mstore (fromIntegral off) v >> pure []
  ("mstore8", [off, v]) -> mstore8 (fromIntegral off) (fromIntegral (v .&. 0xff)) >> pure []
  ("msize", []) -> one =<< (fromIntegral <$> msize)
  -- Hash
  ("keccak256", [off, len]) -> do
    bs <- mloadBytes (fromIntegral off) (fromIntegral len)
    one $ keccak256ToWord256 (hash bs)
  -- Halt-style opcodes. We translate STOP to an empty return; REVERT
  -- throws SolidVM's standard revert path; INVALID halts with an error.
  ("stop", []) -> do
    -- Bubble up as a short-circuit via typeError-style throw is too heavy;
    -- STOP in a fragment just ends the assembly block normally.
    pure [] -- treated as a no-op within an assembly block
  ("return", [_off, _len]) ->
    todo "Yul: 'return' opcode inside assembly is not yet supported" (name :: String)
  ("revert", [_off, _len]) ->
    typeError "Yul: 'revert' opcode inside assembly" ("args=" ++ show args)
  ("invalid", []) ->
    typeError "Yul: invalid opcode executed" ("" :: String)
  -- Environment / state (deferred, see module header)
  _ ->
    todo
      ("Yul: unsupported builtin " ++ name)
      (show args)
  where
    one x = pure [x]

-- ---------------------------------------------------------------------------
-- Small helpers

litToWord :: CC.YulLiteral -> Word256
litToWord = \case
  CC.YulNumber i -> fromInteger i
  CC.YulBool b -> if b then 1 else 0
  CC.YulString s -> bytesToLeftPaddedWord (TE.encodeUtf8 (T.pack s))
  CC.YulHexString s -> bytesToLeftPaddedWord (hexDecode s)

hexDecode :: String -> BC.ByteString
hexDecode = BC.pack . go
  where
    go [] = []
    go (a : b : rest) =
      let hi = hexVal a
          lo = hexVal b
       in toEnum (hi * 16 + lo) : go rest
    go _ = [] -- malformed; parser guarantees even length
    hexVal c
      | c >= '0' && c <= '9' = fromEnum c - fromEnum '0'
      | c >= 'a' && c <= 'f' = 10 + fromEnum c - fromEnum 'a'
      | c >= 'A' && c <= 'F' = 10 + fromEnum c - fromEnum 'A'
      | otherwise = 0

bytesToLeftPaddedWord :: BC.ByteString -> Word256
bytesToLeftPaddedWord bs =
  let n = B.length bs
      taken = B.take 32 bs
      padded = taken <> BC.replicate (32 - min n 32) '\0'
   in bytesToWord padded

boolWord :: Bool -> Word256
boolWord True = 1
boolWord False = 0

-- | Interpret a 'Word256' as a two's-complement signed 'Integer' in the
-- range [-2^255, 2^255).
toSigned :: Word256 -> Integer
toSigned w =
  let i = toInteger w
      bound = 1 `shiftL` 256
      half = 1 `shiftL` 255
   in if i >= half then i - bound else i

-- | Re-encode a signed 'Integer' back into a 'Word256' via two's complement.
fromSigned :: Integer -> Word256
fromSigned i =
  let bound = 1 `shiftL` 256
   in fromInteger (i `mod` bound)

signedBinOp :: (Integer -> Integer -> Integer) -> Word256 -> Word256 -> Word256
signedBinOp _ _ 0 = 0
signedBinOp op a b = fromSigned (op (toSigned a) (toSigned b))

quotSigned :: Integer -> Integer -> Integer
quotSigned = quot

remSigned :: Integer -> Integer -> Integer
remSigned = rem

-- | @byte(i, x)@: the i-th byte of x (0-indexed from MSB). Out-of-range
-- i yields 0.
byteAt :: Word256 -> Word256 -> Word256
byteAt i x
  | i >= 32 = 0
  | otherwise =
    let shiftAmount = (31 - fromIntegral i) * 8
     in (x `shiftR` shiftAmount) .&. 0xff

-- | Arithmetic right shift treating @x@ as two's-complement signed.
sarWord :: Word256 -> Word256 -> Word256
sarWord s x
  | s >= 256 = if testBit x 255 then complement 0 else 0
  | otherwise =
    let ix = toSigned x
     in fromSigned (ix `shiftR` fromIntegral s)

-- | @signextend(b, x)@: sign-extend @x@ from byte-boundary @b+1@ bytes.
signextend :: Word256 -> Word256 -> Word256
signextend b x
  | b >= 31 = x
  | otherwise =
    let bitPos = fromIntegral b * 8 + 7 :: Int
        signBit = testBit x bitPos
        mask = (1 `shiftL` (bitPos + 1)) - 1
     in if signBit
          then x .|. complement mask
          else x .&. mask
