{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
{-# OPTIONS_GHC -fno-warn-missing-fields #-}
import Criterion.Main
import Control.DeepSeq
import Control.Monad
import Control.Monad.Logger
import Control.Monad.Trans.Except
import Control.Monad.Trans.Resource
import Control.Monad.Trans.State
import qualified Data.ByteString     as B
-- import qualified Data.Map            as M
import qualified Data.Vector         as V
import qualified Data.Vector.Unboxed as UV
import Data.Word
import GHC.Generics

import Blockchain.Data.Code
import Blockchain.VM
import Blockchain.VM.Code
import Blockchain.VM.Opcodes
import Blockchain.VM.OpcodePrices
import Blockchain.VM.VMException
import Blockchain.VM.VMM
import Blockchain.VM.VMState

jumpDestCode :: Int -> Code
jumpDestCode n = Code $ B.replicate n 0x5b

benchOperationGasPrice :: Operation -> Benchmark
benchOperationGasPrice op = bench ("opGasPrice: " ++ show op)
                          $ nf opGasPrice op

benchJumpGet :: Int -> Benchmark
benchJumpGet n = bench ("getOperationAt: " ++ show n ++ " bytes")
               $ nf (flip getOperationAt (n-1)) (jumpDestCode n)

-- operationLookupHit :: Benchmark
-- operationLookupHit = bench "operation lookup hit"
--                    $ nf (M.lookup 0x5b) code2OpMap

-- operationLookupMiss :: Benchmark
-- operationLookupMiss = bench "operation lookup miss"
--                     $ nf (M.lookup 0xfb) code2OpMap

vectorLookup :: Benchmark
vectorLookup = bench "vector operation lookup"
             $ nf (V.! 0x44) (V.replicate 256 LOG4)

unsafeVectorLookup :: Benchmark
unsafeVectorLookup = bench "unsafe vector lookup"
                   $ nf (`V.unsafeIndex` 0x44) (V.replicate 256 LOG4)

unboxedVectorLookup :: Benchmark
unboxedVectorLookup = bench "unboxed vector word8 lookup"
                    $ nf (UV.! 0x44) (UV.replicate 256 (0x24 :: Word8))

unboxedVectorUnsafeLookup :: Benchmark
unboxedVectorUnsafeLookup = bench "unboxed vector unsafe lookup"
                          $ nf (`UV.unsafeIndex` 0x44) (UV.replicate 256 (0x24 :: Word8))

devNull :: (ToLogStr str) => Loc -> LogSource -> LogLevel -> str -> IO ()
devNull _ _ _ _ = return ()

runBenchVMM :: VMState -> VMM a -> IO (Either VMException a)
runBenchVMM s = flip runLoggingT devNull . runResourceT . flip evalStateT s . runExceptT

initialState :: IO VMState
initialState = do
  startingState (error "isRunningTests") (error "isHomestead") (error "env")
                (error "sqldb'") (error "dbs'")

benchVMMNothing :: VMState -> Benchmark
benchVMMNothing s = bench "VMM return ()"
                  . nfIO . runBenchVMM s $ return ()

benchPriceAndRefund :: VMState -> Operation -> Benchmark
benchPriceAndRefund s op = bench ("VMM opGasPriceAndRefund " ++ show op)
                         . nfIO . runBenchVMM s $ opGasPriceAndRefund op

data FakeOp = STOP | ADD | MUL | SUB | DIFF | OK | YEYAH
            deriving (Show, Enum, Eq, Ord, Generic, NFData)

benchIdOp :: Benchmark
benchIdOp = bench "FakeOp id"
          $ nf id YEYAH

benchFromEnumOp :: Benchmark
benchFromEnumOp = bench "FakeOp fromEnum"
                $ nf fromEnum YEYAH

main :: IO ()
main = do
  states <- replicateM 100 initialState
  defaultMain $ map benchJumpGet [1, 100, 10000, 1000000]
             ++ [-- operationLookupHit, operationLookupMiss,
                 vectorLookup, unsafeVectorLookup,
                 unboxedVectorLookup, unboxedVectorUnsafeLookup,
                 benchIdOp, benchFromEnumOp]
             ++ map benchOperationGasPrice [DUP1, SWAP1, PUSH3, GASLIMIT, SUICIDE]
             ++ [ benchVMMNothing (states !! 0)
                , benchPriceAndRefund (states !! 1) JUMPDEST]
