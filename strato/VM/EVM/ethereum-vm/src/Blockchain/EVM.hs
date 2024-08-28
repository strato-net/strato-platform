{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
--EVM is deprecated so these are added
{-# OPTIONS_GHC -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

module Blockchain.EVM
  ( runCodeFromStart,
    call,
    create,
  )
where

import BlockApps.Logging
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.ModifyStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.ExecResults
import Blockchain.Data.Log
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EVM.Code
import Blockchain.EVM.Environment
import Blockchain.EVM.Memory
import qualified Blockchain.EVM.MutableStack as MS
import Blockchain.EVM.OpcodePrices
import Blockchain.EVM.Opcodes
import Blockchain.EVM.PrecompiledContracts
import Blockchain.EVM.VMM
import Blockchain.EVM.VMState
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Util
import qualified Blockchain.Stream.Action as Action
import Blockchain.VM.VMException
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.VMOptions
import Clockwork
import Control.Arrow ((&&&))
import Control.DeepSeq
import Control.Lens (mapped, (%~), (.~), (^.))
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Extra
import Control.Monad.IO.Class
import Control.Monad.Reader
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Short as BSS
import qualified Data.Map.Ordered as OMap
import Data.Char
import Data.Data
import Data.Foldable (traverse_)
import Data.Function
import Data.IORef.Unboxed
import Data.Int
import qualified Data.IntSet as I
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Time.Clock.POSIX
import Numeric
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
import Text.Tools
import UnliftIO
import Prelude hiding (EQ, GT, LT)
import qualified Prelude as Ordering (Ordering (..))

type EVMBase m = VMBase m

bool2Word256 :: Bool -> Word256
bool2Word256 True = 1
bool2Word256 False = 0

word256ToWidth :: Word256 -> Int
word256ToWidth = fromInteger . toInteger . max 256

{-
word2562Bool::Word256->Bool
word2562Bool 1 = True
word2562Bool _ = False
-}

safeTake :: Word256 -> B.ByteString -> B.ByteString
safeTake i _ | i > 0x7fffffffffffffff = error "error in call to safeTake: string too long"
safeTake i s | i > fromIntegral (B.length s) = s `B.append` B.replicate (fromIntegral i - B.length s) 0
safeTake i s = B.take (fromIntegral i) s

safeDrop :: Word256 -> B.ByteString -> B.ByteString
safeDrop i s | i > fromIntegral (B.length s) = B.empty
safeDrop i _ | i > 0x7fffffffffffffff = error "error in call to safeDrop: string too long"
safeDrop i s = B.drop (fromIntegral i) s

binaryAction :: EVMBase m => (Word256 -> Word256 -> Word256) -> VMM m ()
binaryAction act = do
  x <- pop
  y <- pop
  push $ x `act` y

unaryAction :: EVMBase m => (Word256 -> Word256) -> VMM m ()
unaryAction act = do
  x <- pop
  push $ act x

pushEnvVar :: (EVMBase m, Word256Storable a) => (Environment -> a) -> VMM m ()
pushEnvVar f = do
  VMState {environment = env} <- vmstateGet
  push $ f env

logN :: EVMBase m => Int -> VMM m ()
logN n = do
  guardStorage
  offset <- pop
  theSize <- pop
  owner <- getEnvVar envOwner
  topics' <- sequence $ replicate n pop

  theData <- mLoadByteString offset theSize
  addLog Log {account = owner, bloom = 0, logData = theData, topics = topics'} -- TODO(dustin): Fix bloom filter

guardStorage :: EVMBase m => VMM m ()
guardStorage = do
  w <- writable <$> vmstateGet
  when (not w) (throwIO WriteProtection)

s256ToInteger :: Word256 -> Integer
--s256ToInteger i | i < 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF = toInteger i
s256ToInteger i | i < 0x8000000000000000000000000000000000000000000000000000000000000000 = toInteger i
s256ToInteger i = toInteger i - 0x10000000000000000000000000000000000000000000000000000000000000000

getByte :: Word256 -> Word256 -> Word256
getByte whichByte val | whichByte < 32 = val `shiftR` (8 * (31 - fromIntegral whichByte)) .&. 0xFF
getByte _ _ = 0

signExtend :: Word256 -> Word256 -> Word256
signExtend numBytes val | numBytes > 31 = val
signExtend numBytes val = baseValue + if highBitSet then highFilter else 0
  where
    lowFilter = 2 ^ (8 * numBytes + 8) - 1
    highFilter = (2 ^ (256 :: Integer) - 1) - lowFilter
    baseValue = lowFilter .&. val
    highBitSet = val `shiftR` (8 * fromIntegral numBytes + 7) .&. 1 == 1

safe_quot :: Integral a => a -> a -> a
safe_quot _ 0 = 0
safe_quot x y = x `quot` y

safe_mod :: Integral a => a -> a -> a
safe_mod _ 0 = 0
safe_mod x y = x `mod` y

safe_rem :: Integral a => a -> a -> a
safe_rem _ 0 = 0
safe_rem x y = x `rem` y

--For some strange reason, some ethereum tests (the VMTests) create an account when it doesn't
--exist....  This is a hack to mimic this behavior.
accountCreationHack :: EVMBase m => Account -> VMM m ()
accountCreationHack account = do
  exists <- isJust <$> A.lookup (A.Proxy @AddressState) account
  when (not exists) $ do
    vmState <- vmstateGet
    when (not $ isNothing $ debugCallCreates vmState) $
      A.insert (A.Proxy @AddressState) account blankAddressState

getBlockHashWithNumber :: EVMBase m => Integer -> Keccak256 -> VMM m (Maybe Keccak256)
getBlockHashWithNumber num h = do
  $logInfoS "getBlockHashWithNumber" . T.pack $ "calling getBSum with " ++ format h
  bSum <- getBSum h
  case num `compare` bSumNumber bSum of
    Ordering.LT -> getBlockHashWithNumber num $ bSumParentHash bSum
    Ordering.EQ -> return $ Just h
    Ordering.GT -> return Nothing

{-
  | num == bSumNumber b = return $ Just b
getBlockHashWithNumber num b | num > bSumNumber b = return Nothing
getBlockHashWithNumber num b = do
  parentBlock <- getBSum $ bSumParentHash b
  getBlockWithNumber num $
    fromMaybe (error "missing parent block in call to getBlockWithNumber") parentBlock
-}

--TODO- This really should be in its own monad!
--The monad should manage everything in the VM and environment (extending the ContextM), and have pop and push operations, perhaps even automating pc incrementing, gas charges, etc.
--The code would simplify greatly, but I don't feel motivated to make the change now since things work.

runOperation :: EVMBase m => Operation -> VMM m ()
runOperation STOP = setDone True
runOperation ADD = binaryAction (+)
runOperation MUL = binaryAction (*)
runOperation SUB = binaryAction (-)
runOperation DIV = binaryAction safe_quot
runOperation SDIV = binaryAction ((fromIntegral .) . safe_quot `on` s256ToInteger)
runOperation MOD = binaryAction safe_mod
runOperation SMOD = binaryAction ((fromIntegral .) . safe_rem `on` s256ToInteger) --EVM mod corresponds to Haskell rem....  mod and rem only differ in how they handle negative numbers
runOperation ADDMOD = do
  v1 :: Word256 <- pop
  v2 :: Word256 <- pop
  modVal :: Word256 <- pop

  push $ (toInteger v1 + toInteger v2) `safe_mod` toInteger modVal
runOperation MULMOD = do
  v1 :: Word256 <- pop
  v2 :: Word256 <- pop
  modVal :: Word256 <- pop

  let ret = (toInteger v1 * toInteger v2) `safe_mod` toInteger modVal
  push ret
runOperation EXP = binaryAction (^)
runOperation SIGNEXTEND = binaryAction signExtend
runOperation NEG = unaryAction negate
runOperation LT = binaryAction ((bool2Word256 .) . (<))
runOperation GT = binaryAction ((bool2Word256 .) . (>))
runOperation SLT = binaryAction ((bool2Word256 .) . ((<) `on` s256ToInteger))
runOperation SGT = binaryAction ((bool2Word256 .) . ((>) `on` s256ToInteger))
runOperation EQ = binaryAction ((bool2Word256 .) . (==))
runOperation ISZERO = unaryAction (bool2Word256 . (== 0))
runOperation AND = binaryAction (.&.)
runOperation OR = binaryAction (.|.)
runOperation XOR = binaryAction xor
runOperation NOT = unaryAction (0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF `xor`)
runOperation BYTE = binaryAction getByte
runOperation SHL = binaryAction $ \positions pattern ->
  shiftL pattern (word256ToWidth positions)
runOperation SHR = binaryAction $ \positions pattern ->
  shiftR pattern (word256ToWidth positions)
runOperation SAR = binaryAction $ \positions pattern ->
  fromInteger $ shiftR (s256ToInteger pattern) (word256ToWidth positions)
runOperation SHA3 = do
  p <- pop
  size <- pop
  theData <- unsafeSliceByteString p size
  let theHash = hash theData
  push $ keccak256ToWord256 theHash
runOperation ADDRESS = pushEnvVar $ _accountAddress . envOwner
runOperation BALANCE = do
  address <- pop
  account <- Account address <$> getEnvVar envChainId
  exists <- isJust <$> A.lookup (A.Proxy @AddressState) account
  if exists
    then
      push =<< addressStateBalance
        <$> A.lookupWithDefault (A.Proxy @AddressState) account
    else do
      accountCreationHack account --needed hack to get the tests working
      push (0 :: Word256)
runOperation ORIGIN = pushEnvVar $ _accountAddress . envOrigin
runOperation CALLER = pushEnvVar $ _accountAddress . envSender
runOperation CALLVALUE = pushEnvVar envValue
runOperation CALLDATALOAD = do
  p <- pop
  d <- getEnvVar envInputData

  let val = bytes2Integer $ appendZerosTo32 $ B.unpack $ B.take 32 $ safeDrop p $ d
  push val
  where
    appendZerosTo32 x | length x < 32 = x ++ replicate (32 - length x) 0
    appendZerosTo32 x = x
runOperation CALLDATASIZE = pushEnvVar (B.length . envInputData)
runOperation CALLDATACOPY = do
  memP <- pop
  codeP <- pop
  size <- pop
  d <- getEnvVar envInputData

  mStoreByteString memP $ safeTake size $ safeDrop codeP $ d
runOperation CODESIZE = pushEnvVar (codeLength . envCode)
runOperation CODECOPY = do
  memP <- pop
  codeP <- pop
  size <- pop
  code <- getEnvVar envCode
  let c = case code of
        Code c' -> c'
        PtrToCode _ -> ""

  mStoreByteString memP $ safeTake size $ safeDrop codeP $ c
runOperation GASPRICE = pushEnvVar envGasPrice
runOperation EXTCODESIZE = do
  address <- pop
  account <- Account address <$> getEnvVar envChainId
  accountCreationHack account --needed hack to get the tests working
  codeHash <-
    addressStateCodeHash
      <$> A.lookupWithDefault (A.Proxy @AddressState) account
  code <- getExternallyOwned' codeHash
  push $ (fromIntegral (B.length code) :: Word256)
runOperation EXTCODECOPY = do
  address <- pop
  account <- Account address <$> getEnvVar envChainId
  accountCreationHack account --needed hack to get the tests working
  memOffset <- pop
  codeOffset <- pop
  size <- pop

  codeHash <-
    addressStateCodeHash
      <$> A.lookupWithDefault (A.Proxy @AddressState) account
  code <- getExternallyOwned' codeHash
  mStoreByteString memOffset (safeTake size $ safeDrop codeOffset $ code)
runOperation RETURNDATASIZE = do
  ret <- getReturnVal
  let len = (fromIntegral . B.length $ ret) :: Word256
  push len
runOperation RETURNDATACOPY = do
  memP <- pop
  codeP <- pop
  size <- pop
  ret <- getReturnVal
  mStoreByteString memP . safeTake size . safeDrop codeP $ ret
runOperation BLOCKHASH = do
  number' :: Word256 <- pop

  curBlock <- getEnvVar envBlockHeader
  let currentBlockNumber = number curBlock

  let inRange =
        not $
          toInteger number' >= currentBlockNumber
            || toInteger number' < currentBlockNumber - 256

  vmState <- vmstateGet

  case (inRange, isRunningTests vmState) of
    (False, _) -> push (0 :: Word256)
    (True, False) -> do
      maybeBlockHash <- getBlockHashWithNumber (fromIntegral number') (parentHash curBlock)
      case maybeBlockHash of
        Nothing -> push (0 :: Word256)
        Just theBlockHash -> push theBlockHash
    (True, True) -> do
      let h = hash $ BC.pack $ show $ toInteger number'
      push $ keccak256ToWord256 h
runOperation COINBASE = pushEnvVar (const $ Address 0) -- (beneficiary . envBlockHeader) -- TODO: fix?
runOperation TIMESTAMP = do
  VMState {environment = env} <- vmstateGet
  push $ ((round . utcTimeToPOSIXSeconds . timestamp . envBlockHeader) env :: Word256)
runOperation NUMBER = pushEnvVar (number . envBlockHeader)
runOperation DIFFICULTY = pushEnvVar (difficulty . envBlockHeader)
runOperation GASLIMIT = pushEnvVar (gasLimit . envBlockHeader)
runOperation POP = do
  _ :: Word256 <- pop
  return ()
runOperation LOG0 = logN 0
runOperation LOG1 = logN 1
runOperation LOG2 = logN 2
runOperation LOG3 = logN 3
runOperation LOG4 = logN 4
runOperation MLOAD = do
  p <- pop
  bytes <- mLoad p
  push $! bytesToWord256 bytes
runOperation MSTORE = do
  p <- pop
  val <- pop
  mStore p val
runOperation MSTORE8 = do
  p <- pop
  val :: Word256 <- pop
  mStore8 p $! fastWord256LSB val
runOperation SLOAD = do
  p <- pop
  val <- getStorageKeyVal p
  push val
runOperation SSTORE = do
  guardStorage
  p <- pop
  val :: Word256 <- pop

  putStorageKeyVal p val --putStorageKeyVal will delete value if val=0
  owner <- getEnvVar envOwner
  let ins = \case
        Action.EVMDiff m -> Action.EVMDiff $ M.insert p val m
        _ -> error "SolidVM Diff executing in EVM"
  vmstateModify $ action . Action.actionData . Action.omapLens owner . mapped . Action.actionDataStorageDiffs %~ ins

--TODO- refactor so that I don't have to use this -1 hack
runOperation JUMP = do
  p <- pop
  jumpDests <- getEnvVar envJumpDests
  let pInt = fromIntegral . min p $ (0xffffffffffffffff :: Word256)
  if pInt `I.member` jumpDests
    then setPC $ pInt - 1 -- Subtracting 1 to compensate for the pc-increment that occurs every step.
    else throwIO InvalidJump
runOperation JUMPI = do
  p <- pop
  condition <- pop
  jumpDests <- getEnvVar envJumpDests
  let pInt = fromIntegral . min p $ (0xffffffffffffffff :: Word256)
  case (pInt `I.member` jumpDests, (0 :: Word256) /= condition) of
    (_, False) -> return ()
    (True, _) -> setPC $ pInt - 1
    _ -> throwIO InvalidJump
runOperation PC = push =<< readPC =<< vmstateGet
runOperation MSIZE = do
  memSize <- getSizeInBytes
  push memSize
runOperation GAS = push =<< readGasRemaining =<< vmstateGet
runOperation JUMPDEST = return ()
runOperation (PUSH vals) = push vals
runOperation DUP1 = dupn 1
runOperation DUP2 = dupn 2
runOperation DUP3 = dupn 3
runOperation DUP4 = dupn 4
runOperation DUP5 = dupn 5
runOperation DUP6 = dupn 6
runOperation DUP7 = dupn 7
runOperation DUP8 = dupn 8
runOperation DUP9 = dupn 9
runOperation DUP10 = dupn 10
runOperation DUP11 = dupn 11
runOperation DUP12 = dupn 12
runOperation DUP13 = dupn 13
runOperation DUP14 = dupn 14
runOperation DUP15 = dupn 15
runOperation DUP16 = dupn 16
runOperation SWAP1 = swapn 1
runOperation SWAP2 = swapn 2
runOperation SWAP3 = swapn 3
runOperation SWAP4 = swapn 4
runOperation SWAP5 = swapn 5
runOperation SWAP6 = swapn 6
runOperation SWAP7 = swapn 7
runOperation SWAP8 = swapn 8
runOperation SWAP9 = swapn 9
runOperation SWAP10 = swapn 10
runOperation SWAP11 = swapn 11
runOperation SWAP12 = swapn 12
runOperation SWAP13 = swapn 13
runOperation SWAP14 = swapn 14
runOperation SWAP15 = swapn 15
runOperation SWAP16 = swapn 16
runOperation CREATE = do
  guardStorage
  value :: Word256 <- pop
  input <- pop
  size <- pop

  owner <- getEnvVar envOwner
  block <- getEnvVar envBlockHeader

  initCodeBytes <- unsafeSliceByteString input size

  vmState <- vmstateGet

  callDepth <- getCallDepth

  result <-
    case (callDepth > 1023, debugCallCreates vmState) of
      (True, _) -> return Nothing
      (_, Nothing) -> create_debugWrapper block owner value initCodeBytes
      (_, Just _) -> do
        (nonce, balance) <-
          (addressStateNonce &&& addressStateBalance)
            <$> A.lookupWithDefault (A.Proxy @AddressState) owner

        let newAddress = getNewAddress_unsafe (owner ^. accountAddress) nonce

        if balance < fromIntegral value
          then return Nothing
          else do
            --addToBalance' owner (-fromIntegral value)
            gr <- liftIO . readGasRemaining $ vmState
            addDebugCallCreate
              DebugCallCreate
                { ccData = initCodeBytes,
                  ccDestination = Nothing,
                  ccGasLimit = gr,
                  ccValue = fromIntegral value
                }
            return . Just $ (accountAddress .~ newAddress) owner

  case result of
    Just account -> push $ account ^. accountAddress
    Nothing -> push (0 :: Word256)
runOperation CALL = do
  gas' :: Word256 <- pop
  gas <- downcastGas gas'
  to' <- pop
  value :: Word256 <- pop
  when (value /= 0) guardStorage
  inOffset <- pop
  inSize <- pop
  outOffset <- pop
  outSize :: Word256 <- pop

  owner <- getEnvVar envOwner
  let to = (accountAddress .~ to') owner

  inputData <- unsafeSliceByteString inOffset inSize
  _ <- unsafeSliceByteString outOffset outSize --needed to charge for memory
  vmState <- vmstateGet

  let stipend = if value > 0 then fromIntegral gCALLSTIPEND else 0

  balance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy @AddressState) owner

  callDepth <- getCallDepth

  (result, maybeBytes) <-
    case (callDepth > 1023, fromIntegral value > balance, debugCallCreates vmState) of
      (True, _, _) -> do
        $logInfoS "runOp/CALL" . T.pack $ CL.red "Call stack too deep."
        addGas stipend
        addGas gas
        return (0, Nothing)
      (_, True, _) -> do
        $logInfoS "runOp/CALL" . T.pack $ CL.red "Not enough ether to transfer the value."
        addGas $ fromIntegral $ gas + fromIntegral stipend
        return (0, Nothing)
      (_, _, Nothing) -> do
        nestedRun_debugWrapper False (fromIntegral gas + stipend) to to owner value inputData
      (_, _, Just _) -> do
        addGas $ fromIntegral stipend
        --addToBalance' owner (-fromIntegral value)
        addGas $ fromIntegral gas
        addDebugCallCreate
          DebugCallCreate
            { ccData = inputData,
              ccDestination = Just to,
              ccGasLimit = fromIntegral gas + stipend,
              ccValue = fromIntegral value
            }
        return (1, Nothing)

  case maybeBytes of
    Nothing -> return ()
    Just bytes -> mStoreByteString outOffset $ B.take (fromIntegral outSize) $ BSS.fromShort bytes

  push result
runOperation CALLCODE = do
  gas' :: Word256 <- pop
  gas <- downcastGas gas'
  to' <- pop
  value :: Word256 <- pop
  inOffset <- pop
  inSize <- pop
  outOffset <- pop
  outSize :: Word256 <- pop

  owner <- getEnvVar envOwner
  let to = (accountAddress .~ to') owner

  inputData <- unsafeSliceByteString inOffset inSize
  _ <- unsafeSliceByteString outOffset outSize --needed to charge for memory
  vmState <- vmstateGet

  let stipend = if value > 0 then fromIntegral gCALLSTIPEND else 0

  --  toAddressExists <- addressStateExists to

  --  let newAccountCost = if not toAddressExists then gCALLNEWACCOUNT else 0

  --  useGas $ fromIntegral newAccountCost

  balance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy @AddressState) owner

  callDepth <- getCallDepth

  (result, maybeBytes) <-
    case (callDepth > 1023, fromIntegral value > balance, debugCallCreates vmState) of
      (True, _, _) -> do
        addGas $ fromIntegral gas
        return (0, Nothing)
      (_, True, _) -> do
        addGas $ fromIntegral gas
        addGas $ fromIntegral stipend
        when flags_debug $ $logInfoS "runOp/CALLCODE" $ T.pack $ CL.red "Insufficient balance"
        return (0, Nothing)
      (_, _, Nothing) -> do
        nestedRun_debugWrapper False (fromIntegral gas + stipend) owner to owner value inputData
      (_, _, Just _) -> do
        --addToBalance' owner (-fromIntegral value)
        addGas $ fromIntegral stipend
        addGas $ fromIntegral gas
        addDebugCallCreate
          DebugCallCreate
            { ccData = inputData,
              ccDestination = Just owner,
              ccGasLimit = fromIntegral gas + stipend,
              ccValue = fromIntegral value
            }
        return (1, Nothing)

  case maybeBytes of
    Nothing -> return ()
    Just bytes -> mStoreByteString outOffset $ B.take (fromIntegral outSize) $ BSS.fromShort bytes

  push result
runOperation RETURN = do
  address <- pop
  size <- pop

  --retVal <- mLoadByteString address size
  retVal <- unsafeSliceByteString address size

  setDone True
  setReturnVal $ Just retVal
runOperation DELEGATECALL = do
  isHomestead <- vmIsHomestead <$> vmstateGet

  if isHomestead
    then do
      gas :: Word256 <- pop
      to' <- pop
      inOffset <- pop
      inSize <- pop
      outOffset <- pop
      outSize :: Word256 <- pop

      owner <- getEnvVar envOwner
      let to = (accountAddress .~ to') owner
      sender <- getEnvVar envSender

      inputData <- unsafeSliceByteString inOffset inSize

      value <- getEnvVar envValue

      _ <- unsafeSliceByteString outOffset outSize --needed to charge for memory
      vmState <- vmstateGet

      callDepth <- getCallDepth

      (result, maybeBytes) <-
        case (callDepth > 1023, debugCallCreates vmState) of
          (True, _) -> do
            addGas $ fromIntegral gas
            return (0, Nothing)
          (_, Nothing) -> do
            nestedRun_debugWrapper True (fromIntegral gas) owner to sender (fromIntegral value) inputData
          (_, Just _) -> do
            --addToBalance' owner (-fromIntegral value)
            addGas $ fromIntegral gas
            addDebugCallCreate
              DebugCallCreate
                { ccData = inputData,
                  ccDestination = Just $ owner,
                  ccGasLimit = fromIntegral gas,
                  ccValue = fromIntegral value
                }
            return (1, Nothing)

      case maybeBytes of
        Nothing -> return ()
        Just bytes -> mStoreByteString outOffset $ B.take (fromIntegral outSize) $ BSS.fromShort bytes

      push result
    else do
      let MalformedOpcode opcode = DELEGATECALL
      when flags_debug $ $logInfoS "runOp/DELEGATECALL" . T.pack $ CL.red ("Malformed Opcode: " ++ showHex opcode "")
      throwIO MalformedOpcodeException
runOperation STATICCALL = do
  gas :: Word256 <- pop
  to :: Word256 <- pop
  push (0 :: Word256)
  push to
  push gas
  localState (\vms -> vms {writable = False}) $ runOperation CALL
runOperation REVERT = do
  address <- pop
  size <- pop
  retVal <- unsafeSliceByteString address size
  stateAfter <- vmstateGet
  gasAfter <- liftIO $ readGasRemaining stateAfter
  throwIO $ RevertException gasAfter retVal
runOperation INVALID = throwIO InvalidInstruction
runOperation SUICIDE = do
  guardStorage
  address' <- pop
  owner <- getEnvVar envOwner
  let address = (accountAddress .~ address') owner
  A.adjustWithDefault_ (A.Proxy @AddressState) owner $ \addressState -> do
    let allFunds = addressStateBalance addressState
    pay' "transferring all funds upon suicide" owner address allFunds
    return addressState {addressStateBalance = 0} --yellowpaper needs address emptied, in the case that the transfer address is the same as the suicide one
  addSuicideList owner
  setDone True
runOperation (MalformedOpcode opcode) = do
  when flags_debug $ $logInfoS "runOp/MalformedOpcode" . T.pack $ CL.red ("Malformed Opcode: " ++ showHex opcode "")
  $logInfoS "runOperation/malformed" . T.pack $ show opcode
  throwIO MalformedOpcodeException
runOperation x = error $ "Missing case in runOperation: " ++ show x

-------------------

opGasPriceAndRefund :: EVMBase m => Operation -> VMM m (Gas, Gas)
opGasPriceAndRefund LOG0 = do
  size :: Word256 <- getStackItem 1
  return (gLOG + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund LOG1 = do
  size :: Word256 <- getStackItem 1
  return (gLOG + gLOGTOPIC + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund LOG2 = do
  size :: Word256 <- getStackItem 1
  return (gLOG + 2 * gLOGTOPIC + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund LOG3 = do
  size :: Word256 <- getStackItem 1
  return (gLOG + 3 * gLOGTOPIC + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund LOG4 = do
  size :: Word256 <- getStackItem 1
  return (gLOG + 4 * gLOGTOPIC + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund SHA3 = do
  size :: Word256 <- getStackItem 1
  return (30 + 6 * ceiling (fromIntegral size / (32 :: Double)), 0)
opGasPriceAndRefund EXP = do
  e :: Word256 <- getStackItem 1
  if e == 0
    then return (gEXPBASE, 0)
    else return (gEXPBASE + gEXPBYTE * bytesNeeded e, 0)
  where
    bytesNeeded :: Word256 -> Gas
    bytesNeeded 0 = 0
    bytesNeeded x = 1 + bytesNeeded (x `shiftR` 8)
opGasPriceAndRefund CALL = do
  gas :: Word256 <- getStackItem 0
  to :: Word256 <- getStackItem 1
  val :: Word256 <- getStackItem 2

  toAcct <- Account (Address $ fromIntegral to) <$> getEnvVar envChainId

  toAccountExists <- isJust <$> A.lookup (A.Proxy @AddressState) toAcct

  self <- getEnvVar envOwner -- if an account being created calls itself, the go client doesn't charge the gCALLNEWACCOUNT fee, so we need to check if that case is occurring here
  return $
    ( fromIntegral gas
        + fromIntegral gCALL
        + (if toAccountExists || toAcct == self then 0 else fromIntegral gCALLNEWACCOUNT)
        +
        --                       (if toAccountExists || to < 5 then 0 else gCALLNEWACCOUNT) +
        (if val > 0 then fromIntegral gCALLVALUETRANSFER else 0),
      0
    )
opGasPriceAndRefund CALLCODE = do
  gas :: Word256 <- getStackItem 0
  --  to :: Word256 <- getStackItem 1
  val :: Word256 <- getStackItem 2

  --  toAccountExists <- addressStateExists $ Address $ fromIntegral to

  return
    ( fromIntegral gas
        + gCALL
        +
        --(if toAccountExists then 0 else gCALLNEWACCOUNT) +
        (if val > 0 then fromIntegral gCALLVALUETRANSFER else 0),
      0
    )
opGasPriceAndRefund DELEGATECALL = do
  gas :: Word256 <- getStackItem 0
  return (fromIntegral gas + gCALL, 0)
opGasPriceAndRefund CODECOPY = do
  size :: Word256 <- getStackItem 2
  return (gCODECOPYBASE + gCOPYWORD * ceiling (fromIntegral size / (32 :: Double)), 0)
opGasPriceAndRefund CALLDATACOPY = do
  size :: Word256 <- getStackItem 2
  return (gCALLDATACOPYBASE + gCOPYWORD * ceiling (fromIntegral size / (32 :: Double)), 0)
opGasPriceAndRefund EXTCODECOPY = do
  size :: Word256 <- getStackItem 3
  return (gEXTCODECOPYBASE + gCOPYWORD * ceiling (fromIntegral size / (32 :: Double)), 0)
opGasPriceAndRefund RETURNDATACOPY = do
  size :: Word256 <- getStackItem 3
  return (gRETURNDATACOPYBASE + gCOPYWORD * ceiling (fromIntegral size / (32 :: Double)), 0)
opGasPriceAndRefund SSTORE = do
  p <- getStackItem 0
  val <- getStackItem 1
  oldVal <- getStorageKeyVal p
  case (oldVal, val) of
    (0, x) | x /= (0 :: Word256) -> return (20000, 0)
    (x, 0) | x /= 0 -> return (5000, 15000)
    _ -> return (5000, 0)
opGasPriceAndRefund SUICIDE = do
  owner <- getEnvVar envOwner
  currentSuicideList <- suicideList <$> vmstateGet
  if owner `S.member` currentSuicideList
    then return (0, 0)
    else return (0, 24000)

{-opGasPriceAndRefund RETURN = do
  size <- getStackItem 1

  return (gTXDATANONZERO*size, 0)-}

opGasPriceAndRefund x = return (opGasPrice x, 0)

--missing stuff
--Glog 1 Partial payment for a LOG operation.
--Glogdata 1 Paid for each byte in a LOG operation’s data.
--Glogtopic 1 Paid for each topic of a LOG operation.

formatOp :: Operation -> String
formatOp (PUSH x) = "PUSH " ++ show x
formatOp x = show x

printTrace :: EVMBase m => Operation -> Gas -> CodePointer -> VMState -> VMM m ()
--printDebugInfo env memBefore memAfter c op stateBefore stateAfter = do
printTrace op gasBefore pcBefore stateAfter = do
  --CPP style trace
  {-  logInfoN $ "EVM [ eth | " ++ show (callDepth stateBefore) ++ " | " ++ formatAddressWithoutColor (envOwner env) ++ " | #" ++ show c ++ " | " ++ map toUpper (showHex4 (pc stateBefore)) ++ " : " ++ formatOp op ++ " | " ++ show (vmGasRemaining stateBefore) ++ " | " ++ show (vmGasRemaining stateAfter - vmGasRemaining stateBefore) ++ " | " ++ show(fromIntegral memAfter - fromIntegral memBefore) ++ "x32 ]"
    logInfoN $ "EVM [ eth ] "-}

  --GO style trace
  gasAfter <- liftIO $ readGasRemaining stateAfter
  $logInfoS "printTrace" . T.pack $
    "PC " ++ printf "%08d" pcBefore ++ ": " ++ formatOp op
      ++ " GAS: "
      ++ show gasAfter
      ++ " COST: "
      ++ show (gasAfter - gasBefore)

  -- memByteString <- liftIO $ getMemAsByteString (memory stateAfter)
  _ <- liftIO $ getMemAsByteString (memory stateAfter)
  $logInfoS "printTrace" "    STACK"
  stackList <- liftIO . MS.toList . stack $ stateAfter
  $logInfoS "printTrace" . T.pack $ unlines (padZeros 64 <$> flip showHex "" <$> (reverse $ stackList))

--  $logInfoS "printTrace" . T.pack $ "    MEMORY\n" ++ showMem 0 (B.unpack $ memByteString)
{-
  $logInfoS "printTrace" "    STORAGE"
  kvs <- getAllStorageKeyVals
  $logInfoS "printTrace" . T.pack $ unlines (map (\(k, v) -> "0x" ++ showHexU (byteString2Integer $ nibbleString2ByteString k) ++ ": 0x" ++ showHexU (fromIntegral v)) kvs)
-}

{-
showHex4 :: Word256 -> String
showHex4 i = replicate (4 - length rawOutput) '0' ++ rawOutput
    where rawOutput = showHex i ""

showHexU :: Integer -> String
showHexU = map toUpper . flip showHex ""

showWord8::Word8->Char
showWord8 c | c >= 32 && c < 127 = w2c c
showWord8 _ = '?'

showMem::Int->[Word8]->String
showMem _ x | length x > 1000 = " mem size greater than 1000 bytes"
showMem _ [] = ""
showMem p (v1:v2:v3:v4:v5:v6:v7:v8:rest) =
    padZeros 4 (showHex p "") ++ " "
             ++ [showWord8 v1] ++ [showWord8 v2] ++ [showWord8 v3] ++ [showWord8 v4]
             ++ [showWord8 v5] ++ [showWord8 v6] ++ [showWord8 v7] ++ [showWord8 v8] ++ " "
             ++ padZeros 2 (showHex v1 "") ++ " " ++ padZeros 2 (showHex v2 "") ++ " " ++ padZeros 2 (showHex v3 "") ++ " " ++ padZeros 2 (showHex v4 "") ++ " "
             ++ padZeros 2 (showHex v5 "") ++ " " ++ padZeros 2 (showHex v6 "") ++ " " ++ padZeros 2 (showHex v7 "") ++ " " ++ padZeros 2 (showHex v8 "") ++ "\n"
             ++ showMem (p+8) rest
showMem p x = padZeros 4 (showHex p "") ++ " " ++ (showWord8 <$> x) ++ " " ++ unwords (padZeros 2 . flip showHex "" <$> x)

-}

{-# INLINE runCode #-}
runCode :: EVMBase m => VMM m ()
runCode = do
  vmState <- vmstateGet
  pcBefore <- readPC vmState
  code <- getEnvVar envCode
  let (op, len) = getOperationAt code pcBefore

  (val, theRefund) <- opGasPriceAndRefund op
  useGas val
  addToRefund theRefund

  runOperation op

  incrementPC len

runCodeClockwork :: EVMBase m => VMM m (Operation, Int64)
runCodeClockwork = do
  vmState <- vmstateGet
  pcBefore <- readPC vmState
  code <- getEnvVar envCode
  let (op, _) = getOperationAt code pcBefore
  liftIO cwBefore
  runCode
  (op,) <$> liftIO cwAfter

runCodeEVMProfile :: EVMBase m => VMM m ()
runCodeEVMProfile = whileM $ do
  (op, t) <- runCodeClockwork
  $logInfoS "runCodeEVMProfile" . T.pack $ "OPCODE: " ++ show op ++ " " ++ show t
  not <$> vmstateGets done

runCodeEVMMetrics :: EVMBase m => VMM m ()
runCodeEVMMetrics = whileM $ do
  (op, t) <- runCodeClockwork
  recordOpTiming (T.pack . showConstr . toConstr $ op) t
  not <$> vmstateGets done

runCodeSQLTrace :: EVMBase m => Int -> VMM m ()
runCodeSQLTrace !c = do
  vmState <- vmstateGet
  gasBefore <- readGasRemaining vmState
  pcBefore <- readPC vmState
  memBefore <- getSizeInWords
  code <- getEnvVar envCode
  let (op, _) = getOperationAt code pcBefore
  runCode
  gasAfter <- readGasRemaining vmState
  pcAfter <- readPC vmState
  memAfter <- getSizeInWords
  env <- vmstateGets environment
  vmTrace $
    "EVM [ eth | " ++ show (callDepth vmState)
      ++ " | "
      ++ show (envOwner env)
      ++ " | #"
      ++ show c
      ++ " | "
      ++ map toUpper (showHex pcAfter "")
      ++ " : "
      ++ formatOp op
      ++ " | "
      ++ show gasAfter
      ++ " | "
      ++ show (gasAfter - gasBefore)
      ++ " | "
      ++ show (toInteger memAfter - toInteger memBefore)
      ++ "x32 ]\n"
  unlessM (vmstateGets done) $
    runCodeSQLTrace (c + 1)

runCodeTrace :: EVMBase m => VMM m ()
runCodeTrace = whileM $ do
  vmState <- vmstateGet
  gasBefore <- readGasRemaining vmState
  pcBefore <- readPC vmState
  code <- getEnvVar envCode
  let (op, _) = getOperationAt code pcBefore
  runCode
  result <- vmstateGet
  printTrace op gasBefore pcBefore result
  not <$> vmstateGets done

runCodeFast :: EVMBase m => VMM m ()
runCodeFast = do
  runCode
  d <- vmstateGets done
  unless d $ runCodeFast

data TraceType = Fast | Trace | SQLTrace | EVMProfile | EVMMetrics deriving (Eq, Enum, Show)

parseTraceFlag :: String -> TraceType
parseTraceFlag = \case
  "false" -> Fast
  "fast" -> Fast
  "none" -> Fast
  "" -> Fast
  "trace" -> Trace
  "true" -> Trace
  "sqlTrace" -> SQLTrace
  "evmProfile" -> EVMProfile
  "evmMetrics" -> EVMMetrics
  x -> error $ "Unknown tracing format: " ++ show x

runCodeFromStart :: EVMBase m => VMM m ()
runCodeFromStart = do
  code <- getEnvVar envCode

  when flags_debug $
    $logInfoS "runCodeFromStart" . T.pack $ "running code: " ++ tab' (CL.magenta ("\n" ++ showCode 0 code))

  case parseTraceFlag flags_trace of
    Fast -> runCodeFast
    Trace -> $logInfoS "runCodeFromStart" "running traced code" >> runCodeTrace
    SQLTrace -> $logInfoS "runCodeFromStart" "running sql traced code" >> runCodeSQLTrace 0
    EVMProfile -> $logInfoS "runCodeFromStart" "running evm profiled code" >> runCodeEVMProfile
    EVMMetrics -> $logInfoS "runCodeFromStart" "running evm metrics profiled code" >> runCodeEVMMetrics

runPrecompiled :: EVMBase m => PrecompiledCode -> VMM m ()
runPrecompiled precompiled = do
  when flags_debug $
    $logInfoS "runPrecompiled" . T.pack $
      "running precompiled code: "
        ++ tab' (CL.magenta ("\n" ++ show precompiled))

  theData <- getEnvVar envInputData
  let (gas, ret) = callPrecompiledContract precompiled theData
  useGas gas
  vmstateModify $ \vmState -> vmState {returnVal = Just ret}

runVMM ::
  EVMBase m =>
  Bool ->
  Bool ->
  S.Set Account ->
  Int ->
  Environment ->
  Gas ->
  VMM m a ->
  m ExecResults
runVMM isRunningTests' isHomestead preExistingSuicideList cDepth env availableGas f =
  force <$> do
    mdbs <- Mod.get (Mod.Proxy @MemDBs)
    gasref <- liftIO . newCounter $ fromIntegral availableGas
    let fillIn v =
          v
            { callDepth = cDepth,
              vmGasRemaining = gasref,
              suicideList = preExistingSuicideList
            }
    vmStateRef <- liftIO $ newIORef . fillIn =<< startingState isRunningTests' isHomestead env mdbs
    res <- try $ runReaderT f vmStateRef

    case res of
      Left (e :: VMException) -> do
        $logInfoS "runVMM/Left" . T.pack $ CL.red $ "Exception caught (" ++ show e ++ "), reverting state"
        when flags_debug $ $logDebugS "runVMM/Left" "VM has finished running"
        let (remainingGas, retVal) = case e of
              RevertException gas ret -> (gas, Just ret)
              _ -> (0, Nothing)
        vmState <- readIORef vmStateRef
        return
          ExecResults
            { erRemainingTxGas = fromIntegral remainingGas,
              erRefund = 0,
              erReturnVal = BC.unpack . B16.encode <$> retVal,
              erTrace = theTrace vmState,
              erLogs = [],
              erEvents = [],
              erNewContractAccount = Nothing,
              erSuicideList = suicideList vmState,
              erAction = Just $ _action vmState,
              erException = Just (Right e),
              erKind = EVM,
              -- , erNewX509Certs       = M.empty
              erPragmas = [],
              erCreator = "",
              erAppName = "",
              erNewValidators = [],
              erRemovedValidators = [],
              erNewCerts = [],
              erRevokedCerts = []
            }
      Right _ -> do
        vmState'@VMState {..} <- readIORef vmStateRef
        traverse_ (uncurry (setStateDBStateRoot . snd)) . M.toList $ vmMemDBs ^. stateRoots
        putMemRawStorageTxMap $ vmMemDBs ^. storageTxMap
        putAddressStateTxDBMap $ vmMemDBs ^. stateTxMap
        when flags_debug $ $logInfoS "runVMM/Right" "VM has finished running"
        vmStateToExecResults vmState'

create ::
  EVMBase m =>
  Bool ->
  Bool ->
  S.Set Account ->
  BlockHeader ->
  Int ->
  Account ->
  Account ->
  Integer ->
  Integer ->
  Gas ->
  Account ->
  Code ->
  Keccak256 ->
  Maybe Word256 ->
  Maybe (M.Map T.Text T.Text) ->
  m ExecResults
create
  isRunningTests'
  isHomestead
  preExistingSuicideList
  b
  callDepth
  sender
  origin
  value
  gasPrice
  availableGas
  newAddress
  code
  txHash
  chainId
  metadata = do
    initCode <-
      Code <$> case code of
        Code c -> pure c
        PtrToCode cp -> do
          codeHash <- resolveCodePtr chainId cp
          fromMaybe "" <$> traverse getExternallyOwned' codeHash
    let env =
          Environment
            { envGasPrice = gasPrice,
              envBlockHeader = b,
              envOwner = newAddress,
              envOrigin = origin,
              envInputData = B.empty,
              envSender = sender,
              envValue = value,
              envCode = initCode,
              envJumpDests = getValidJUMPDESTs initCode,
              envTxHash = txHash,
              envChainId = chainId,
              envMetadata = metadata
            }

    mdbs <- Mod.get (Mod.Proxy @MemDBs)
    vmState <- liftIO $ startingState isRunningTests' isHomestead env mdbs

    success <-
      if toInteger value > 0
        then do
          --it is a statistical impossibility that a new account will be created with the same address as
          --an existing one, but the ethereum tests test this.  They want the VM to preserve balance
          --but clean out storage.
          --This will never actually matter, but I add it to pass the tests.
          A.adjustWithDefault_ (A.Proxy @AddressState) newAddress $ \newAddressState ->
            pure newAddressState {addressStateContractRoot = MP.emptyTriePtr}
          --This next line will actually create the account addressState data....
          --In the extremely unlikely even that the address already exists, it will preserve
          --the existing balance.
          pay "transfer value" sender newAddress $ fromIntegral value
        else return True

    execResults <-
      if success
        then runVMM isRunningTests' isHomestead preExistingSuicideList callDepth env availableGas create'
        else do
          execResults <- vmStateToExecResults vmState
          return execResults {erException = Just $ Right InsufficientFunds}
    case erException execResults of
      Just e -> do
        --if there was an error, addressStates were reverted, so the receiveAddress still should
        --have the value, and I can revert without checking for success.
        _ <- pay "revert value transfer" newAddress sender (fromIntegral value)

        purgeStorageMap newAddress
        A.delete (A.Proxy @AddressState) newAddress
        -- Need to zero gas in the case of an exception.
        return execResults {erRemainingTxGas = 0, erException = Just e}
      Nothing -> do
        return execResults {erNewContractAccount = Just newAddress}

create' :: EVMBase m => VMM m Code
create' = do
  owner <- getEnvVar envOwner
  vmstateModify $ action . Action.actionData %~ OMap.alter insertFunc owner

  runCodeFromStart

  vmState <- vmstateGet

  let codeBytes = fromMaybe B.empty $ returnVal vmState
  vmstateModify $ action . Action.actionData . Action.omapLens owner . mapped . Action.actionDataCodeHash .~ ExternallyOwned (hash codeBytes)
  when flags_debug $ $logInfoS "create'" . T.pack $ "Result: " ++ show codeBytes

  -- this used to say "not enough ether, but im pretty sure it meant gas -io
  gr <- getGasRemaining
  $logInfoS "create'" "Trying to create contract"
  $logInfoS "create'" . T.pack $ "The amount of ether you need: " ++ show (gCREATEDATA * fromIntegral (B.length codeBytes))
  $logInfoS "create'" . T.pack $ "The amount of ether you have: " ++ show gr

  if (not $ vmIsHomestead vmState) && (gr < gCREATEDATA * fromIntegral (B.length codeBytes))
    then do
      $logInfoS "create'/lowGas" . T.pack $ CL.red "Not enough gas to create contract, contract being thrown away (account was created though)"
      $logInfoS "create'/lowGas" . T.pack $ "The amount of gas you need: " ++ show (gCREATEDATA * fromIntegral (B.length codeBytes))
      $logInfoS "create'/lowGas" . T.pack $ "The amount of gas you have: " ++ show gr
      vmstatePut vmState {returnVal = Nothing}
      assignCode "" owner
      assignDetails
      return $ Code ""
    else do
      useGas $ gCREATEDATA * fromIntegral (B.length codeBytes)
      assignCode codeBytes owner
      assignDetails
      return $ Code codeBytes
  where
    assignCode :: EVMBase m => B.ByteString -> Account -> VMM m ()
    assignCode codeBytes account = do
      hsh <- addCode EVM codeBytes
      A.adjustWithDefault_ (A.Proxy @AddressState) account $ \newAddressState ->
        pure newAddressState {addressStateCodeHash = ExternallyOwned hsh}
    assignDetails = do
      vmState <- vmstateGet
      let Environment {..} = environment vmState
      vmstateModify $
        action . Action.actionData . Action.omapLens envOwner . mapped . Action.actionDataCallTypes
          %~ (:) Action.Create

    -- insertFunc :: Maybe Action.ActionData -> Maybe Action.ActionData
    -- insertFunc _ = Just $ Action.ActionData (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0) mempty "" "" EVM (Action.EVMDiff M.empty) M.empty [] [] []

call ::
  EVMBase m =>
  Bool ->
  Bool ->
  Bool ->
  Bool ->
  S.Set Account ->
  BlockHeader ->
  Int ->
  Account ->
  Account ->
  Account ->
  Word256 ->
  Word256 ->
  B.ByteString ->
  Gas ->
  Account ->
  Keccak256 ->
  Maybe Word256 ->
  Maybe (M.Map T.Text T.Text) ->
  m ExecResults
call
  isRunningTests'
  isHomestead
  noValueTransfer
  _
  preExistingSuicideList
  b
  callDepth
  receiveAddress
  codeAddress
  sender
  value
  gasPrice
  theData
  availableGas
  origin
  txHash
  chainId
  metadata = do
    let env code =
          Environment
            { envGasPrice = fromIntegral gasPrice,
              envBlockHeader = b,
              envOwner = receiveAddress,
              envOrigin = origin,
              envInputData = theData,
              envSender = sender,
              envValue = fromIntegral value,
              envCode = code,
              envJumpDests = getValidJUMPDESTs code,
              envTxHash = txHash,
              envChainId = chainId,
              envMetadata = metadata
            }

    case getPrecompiledCode (fromIntegral $ codeAddress ^. accountAddress) of
      Just pc ->
        runVMM isRunningTests' isHomestead preExistingSuicideList callDepth (env $ Code "") availableGas $
          callPrecompiled' noValueTransfer pc
      Nothing -> do
        codeHash <-
          addressStateCodeHash
            <$> A.lookupWithDefault (A.Proxy @AddressState) codeAddress
        code <- Code <$> getExternallyOwned' codeHash
        runVMM isRunningTests' isHomestead preExistingSuicideList callDepth (env code) availableGas $
          call' noValueTransfer

call' :: EVMBase m => Bool -> VMM m B.ByteString
call' noValueTransfer = do
  value <- getEnvVar envValue
  receiveAddress <- getEnvVar envOwner
  sender <- getEnvVar envSender
  cp <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) receiveAddress
  let ch = case cp of
        ExternallyOwned x -> x
        _ -> error "internal error- the EVM was called for non-evm code"
  vmstateModify $ action . Action.actionData %~ OMap.alter (insertFunc2 ch) receiveAddress

  --TODO- Deal with this return value
  unless noValueTransfer $ do
    _ <- pay "call value transfer" sender receiveAddress (fromIntegral value)
    return ()

  runCodeFromStart

  vmState <- vmstateGet

  --when flags_debug $ liftIO $ do
  --    let result = fromMaybe B.empty $ returnVal vmState
  --    --putStrLn $ "Result: " ++ format result
  --    putStrLn $ "Gas remaining: " ++ show (vmGasRemaining vmState) ++ ", needed: " ++ show (5*toInteger (B.length result))
  --    --putStrLn $ show (pretty address) ++ ": " ++ format result
  let Environment {..} = environment vmState
  vmstateModify $
    action . Action.actionData . Action.omapLens envOwner . mapped . Action.actionDataCallTypes
      %~ (:) Action.Update

  return (fromMaybe B.empty $ returnVal vmState)
  where
    insertFunc2 :: Keccak256 -> Maybe Action.ActionData -> Maybe Action.ActionData
    insertFunc2 ch _ = Just $ Action.ActionData (ExternallyOwned $ ch) mempty "" Nothing "" "" EVM (Action.EVMDiff M.empty) M.empty [] [] []


insertFunc :: Maybe Action.ActionData -> Maybe Action.ActionData
insertFunc _ = Just $ Action.ActionData (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0) mempty "" Nothing "" "" EVM (Action.EVMDiff M.empty) M.empty [] [] []

callPrecompiled' :: EVMBase m => Bool -> PrecompiledCode -> VMM m B.ByteString
callPrecompiled' noValueTransfer precompiled = do
  value <- getEnvVar envValue
  receiveAddress <- getEnvVar envOwner
  sender <- getEnvVar envSender
  vmstateModify $ action . Action.actionData %~ OMap.alter insertFunc receiveAddress

  --TODO- Deal with this return value
  unless noValueTransfer $ do
    _ <- pay "call value transfer" sender receiveAddress (fromIntegral value)
    return ()

  runPrecompiled precompiled

  vmState <- vmstateGet

  let Environment {..} = environment vmState
  vmstateModify $
    action . Action.actionData . Action.omapLens envOwner . mapped . Action.actionDataCallTypes
      %~ (:) Action.Update

  return (fromMaybe B.empty $ returnVal vmState)

create_debugWrapper :: EVMBase m => BlockHeader -> Account -> Word256 -> B.ByteString -> VMM m (Maybe Account)
create_debugWrapper block owner value initCodeBytes = do
  balance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy @AddressState) owner

  if fromIntegral value > balance
    then return Nothing
    else do
      newAddress <- getNewAddress owner

      let initCode = Code initCodeBytes

      origin <- getEnvVar envOrigin
      gasPrice <- getEnvVar envGasPrice
      txHash <- getEnvVar envTxHash
      chainId <- getEnvVar envChainId
      metadata <- getEnvVar envMetadata

      gasRemaining <- getGasRemaining

      currentCallDepth <- getCallDepth

      currentVMState <- vmstateGet

      (execResults, finalDBs) <- lift $ do
        mdbs <- Mod.get (Mod.Proxy @MemDBs)
        Mod.put (Mod.Proxy @MemDBs) $ vmMemDBs currentVMState
        ers <-
          create
            (isRunningTests currentVMState)
            (vmIsHomestead currentVMState)
            (suicideList currentVMState)
            block
            (currentCallDepth + 1)
            owner
            origin
            (toInteger value)
            gasPrice
            gasRemaining
            newAddress
            initCode
            txHash
            chainId
            metadata
        mdbs' <- Mod.get (Mod.Proxy @MemDBs)
        Mod.put (Mod.Proxy @MemDBs) mdbs
        pure (ers, mdbs')

      traverse_ (uncurry (setStateDBStateRoot . snd)) . M.toList $ finalDBs ^. stateRoots
      putMemRawStorageTxMap $ finalDBs ^. storageTxMap
      putAddressStateTxDBMap $ finalDBs ^. stateTxMap
      setGasRemaining $ fromIntegral $ erRemainingTxGas execResults

      case erException execResults of
        Just e -> do
          when flags_debug $ $logInfoS "create_debugWrapper" $ T.pack $ CL.red $ show e
          return Nothing
        Nothing -> do
          forM_ (reverse $ erLogs execResults) addLog
          vmstateModify $ \st -> st {suicideList = erSuicideList execResults}
          vmstateModify $ action . Action.actionData %~ Action.omapUnionWith Action.mergeActionData (Action._actionData $ fromMaybe (error "internal error in VM.hs: somehow erAction was set to Nothing, this should never happen inside of the VM") $ erAction execResults)
          addToRefund $ fromIntegral $ erRefund execResults

          return $ Just newAddress

nestedRun_debugWrapper :: EVMBase m => Bool -> Gas -> Account -> Account -> Account -> Word256 -> B.ByteString -> VMM m (Int, Maybe BSS.ShortByteString)
nestedRun_debugWrapper noValueTransfer gas receiveAddress owner sender value inputData = do
  currentCallDepth <- getCallDepth

  env <- vmstateGets environment

  currentVMState <- vmstateGet

  (execResults, finalDBs) <- lift $ do
    mdbs <- Mod.get (Mod.Proxy @MemDBs)
    Mod.put (Mod.Proxy @MemDBs) $ vmMemDBs currentVMState
    ers <-
      call
        (isRunningTests currentVMState)
        (vmIsHomestead currentVMState)
        noValueTransfer
        False
        (suicideList currentVMState)
        (envBlockHeader env)
        (currentCallDepth + 1)
        receiveAddress
        owner
        sender
        value
        (fromIntegral $ envGasPrice env)
        inputData
        gas
        (envOrigin env)
        (envTxHash env)
        (envChainId env)
        (envMetadata env)
    mdbs' <- Mod.get (Mod.Proxy @MemDBs)
    Mod.put (Mod.Proxy @MemDBs) mdbs
    pure (ers, mdbs')

  traverse_ (uncurry (setStateDBStateRoot . snd)) . M.toList $ finalDBs ^. stateRoots
  putMemRawStorageTxMap $ finalDBs ^. storageTxMap
  putAddressStateTxDBMap $ finalDBs ^. stateTxMap

  case erException execResults of
    Nothing -> do
      forM_ (reverse $ erLogs execResults) addLog
      vmstateModify $ \state' -> state' {suicideList = erSuicideList execResults}
      vmstateModify $ action . Action.actionData %~ Action.omapUnionWith Action.mergeActionData (Action._actionData $ fromMaybe (error "internal error in VM.hs: somehow erAction was set to Nothing, this should never happen inside of the VM") $ erAction execResults)
      when flags_debug $
        $logInfoS "nestedRun_debugWrapper" $ T.pack $ "Refunding: " ++ show (erRemainingTxGas execResults)
      useGas $ negate $ fromIntegral $ erRemainingTxGas execResults
      addToRefund $ fromIntegral $ erRefund execResults
      let shortRet = BSS.toShort . either (const "") id . B16.decode . BC.pack <$> erReturnVal execResults
      return (1, shortRet)
    Just (Right (RevertException _ _)) -> do
      useGas $ negate $ fromIntegral $ erRemainingTxGas execResults
      when flags_debug $
        $logInfoS "nestedRun_debugWrapper" $ T.pack $ "Reverting, retval: " ++ show (erReturnVal execResults)
      addToRefund $ fromIntegral $ erRefund execResults
      let shortRet = BSS.toShort . either (const "") id . B16.decode . BC.pack <$> erReturnVal execResults
      return (0, shortRet)
    Just (Right e) -> do
      when flags_debug $ $logInfoS "nestedRun_debugWrapper" $ T.pack $ CL.red $ show e
      return (0, Nothing)
    Just (Left se) -> do
      -- Should not have a SolidException from executing the EVM
      throwIO se

vmStateToExecResults ::
  EVMBase m =>
  VMState ->
  m ExecResults
vmStateToExecResults vmState = do
  gr <- fmap fromIntegral $ readGasRemaining vmState
  ref <- fmap fromIntegral $ readRefund vmState

  return
    ExecResults
      { erRemainingTxGas = gr,
        erRefund = ref,
        -- For errors, ReturnVal is only set for RETURN and REVERT, so this must be a REVERT.
        erReturnVal = BC.unpack . B16.encode <$> returnVal vmState,
        erTrace = theTrace vmState,
        erLogs = logs vmState,
        erEvents = [],
        -- I think erNewContractAddress should be Nothing if there is an error
        erNewContractAccount = Nothing,
        erSuicideList = suicideList vmState,
        erAction = Just $ _action vmState,
        erException = Nothing,
        erKind = EVM,
        -- , erNewX509Certs       = M.empty
        erPragmas = [],
        erCreator = "",
        erAppName = "",
        erNewValidators = [],
        erRemovedValidators = [],
        erNewCerts = [],
        erRevokedCerts = []
      }

getExternallyOwned' :: HasCodeDB m => CodePtr -> m BC.ByteString
getExternallyOwned' (ExternallyOwned ch) = getExternallyOwned ch
getExternallyOwned' _ = error "internal error- the EVM was called for non-evm code"
