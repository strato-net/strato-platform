{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.VM
    ( runCodeFromStart
    , call
    , create
    ) where

import           Prelude                            hiding (EQ, GT, LT)
import qualified Prelude                            as Ordering (Ordering (..))

import           Clockwork
import           Control.DeepSeq
import           Control.Lens                       ((%=), (.=), at, mapped)
import           Control.Monad
import           Control.Monad.Extra
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.State
import           Data.Bits
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Char8              as BC
import           Data.Char
import           Data.Function
import           Data.IORef.Unboxed
import qualified Data.IntSet                        as I
import qualified Data.Map.Strict                    as M
import           Data.Maybe
import qualified Data.Set                           as S
import qualified Data.Text                          as T
import           Data.Time.Clock.POSIX
import           Numeric
import           Text.Printf



import qualified Blockchain.Colors                  as CL
import           Blockchain.Data.Action
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.Code
import           Blockchain.Data.Log
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.BlockSummaryDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.SHA
import           Blockchain.Util
import           Blockchain.VM.Code
import           Blockchain.VM.Environment
import           Blockchain.VM.Memory
import qualified Blockchain.VM.MutableStack        as MS
import           Blockchain.VM.OpcodePrices
import           Blockchain.VM.Opcodes
import           Blockchain.VM.PrecompiledContracts
import           Blockchain.VM.VMM
import           Blockchain.VM.VMState
import           Blockchain.VMContext
import           Blockchain.VMMetrics
import           Blockchain.VM.VMException
import           Blockchain.VMOptions

bool2Word256::Bool->Word256
bool2Word256 True  = 1
bool2Word256 False = 0

word256ToWidth :: Word256 -> Int
word256ToWidth = fromInteger . toInteger . max 256
{-
word2562Bool::Word256->Bool
word2562Bool 1 = True
word2562Bool _ = False
-}

binaryAction::(Word256->Word256->Word256)->VMM ()
binaryAction act = do
  x <- pop
  y <- pop
  push $ x `act` y

unaryAction::(Word256->Word256)->VMM ()
unaryAction act = do
  x <- pop
  push $ act x

pushEnvVar::Word256Storable a=>(Environment->a)->VMM ()
pushEnvVar f = do
  VMState{environment=env} <- lift get
  push $ f env

logN::Int->VMM ()
logN n = do
  guardStorage
  offset <- pop
  theSize <- pop
  owner <- getEnvVar envOwner
  topics' <- sequence $ replicate n pop

  theData <- mLoadByteString offset theSize
  addLog Log{address=owner, bloom=0, logData=theData, topics=topics'} -- TODO(dustin): Fix bloom filter

guardStorage :: VMM ()
guardStorage = do
  w <- lift $ writable <$> get
  when (not w) (throwE WriteProtection)

s256ToInteger::Word256->Integer
--s256ToInteger i | i < 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF = toInteger i
s256ToInteger i | i < 0x8000000000000000000000000000000000000000000000000000000000000000 = toInteger i
s256ToInteger i = toInteger i - 0x10000000000000000000000000000000000000000000000000000000000000000

getByte::Word256->Word256->Word256
getByte whichByte val | whichByte < 32 = val `shiftR` (8*(31 - fromIntegral whichByte)) .&. 0xFF
getByte _ _           = 0;

signExtend::Word256->Word256->Word256
signExtend numBytes val | numBytes > 31 = val
signExtend numBytes val = baseValue + if highBitSet then highFilter else 0
  where
    lowFilter = 2^(8*numBytes+8)-1
    highFilter = (2^(256::Integer)-1) - lowFilter
    baseValue = lowFilter .&. val
    highBitSet =  val `shiftR` (8*fromIntegral numBytes + 7) .&. 1 == 1

safe_quot::Integral a=>a->a->a
safe_quot _ 0 = 0
safe_quot x y = x `quot` y

safe_mod::Integral a=>a->a->a
safe_mod _ 0 = 0
safe_mod x y = x `mod` y

safe_rem::Integral a=>a->a->a
safe_rem _ 0 = 0
safe_rem x y = x `rem` y


--For some strange reason, some ethereum tests (the VMTests) create an account when it doesn't
--exist....  This is a hack to mimic this behavior.
accountCreationHack :: Address -> VMM ()
accountCreationHack address = do
  exists <- addressStateExists address
  when (not exists) $ do
    vmState <- lift get
    when (not $ isNothing $ debugCallCreates vmState) $
      putAddressState address blankAddressState



getBlockHashWithNumber::Integer->SHA->VMM (Maybe SHA)
getBlockHashWithNumber num h = do
  lift $ $logInfoS "getBlockHashWithNumber" . T.pack $ "calling getBSum with " ++ format h
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

runOperation::Operation->VMM ()
runOperation STOP = setDone True

runOperation ADD = binaryAction (+)
runOperation MUL = binaryAction (*)
runOperation SUB = binaryAction (-)
runOperation DIV = binaryAction safe_quot
runOperation SDIV = binaryAction ((fromIntegral .) . safe_quot `on` s256ToInteger)
runOperation MOD = binaryAction safe_mod
runOperation SMOD = binaryAction ((fromIntegral .) . safe_rem `on` s256ToInteger) --EVM mod corresponds to Haskell rem....  mod and rem only differ in how they handle negative numbers

runOperation ADDMOD = do
  v1 <- pop::VMM Word256
  v2 <- pop::VMM Word256
  modVal <- pop::VMM Word256

  push $ (toInteger v1 + toInteger v2) `safe_mod` toInteger modVal

runOperation MULMOD = do
  v1 <- pop::VMM Word256
  v2 <- pop::VMM Word256
  modVal <- pop::VMM Word256

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
runOperation ISZERO = unaryAction (bool2Word256 . (==0))
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
  let SHA theHash = hash theData
  push $ theHash

runOperation ADDRESS = pushEnvVar envOwner

runOperation BALANCE = do
  address <- pop
  exists <- addressStateExists address
  if exists
    then do
    addressState <- getAddressState address
    push $ addressStateBalance addressState
    else do
    accountCreationHack address --needed hack to get the tests working
    push (0::Word256)

runOperation ORIGIN = pushEnvVar envOrigin
runOperation CALLER = pushEnvVar envSender
runOperation CALLVALUE = pushEnvVar envValue

runOperation CALLDATALOAD = do
  p <- pop
  d <- getEnvVar envInputData

  let val = bytes2Integer $ appendZerosTo32 $ B.unpack $ B.take 32 $ safeDrop p $ d
  push val
    where
      appendZerosTo32 x | length x < 32 = x ++ replicate (32-length x) 0
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
  Code c <- getEnvVar envCode

  mStoreByteString memP $ safeTake size $ safeDrop codeP $ c

runOperation GASPRICE = pushEnvVar envGasPrice


runOperation EXTCODESIZE = do
  address <- pop
  accountCreationHack address --needed hack to get the tests working
  addressState <- getAddressState address
  code <- fromMaybe B.empty <$> getCode (addressStateCodeHash addressState)
  push $ (fromIntegral (B.length code)::Word256)

runOperation EXTCODECOPY = do
  address <- pop
  accountCreationHack address --needed hack to get the tests working
  memOffset <- pop
  codeOffset <- pop
  size <- pop

  addressState <- getAddressState address
  code <- fromMaybe B.empty <$> getCode (addressStateCodeHash addressState)
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
  number <- pop::VMM Word256

  currentBlock <- getEnvVar envBlockHeader
  let currentBlockNumber = blockDataNumber currentBlock

  let inRange = not $ toInteger number >= currentBlockNumber ||
                toInteger number < currentBlockNumber - 256

  vmState <- lift get

  case (inRange, isRunningTests vmState) of
   (False, _) -> push (0::Word256)
   (True, False) -> do
          maybeBlockHash <- getBlockHashWithNumber (fromIntegral number) (blockDataParentHash currentBlock)
          case maybeBlockHash of
           Nothing           -> push (0::Word256)
           Just theBlockHash -> push theBlockHash
   (True, True) -> do
          let SHA h = hash $ BC.pack $ show $ toInteger number
          push h

runOperation COINBASE = pushEnvVar (blockDataCoinbase . envBlockHeader)
runOperation TIMESTAMP = do
  VMState{environment=env} <- lift get
  push $ ((round . utcTimeToPOSIXSeconds . blockDataTimestamp . envBlockHeader) env::Word256)



runOperation NUMBER = pushEnvVar (blockDataNumber . envBlockHeader)
runOperation DIFFICULTY = pushEnvVar (blockDataDifficulty . envBlockHeader)
runOperation GASLIMIT = pushEnvVar (blockDataGasLimit .envBlockHeader)

runOperation POP = do
  _ <- pop::VMM Word256
  return ()

runOperation LOG0 = logN 0
runOperation LOG1 = logN 1
runOperation LOG2 = logN 2
runOperation LOG3 = logN 3
runOperation LOG4 = logN 4

runOperation MLOAD = do
  p <- pop
  bytes <- mLoad p
  push $! fastBytesToWord256 bytes

runOperation MSTORE = do
  p <- pop
  val <- pop
  mStore p val

runOperation MSTORE8 = do
  p <- pop
  val <- pop::VMM Word256
  mStore8 p (fastWord256LSB val)

runOperation SLOAD = do
  p <- pop
  val <- getStorageKeyVal p
  push val

runOperation SSTORE = do
  guardStorage
  p <- pop
  val <- pop::VMM Word256

  putStorageKeyVal p val --putStorageKeyVal will delete value if val=0

  owner <- getEnvVar envOwner
  (action . actionData . at owner . mapped . actionDataStorageDiffs) %= M.insert p val

--TODO- refactor so that I don't have to use this -1 hack
runOperation JUMP = do
  p <- pop
  jumpDests <- getEnvVar envJumpDests
  let pInt = fromIntegral . min p $ (0xffffffffffffffff :: Word256)
  if pInt `I.member` jumpDests
    then setPC $ pInt - 1 -- Subtracting 1 to compensate for the pc-increment that occurs every step.
    else throwE InvalidJump

runOperation JUMPI = do
  p <- pop
  condition <- pop
  jumpDests <- getEnvVar envJumpDests
  let pInt = fromIntegral . min p $ (0xffffffffffffffff :: Word256)
  case (pInt `I.member` jumpDests, (0::Word256) /= condition) of
    (_, False) -> return ()
    (True, _)  -> setPC $ pInt - 1
    _          -> throwE InvalidJump

runOperation PC = push =<< readPC =<< lift get

runOperation MSIZE = do
  memSize <- getSizeInBytes
  push memSize

runOperation GAS = push =<< readGasRemaining =<< lift get

runOperation JUMPDEST = return ()

runOperation (PUSH vals) =
  push $ (fromIntegral (bytes2Integer vals)::Word256)

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
  value <- pop::VMM Word256
  input <- pop
  size <- pop

  owner <- getEnvVar envOwner
  block <- getEnvVar envBlockHeader

  initCodeBytes <- unsafeSliceByteString input size

  vmState <- lift get

  callDepth <- getCallDepth

  result <-
    case (callDepth > 1023, debugCallCreates vmState) of
      (True, _) -> return Nothing
      (_, Nothing) -> create_debugWrapper block owner value initCodeBytes
      (_, Just _) -> do
        addressState <- getAddressState owner

        let newAddress = getNewAddress_unsafe owner $ addressStateNonce addressState

        if addressStateBalance addressState < fromIntegral value
          then return Nothing
          else do
          --addToBalance' owner (-fromIntegral value)
          gr <- liftIO . readGasRemaining $ vmState
          addDebugCallCreate DebugCallCreate {
            ccData=initCodeBytes,
            ccDestination=Nothing,
            ccGasLimit=gr,
            ccValue=fromIntegral value
            }
          return $ Just newAddress

  case result of
    Just address -> push address
    Nothing       -> push (0::Word256)

runOperation CALL = do
  gas' <- pop::VMM Word256
  gas <- downcastGas gas'
  to <- pop
  value <- pop::VMM Word256
  when (value /= 0) guardStorage
  inOffset <- pop
  inSize <- pop
  outOffset <- pop
  outSize <- pop::VMM Word256

  owner <- getEnvVar envOwner

  inputData <- unsafeSliceByteString inOffset inSize
  _ <- unsafeSliceByteString outOffset outSize --needed to charge for memory

  vmState <- lift get

  let stipend = if value > 0 then fromIntegral gCALLSTIPEND  else 0

  addressState <- getAddressState owner

  callDepth <- getCallDepth

  (result, maybeBytes) <-
    case (callDepth > 1023, fromIntegral value > addressStateBalance addressState, debugCallCreates vmState) of
      (True, _, _) -> do
        lift $ $logInfoS "runOp/CALL" . T.pack $ CL.red "Call stack too deep."
        addGas stipend
        addGas gas
        return (0, Nothing)
      (_, True, _) -> do
        lift $ $logInfoS "runOp/CALL" . T.pack $ CL.red "Not enough ether to transfer the value."
        addGas $ fromIntegral $ gas + fromIntegral stipend
        return (0, Nothing)
      (_, _, Nothing) -> do
        nestedRun_debugWrapper False (fromIntegral gas + stipend) to to owner value inputData
      (_, _, Just _) -> do
        addGas $ fromIntegral stipend
        --addToBalance' owner (-fromIntegral value)
        addGas $ fromIntegral gas
        addDebugCallCreate DebugCallCreate {
          ccData=inputData,
          ccDestination=Just to,
          ccGasLimit=fromIntegral gas + stipend,
          ccValue=fromIntegral value
          }
        return (1, Nothing)

  case maybeBytes of
    Nothing    -> return ()
    Just bytes -> mStoreByteString outOffset $ B.take (fromIntegral outSize) bytes

  push result

runOperation CALLCODE = do
  gas' <- pop::VMM Word256
  gas <- downcastGas gas'
  to <- pop
  value <- pop::VMM Word256
  inOffset <- pop
  inSize <- pop
  outOffset <- pop
  outSize <- pop::VMM Word256

  owner <- getEnvVar envOwner

  inputData <- unsafeSliceByteString inOffset inSize
  _ <- unsafeSliceByteString outOffset outSize --needed to charge for memory

  vmState <- lift get

  let stipend = if value > 0 then fromIntegral gCALLSTIPEND  else 0

--  toAddressExists <- lift $ lift $ lift $ addressStateExists to

--  let newAccountCost = if not toAddressExists then gCALLNEWACCOUNT else 0

--  useGas $ fromIntegral newAccountCost

  addressState <- getAddressState owner

  callDepth <- getCallDepth

  (result, maybeBytes) <-
    case (callDepth > 1023, fromIntegral value > addressStateBalance addressState, debugCallCreates vmState) of
      (True, _, _) -> do
        addGas $ fromIntegral gas
        return (0, Nothing)
      (_, True, _) -> do
        addGas $ fromIntegral gas
        addGas $ fromIntegral stipend
        when flags_debug $ lift $ $logInfoS "runOp/CALLCODE" $ T.pack $ CL.red "Insufficient balance"
        return (0, Nothing)
      (_, _, Nothing) -> do
        nestedRun_debugWrapper False (fromIntegral gas+stipend) owner to owner value inputData
      (_, _, Just _) -> do
        --addToBalance' owner (-fromIntegral value)
        addGas $ fromIntegral stipend
        addGas $ fromIntegral gas
        addDebugCallCreate DebugCallCreate {
          ccData=inputData,
          ccDestination=Just owner,
          ccGasLimit=fromIntegral gas + stipend,
          ccValue=fromIntegral value
          }
        return (1, Nothing)

  case maybeBytes of
    Nothing    -> return ()
    Just bytes -> mStoreByteString outOffset $ B.take (fromIntegral outSize) bytes

  push result

runOperation RETURN = do
  address <- pop
  size <- pop

  --retVal <- mLoadByteString address size
  retVal <- unsafeSliceByteString address size

  setDone True
  setReturnVal $ Just retVal

runOperation DELEGATECALL = do

  isHomestead <- fmap vmIsHomestead $ lift get

  if isHomestead
    then do
      gas <- pop::VMM Word256
      to <- pop
      inOffset <- pop
      inSize <- pop
      outOffset <- pop
      outSize <- pop::VMM Word256

      owner <- getEnvVar envOwner
      sender <- getEnvVar envSender

      inputData <- unsafeSliceByteString inOffset inSize

      value <- getEnvVar envValue

      _ <- unsafeSliceByteString outOffset outSize --needed to charge for memory

      vmState <- lift get

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
              addDebugCallCreate DebugCallCreate {
                                       ccData=inputData,
                                       ccDestination=Just $ owner,
                                       ccGasLimit=fromIntegral gas,
                                       ccValue=fromIntegral value
                                     }
              return (1, Nothing)

      case maybeBytes of
        Nothing    -> return ()
        Just bytes -> mStoreByteString outOffset $ B.take (fromIntegral outSize) bytes

      push result

    else do
      let MalformedOpcode opcode = DELEGATECALL
      when flags_debug $ lift $ $logInfoS "runOp/DELEGATECALL" . T.pack $ CL.red ("Malformed Opcode: " ++ showHex opcode "")
      throwE MalformedOpcodeException

runOperation STATICCALL = do
  gas <- pop :: VMM Word256
  to <- pop :: VMM Word256
  push (0 :: Word256)
  push to
  push gas
  localState (\vms -> vms {writable=False}) $ runOperation CALL

runOperation REVERT = do
  address <- pop
  size <- pop

  retVal <- unsafeSliceByteString address size

  setReturnVal $ Just retVal
  throwE RevertException

runOperation INVALID = throwE InvalidInstruction

runOperation SUICIDE = do
  guardStorage
  address <- pop
  owner <- getEnvVar envOwner
  addressState <- getAddressState owner

  let allFunds = addressStateBalance addressState
  pay' "transferring all funds upon suicide" owner address allFunds

  putAddressState owner addressState{addressStateBalance = 0} --yellowpaper needs address emptied, in the case that the transfer address is the same as the suicide one


  addSuicideList owner
  setDone True


runOperation (MalformedOpcode opcode) = do
  when flags_debug $ lift $ $logInfoS "runOp/MalformedOpcode" . T.pack $ CL.red ("Malformed Opcode: " ++ showHex opcode "")
  throwE MalformedOpcodeException

runOperation x = error $ "Missing case in runOperation: " ++ show x

-------------------

opGasPriceAndRefund :: Operation -> VMM (Gas, Gas)

opGasPriceAndRefund LOG0 = do
  size <- getStackItem 1::VMM Word256
  return (gLOG + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund LOG1 = do
  size <- getStackItem 1::VMM Word256
  return (gLOG + gLOGTOPIC + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund LOG2 = do
  size <- getStackItem 1::VMM Word256
  return (gLOG + 2*gLOGTOPIC + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund LOG3 = do
  size <- getStackItem 1::VMM Word256
  return (gLOG + 3*gLOGTOPIC + gLOGDATA * fromIntegral size, 0)
opGasPriceAndRefund LOG4 = do
  size <- getStackItem 1::VMM Word256
  return (gLOG + 4*gLOGTOPIC + gLOGDATA * fromIntegral size, 0)

opGasPriceAndRefund SHA3 = do
  size <- getStackItem 1::VMM Word256
  return (30+6*ceiling(fromIntegral size/(32::Double)), 0)

opGasPriceAndRefund EXP = do
    e <- getStackItem 1::VMM Word256
    if e == 0
      then return (gEXPBASE, 0)
      else return (gEXPBASE + gEXPBYTE*bytesNeeded e, 0)

    where
      bytesNeeded::Word256->Gas
      bytesNeeded 0 = 0
      bytesNeeded x = 1+bytesNeeded (x `shiftR` 8)


opGasPriceAndRefund CALL = do
  gas <- getStackItem 0::VMM Word256
  to <- getStackItem 1::VMM Word256
  val <- getStackItem 2::VMM Word256

  let toAddr = Address $ fromIntegral to

  toAccountExists <- addressStateExists toAddr

  self <- getEnvVar envOwner -- if an account being created calls itself, the go client doesn't charge the gCALLNEWACCOUNT fee, so we need to check if that case is occurring here

  return $ (
    fromIntegral gas +
    fromIntegral gCALL +
    (if toAccountExists || toAddr == self then 0 else fromIntegral gCALLNEWACCOUNT) +
--                       (if toAccountExists || to < 5 then 0 else gCALLNEWACCOUNT) +
    (if val > 0 then fromIntegral gCALLVALUETRANSFER else 0),
    0)


opGasPriceAndRefund CALLCODE = do
  gas <- getStackItem 0::VMM Word256
--  to <- getStackItem 1::VMM Word256
  val <- getStackItem 2::VMM Word256

--  toAccountExists <- lift $ lift $ lift $ addressStateExists $ Address $ fromIntegral to

  return
    (
      fromIntegral gas +
      gCALL +
      --(if toAccountExists then 0 else gCALLNEWACCOUNT) +
      (if val > 0 then fromIntegral gCALLVALUETRANSFER else 0),
      0
    )

opGasPriceAndRefund DELEGATECALL = do
  gas <- getStackItem 0::VMM Word256
  return (fromIntegral gas + gCALL, 0)

opGasPriceAndRefund CODECOPY = do
    size <- getStackItem 2::VMM Word256
    return (gCODECOPYBASE + gCOPYWORD * ceiling (fromIntegral size / (32::Double)), 0)
opGasPriceAndRefund CALLDATACOPY = do
    size <- getStackItem 2::VMM Word256
    return (gCALLDATACOPYBASE + gCOPYWORD * ceiling (fromIntegral size / (32::Double)), 0)
opGasPriceAndRefund EXTCODECOPY = do
    size <- getStackItem 3::VMM Word256
    return (gEXTCODECOPYBASE + gCOPYWORD * ceiling (fromIntegral size / (32::Double)), 0)
opGasPriceAndRefund RETURNDATACOPY = do
    size <- getStackItem 3 :: VMM Word256
    return (gRETURNDATACOPYBASE + gCOPYWORD * ceiling (fromIntegral size / (32 :: Double)), 0)

opGasPriceAndRefund SSTORE = do
  p <- getStackItem 0
  val <- getStackItem 1
  oldVal <- getStorageKeyVal p
  case (oldVal, val) of
      (0, x) | x /= (0::Word256) -> return (20000, 0)
      (x, 0) | x /= 0 -> return (5000, 15000)
      _      -> return (5000, 0)
opGasPriceAndRefund SUICIDE = do
    owner <- getEnvVar envOwner
    currentSuicideList <- fmap suicideList $ lift get
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

formatOp::Operation->String
formatOp (PUSH x) = "PUSH" ++ show (length x) -- ++ show x
formatOp x        = show x


printTrace::Operation->Gas->CodePointer->VMState->VMM ()
--printDebugInfo env memBefore memAfter c op stateBefore stateAfter = do
printTrace op gasBefore pcBefore stateAfter = do

  --CPP style trace
{-  lift $ logInfoN $ "EVM [ eth | " ++ show (callDepth stateBefore) ++ " | " ++ formatAddressWithoutColor (envOwner env) ++ " | #" ++ show c ++ " | " ++ map toUpper (showHex4 (pc stateBefore)) ++ " : " ++ formatOp op ++ " | " ++ show (vmGasRemaining stateBefore) ++ " | " ++ show (vmGasRemaining stateAfter - vmGasRemaining stateBefore) ++ " | " ++ show(fromIntegral memAfter - fromIntegral memBefore) ++ "x32 ]"
  lift $ logInfoN $ "EVM [ eth ] "-}

  --GO style trace
  gasAfter <- liftIO $ readGasRemaining stateAfter
  $logInfoS "printTrace" . T.pack $ "PC " ++ printf "%08d" pcBefore ++ ": " ++ formatOp op
      ++ " GAS: " ++ show gasAfter ++ " COST: " ++ show (gasAfter - gasBefore)

  -- memByteString <- liftIO $ getMemAsByteString (memory stateAfter)
  _ <- liftIO $ getMemAsByteString (memory stateAfter)
  $logInfoS "printTrace" "    STACK"
  stackList <- liftIO . MS.toList . stack $ stateAfter
  $logInfoS "printTrace" . T.pack $ unlines (padZeros 64 <$> flip showHex "" <$> (reverse $ stackList))
--  lift $ $logInfoS "printTrace" . T.pack $ "    MEMORY\n" ++ showMem 0 (B.unpack $ memByteString)
{-
  lift $ $logInfoS "printTrace" "    STORAGE"
  kvs <- getAllStorageKeyVals
  lift $ $logInfoS "printTrace" . T.pack $ unlines (map (\(k, v) -> "0x" ++ showHexU (byteString2Integer $ nibbleString2ByteString k) ++ ": 0x" ++ showHexU (fromIntegral v)) kvs)
-}

{-# INLINE runCode #-}
runCode :: VMM ()
runCode = do
  vmState <- lift get
  pcBefore <- readPC vmState
  code <- getEnvVar envCode
  let (op, len) = getOperationAt code pcBefore

  (val, theRefund) <- opGasPriceAndRefund op
  useGas val
  addToRefund theRefund

  runOperation op

  incrementPC len

runCodeEVMProfile :: VMM ()
runCodeEVMProfile = whileM $ do
  vmState <- lift get
  pcBefore <- readPC vmState
  code <- getEnvVar envCode
  let (op, _) = getOperationAt code pcBefore
  liftIO cwBefore
  runCode
  totalNanoseconds <- liftIO cwAfter
  $logInfoS "runCodeEVMProfile" . T.pack $ "OPCODE: " ++ show op ++ " " ++ show totalNanoseconds
  recordOpTiming op totalNanoseconds
  fmap not . lift $ gets done

runCodeSQLTrace :: Int -> VMM ()
runCodeSQLTrace !c = do
  vmState <- lift get
  gasBefore <- readGasRemaining vmState
  pcBefore <- readPC vmState
  memBefore <- getSizeInWords
  code <- getEnvVar envCode
  let (op, _) = getOperationAt code pcBefore
  runCode
  gasAfter <- readGasRemaining vmState
  pcAfter <- readPC vmState
  memAfter <- getSizeInWords
  env <- lift $ gets environment
  vmTrace $ "EVM [ eth | " ++ show (callDepth vmState)
                  ++ " | " ++ formatAddressWithoutColor (envOwner env)
                  ++ " | #" ++ show c
                  ++ " | " ++ map toUpper (showHex pcAfter "") ++ " : " ++ formatOp op
                  ++ " | " ++ show gasAfter
                  ++ " | " ++ show (gasAfter - gasBefore)
                  ++ " | " ++ show(toInteger memAfter - toInteger memBefore) ++ "x32 ]\n"
  unlessM (lift (gets done)) $
    runCodeSQLTrace (c+1)


runCodeTrace :: VMM ()
runCodeTrace = whileM $ do
  vmState <- lift get
  gasBefore <- readGasRemaining vmState
  pcBefore <- readPC vmState
  code <- getEnvVar envCode
  let (op, _) = getOperationAt code pcBefore
  runCode
  result <- lift get
  printTrace op gasBefore pcBefore result
  fmap not . lift $ gets done

runCodeFast :: VMM ()
runCodeFast = do
  runCode
  d <- lift $ gets done
  unless d $ runCodeFast

data TraceType = Fast | Trace | SQLTrace | EVMProfile deriving (Eq, Enum, Show)

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
  x -> error $ "Unknown tracing format: " ++ show x

runCodeFromStart :: VMM ()
runCodeFromStart = do
  code <- getEnvVar envCode
  theData <- getEnvVar envInputData

  when flags_debug $
     lift $ $logInfoS "runCodeFromStart" . T.pack $ "running code: " ++ tab (CL.magenta ("\n" ++ showCode 0 code))

  case code of
   PrecompiledCode x -> do
     ret <- callPrecompiledContract (fromIntegral x) theData
     vmState <- lift get
     lift $ put vmState{returnVal=Just ret}
     return ()
   _ -> case parseTraceFlag flags_trace of
     Fast -> $logInfoS "runCodeFromStart" "running fast code" >> runCodeFast
     Trace -> $logInfoS "runCodeFromStart" "running traced code" >> runCodeTrace
     SQLTrace -> $logInfoS "runCodeFromStart" "running sql traced code" >> runCodeSQLTrace 0
     EVMProfile -> $logInfoS "runCodeFromStart" "running evm profiled code" >> runCodeEVMProfile

-- | runVMM fully evaluates its results to limit memory leaks.
runVMM :: (NFData a) => Bool -> Bool -> S.Set Address -> Int -> Environment -> Gas -> VMM a -> ContextM (Either VMException a, VMState)
runVMM isRunningTests' isHomestead preExistingSuicideList callDepth env availableGas f = do
  dbs' <- get
  sqldbs' <- ask
  vmState <- liftIO $ startingState isRunningTests' isHomestead env sqldbs' dbs'
  gasref <- liftIO $ newCounter availableGas
  result <- lift . lift $
      flip runStateT vmState{
                         callDepth=callDepth,
                         vmGasRemaining=gasref,
                         suicideList=preExistingSuicideList} $
      runExceptT f

  case result of
      (Left e, vmState') -> do
          lift . lift $ $logInfoS "runVMM/Left" . T.pack $ CL.red $ "Exception caught (" ++ show e ++ "), reverting state"
          when flags_debug $ $logDebugS "runVMM/Left" "VM has finished running"
          return (Left e, vmState'{logs=[]})
      (_, stateAfter) -> do
          setStateDBStateRoot $ MP.stateRoot $ contextStateDB $ dbs $ stateAfter
          putStorageTxMap $ contextStorageTxMap $ dbs stateAfter
          putAddressStateTxDBMap $ contextAddressStateTxDBMap $ dbs stateAfter

          when flags_debug . lift .lift $ $logInfoS "runVMM/Right" "VM has finished running"
          return result

create :: Bool
       -> Bool
       -> S.Set Address
       -> BlockData
       -> Int
       -> Address
       -> Address
       -> Integer
       -> Integer
       -> Gas
       -> Address
       -> Code
       -> SHA
       -> Maybe Word256
       -> Maybe (M.Map T.Text T.Text)
       -> ContextM (Either VMException Code, VMState)
create isRunningTests' isHomestead preExistingSuicideList b callDepth sender origin
       value gasPrice availableGas newAddress initCode txHash chainId metadata = do
  let env =
        Environment{
          envGasPrice = gasPrice,
          envBlockHeader=b,
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

  dbs' <- get
  sqldbs' <- ask
  vmState <- liftIO $ startingState isRunningTests' isHomestead env sqldbs' dbs'

  success <-
    if toInteger value > 0
    then do
    --it is a statistical impossibility that a new account will be created with the same address as
    --an existing one, but the ethereum tests test this.  They want the VM to preserve balance
    --but clean out storage.
    --This will never actually matter, but I add it to pass the tests.
    newAddressState <- getAddressState newAddress
    putAddressState newAddress newAddressState{addressStateContractRoot=MP.emptyTriePtr}
    --This next line will actually create the account addressState data....
    --In the extremely unlikely even that the address already exists, it will preserve
    --the existing balance.
    pay "transfer value" sender newAddress $ fromIntegral value
    else return True

  ret <-
    if success
      then runVMM isRunningTests' isHomestead preExistingSuicideList callDepth env availableGas create'
      else return (Left InsufficientFunds, vmState)
  case ret of
    (Left e, vmState') -> do
      --if there was an error, addressStates were reverted, so the receiveAddress still should
      --have the value, and I can revert without checking for success.
      _ <- pay "revert value transfer" newAddress sender (fromIntegral value)

      purgeStorageMap newAddress
      deleteAddressState newAddress
      -- Need to zero gas in the case of an exception.
      liftIO $ writeIORefU (vmGasRemaining vmState') 0
      return (Left e, vmState')
    _ -> return ret

create' :: VMM Code
create' = do

  owner <- getEnvVar envOwner
  action . actionData %= M.insert owner (ActionData (SHA 0) M.empty [])

  runCodeFromStart

  vmState <- lift get

  let codeBytes = fromMaybe B.empty $ returnVal vmState
  (action . actionData . at owner . mapped . actionDataCodeHash) .= hash codeBytes
  when flags_debug $ lift $ $logInfoS "create'" . T.pack $ "Result: " ++ show codeBytes

  lift $ do
    $logInfoS "create'" "Trying to create contract"
    $logInfoS "create'" . T.pack $ "The amount of ether you need: " ++ show (gCREATEDATA * fromIntegral (B.length codeBytes))
    $logInfoS "create'" . T.pack $ "The amount of ether you have: " ++ show (vmGasRemaining vmState)

  -- this used to say "not enough ether, but im pretty sure it meant gas -io
  gr <- getGasRemaining
  if (not $ vmIsHomestead vmState) && (gr < gCREATEDATA * fromIntegral (B.length codeBytes))
    then do
      lift $ do
        $logInfoS "create'/lowGas" . T.pack $ CL.red "Not enough gas to create contract, contract being thrown away (account was created though)"
        $logInfoS "create'/lowGas" . T.pack $ "The amount of gas you need: " ++ show (gCREATEDATA * fromIntegral (B.length codeBytes))
        $logInfoS "create'/lowGas" . T.pack $ "The amount of gas you have: " ++ show gr
      lift $ put vmState{returnVal=Nothing}
      assignCode "" owner
      assignDetails
      return $ Code ""
    else do
      useGas $ gCREATEDATA * fromIntegral (B.length codeBytes)
      assignCode codeBytes owner
      assignDetails
      return $ Code codeBytes

  where
    assignCode::B.ByteString->Address->VMM ()
    assignCode codeBytes address = do
      addCode codeBytes
      newAddressState <- getAddressState address
      putAddressState address newAddressState{addressStateCodeHash=hash codeBytes}
    assignDetails = do
      vmState <- lift get
      let Environment{..} = environment vmState
      action . actionData . at envOwner. mapped . actionDataCallData %=
        (:) CallData
              { _callDataType        = Create
              , _callDataSender      = envSender
              , _callDataOwner       = envOwner
              , _callDataGasPrice    = envGasPrice
              , _callDataValue       = envValue
              , _callDataInput       = envInputData
              , _callDataOutput      = returnVal vmState
              }

call :: Bool
     -> Bool
     -> Bool
     -> S.Set Address
     -> BlockData
     -> Int
     -> Address
     -> Address
     -> Address
     -> Word256
     -> Word256
     -> B.ByteString
     -> Gas
     -> Address
     -> SHA
     -> Maybe Word256
     -> Maybe (M.Map T.Text T.Text)
     -> ContextM (Either VMException B.ByteString, VMState)
call isRunningTests' isHomestead noValueTransfer preExistingSuicideList b callDepth receiveAddress
     (Address codeAddress) sender value gasPrice theData availableGas origin txHash chainId metadata = do

  addressState <- getAddressState $ Address codeAddress

  code <-
    if 0 < codeAddress && codeAddress < 5
    then return $ PrecompiledCode $ fromIntegral codeAddress
    else Code . fromMaybe B.empty <$> getCode (addressStateCodeHash addressState)

  let env =
        Environment{
          envGasPrice=fromIntegral gasPrice,
          envBlockHeader=b,
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

  runVMM isRunningTests' isHomestead preExistingSuicideList callDepth env availableGas $ call' noValueTransfer

call' :: Bool -> VMM B.ByteString
call' noValueTransfer = do
  value <- getEnvVar envValue
  receiveAddress <- getEnvVar envOwner
  sender <- getEnvVar envSender
  ch <- addressStateCodeHash <$> getAddressState receiveAddress
  action . actionData %= M.insert receiveAddress (ActionData ch M.empty [])

  --TODO- Deal with this return value
  unless noValueTransfer $ do
    _ <- pay "call value transfer" sender receiveAddress (fromIntegral value)
    return ()

  runCodeFromStart

  vmState <- lift get

  --when flags_debug $ liftIO $ do
  --    let result = fromMaybe B.empty $ returnVal vmState
  --    --putStrLn $ "Result: " ++ format result
  --    putStrLn $ "Gas remaining: " ++ show (vmGasRemaining vmState) ++ ", needed: " ++ show (5*toInteger (B.length result))
  --    --putStrLn $ show (pretty address) ++ ": " ++ format result
  let Environment{..} = environment vmState
  action . actionData . at envOwner. mapped . actionDataCallData %=
    (:) CallData
          { _callDataType        = Update
          , _callDataSender      = envSender
          , _callDataOwner       = envOwner
          , _callDataGasPrice    = envGasPrice
          , _callDataValue       = envValue
          , _callDataInput       = envInputData
          , _callDataOutput      = returnVal vmState
          }

  return (fromMaybe B.empty $ returnVal vmState)

create_debugWrapper :: BlockData -> Address -> Word256 -> B.ByteString -> VMM (Maybe Address)
create_debugWrapper block owner value initCodeBytes = do

  addressState <- getAddressState owner

  if fromIntegral value > addressStateBalance addressState
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

      dbs' <- lift $ dbs <$> get
      sqldb' <- lift $ gets sqldb

      currentVMState <- lift get

      let runEm :: ContextM a -> VMM (a, Context)
          runEm f = lift . lift . flip runReaderT sqldb' . runStateT f $ dbs'
          callEm :: ContextM (Either VMException Code, VMState)
          callEm = create (isRunningTests currentVMState)
                          (vmIsHomestead currentVMState)
                          (suicideList currentVMState)
                          block
                          (currentCallDepth+1)
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

      ((result, finalVMState), finalDBs) <- runEm callEm

      setStateDBStateRoot $ MP.stateRoot $ contextStateDB $ finalDBs
      putStorageTxMap $ contextStorageTxMap finalDBs
      putAddressStateTxDBMap $ contextAddressStateTxDBMap finalDBs
      gr <- liftIO . readGasRemaining $ finalVMState
      setGasRemaining gr

      case result of
        Left e -> do
          when flags_debug $ lift $ $logInfoS "create_debugWrapper" $ T.pack $ CL.red $ show e
          return Nothing
        Right _ -> do

          forM_ (reverse $ logs finalVMState) addLog
          state' <- lift get
          lift $ put state'{suicideList = suicideList finalVMState}
          action . actionData %= M.unionWith mergeActionData (_actionData $ _action finalVMState)
          ref <- readRefund finalVMState
          addToRefund ref

          return $ Just newAddress

nestedRun_debugWrapper :: Bool -> Gas -> Address -> Address -> Address -> Word256 -> B.ByteString -> VMM (Int, Maybe B.ByteString)
nestedRun_debugWrapper noValueTransfer gas receiveAddress (Address address) sender value inputData = do

  currentCallDepth <- getCallDepth

  env <- lift $ gets environment
  dbs' <- lift $ gets dbs
  sqldb' <- lift $ gets sqldb

  currentVMState <- lift get

  let runEm :: ContextM a -> VMM (a, Context)
      runEm = lift . lift . flip runReaderT sqldb' . flip runStateT dbs'
      callEm :: ContextM (Either VMException B.ByteString, VMState)
      callEm = call (isRunningTests currentVMState)
                    (vmIsHomestead currentVMState)
                    noValueTransfer
                    (suicideList currentVMState)
                    (envBlockHeader env)
                    (currentCallDepth+1)
                    receiveAddress
                    (Address address)
                    sender
                    value
                    (fromIntegral $ envGasPrice env)
                    inputData
                    gas
                    (envOrigin env)
                    (envTxHash env)
                    (envChainId env)
                    (envMetadata env)

  ((result, finalVMState), finalDBs) <-
      runEm callEm

  setStateDBStateRoot $ MP.stateRoot $ contextStateDB $ finalDBs
  putStorageTxMap $ contextStorageTxMap finalDBs
  putAddressStateTxDBMap $ contextAddressStateTxDBMap finalDBs


  case result of
        Right retVal -> do
          forM_ (reverse $ logs finalVMState) addLog
          state' <- lift get
          lift $ put state'{suicideList = suicideList finalVMState}
          action . actionData %= M.unionWith mergeActionData (_actionData $ _action finalVMState)
          when flags_debug $
            lift $ $logInfoS "nestedRun_debugWrapper" $ T.pack $ "Refunding: " ++ show (vmGasRemaining finalVMState)
          gr <- liftIO . readGasRemaining $ finalVMState
          useGas $ negate gr
          ref <- readRefund finalVMState
          addToRefund ref
          return (1, Just retVal)
        Left RevertException -> do
          gr <- liftIO . readGasRemaining $ finalVMState
          useGas $ negate gr
          when flags_debug $
            lift $ $logInfoS "nestedRun_debugWrapper" $ T.pack $ "Reverting, retval: " ++ show (returnVal finalVMState)
          ref <- readRefund finalVMState
          addToRefund ref
          return (0, returnVal finalVMState)
        Left e -> do
          when flags_debug $ lift $ $logInfoS "nestedRun_debugWrapper" $ T.pack $ CL.red $ show e
          return (0, Nothing)
