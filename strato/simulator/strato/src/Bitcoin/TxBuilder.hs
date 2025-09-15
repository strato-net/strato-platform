{-# LANGUAGE OverloadedStrings #-}

module Bitcoin.TxBuilder (buildUnsignedTx) where

import Common.Types (UTXO(..))

import Haskoin.Transaction
import Haskoin.Script
import Haskoin.Crypto
import Haskoin.Util

import qualified Data.Binary as Binary
import qualified Data.ByteString.Lazy as BL
import Data.Maybe (fromJust)
import Data.Word (Word64)

btcToSats :: Double -> Word64
btcToSats b = round (b * 100000000)

-- | Construct an unsigned transaction that sends funds to a custom script (e.g., PayMulSig)
buildUnsignedTx
  :: Ctx
  -> [UTXO]
  -> ScriptOutput      -- ^ destination script (e.g. PayMulSig)
  -> Double            -- ^ amount to send
  -> ScriptOutput      -- ^ optional change address
  -> Either String Tx
buildUnsignedTx ctx utxos scriptOut amountBtc changeScript = do
  -- Step 1: Gather inputs
  let totalNeeded = btcToSats amountBtc + feeEstimate
      inputAccum = takeWhileAccum ((>= totalNeeded) . snd) (utxosAccum 0 [] utxos)

  (selectedUtxos, totalIn) <- maybeToEither "Insufficient funds" inputAccum

  -- Step 2: Inputs
  let txIns = flip map selectedUtxos $ \u ->
        TxIn (OutPoint (fromJust $ hexToTxHash $ uTxid u) (fromIntegral $ uVout u)) mempty maxBound

  -- Step 3: Outputs
  let redeemScriptBS = BL.toStrict . Binary.encode $ encodeOutput ctx scriptOut
      -- addr = maybe "Nothing" id $ addrToText btc $ ScriptAddress $ addressHash redeemScriptBS
  let destOut = TxOut (btcToSats amountBtc) redeemScriptBS
      outValue = totalIn - btcToSats amountBtc - feeEstimate
      changeOut = TxOut outValue
                        (BL.toStrict . Binary.encode $ encodeOutput ctx changeScript)
      txOuts = if outValue > 0 then [destOut, changeOut] else [destOut]

  return $ Tx 2 txIns txOuts [] 0

-- Same as before...
feeEstimate :: Word64
feeEstimate = 1770

utxosAccum :: Word64 -> [UTXO] -> [UTXO] -> Maybe ([UTXO], Word64)
utxosAccum _ _ [] = Nothing
utxosAccum target acc (u:us) =
  let accVal = sum (map (btcToSats . uAmount) (u:acc))
  in if accVal >= target
     then Just (u:acc, accVal)
     else utxosAccum target (u:acc) us

takeWhileAccum :: (a -> Bool) -> Maybe a -> Maybe a
takeWhileAccum _ Nothing = Nothing
takeWhileAccum f (Just x)
  | f x       = Just x
  | otherwise = Nothing