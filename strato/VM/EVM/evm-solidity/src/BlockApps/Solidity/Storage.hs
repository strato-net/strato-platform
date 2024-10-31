{-# LANGUAGE LambdaCase #-}

module BlockApps.Solidity.Storage where

import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Data.Bits (complement, shiftR, (.&.))
import Data.Bool
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.IntMap as I
import qualified Data.Map as Map
import Data.Maybe (fromMaybe)
import qualified Data.Text.Encoding as Text
import Data.Word (Word8)

toStorage :: Value -> ByteString
toStorage = \case
  SimpleValue v -> simpleToStorage v
  ValueArrayDynamic vs ->
    toStorage (SimpleValue (valueUInt k))
      `ByteString.append` toStorage (ValueArrayFixed k $ unsparse vs)
    where
      k :: Num n => n
      k = fromIntegral (I.size vs)
  ValueArrayFixed _ vs ->
    let head' = map (\v -> if isDynamic v then Nothing else Just (toStorage v)) vs
        tail' = map (\v -> if isDynamic v then toStorage v else ByteString.empty) vs
        tailLengths = scanl (\b a -> ByteString.length a + b) 0 tail'
        headLength = sum $ maybe 32 ByteString.length <$> head'
        head'' = zipWith f tailLengths head'
          where
            f t =
              fromMaybe
                (toStorage $ SimpleValue $ valueUInt $ fromIntegral $ t + headLength)
     in ByteString.concat head'' `ByteString.append` ByteString.concat tail'
  -- byte array of correctly encoded types in vs
  -- head  array contains static size Values
  -- head ends with in order:
  -- length of head going to each dynamic a value

  ValueContract {} -> error "toStorage for ValueContract not yet defined"
  ValueFunction {} -> error "toStorage for ValueFunction not yet defined"
  ValueEnum {} -> error "toStorage for ValueEnum not yet defined"
  ValueStruct {} -> ByteString.empty
  ValueMapping {} -> error "toStorage for ValueMapping not yet defined"
  ValueArraySentinel {} -> error "toStorage for ValueArraySentinel not yet defined"
  ValueVariadic {} -> ByteString.empty

simpleToStorage :: SimpleValue -> ByteString
simpleToStorage = \case
  ValueBool v -> simpleToStorage $ valueUInt $ bool 0 1 v
  ValueInt False _ v -> ByteString.pack $ go False v
  ValueInt True _ v ->
    ByteString.pack $
      if (v < 0)
        then go True ((negate v) - 1)
        else go False v
  ValueDecimal v -> padRight32 v
  ValueAddress v -> simpleToStorage . valueUInt . fromIntegral $ unAddress v
  ValueAccount v -> simpleToStorage . valueUInt . fromIntegral $ _namedAccountAddress v
  ValueBytes Nothing v -> padRight32 $ ByteString.append (simpleToStorage (valueUInt (toInteger $ ByteString.length v))) v
  ValueBytes (Just _) v -> padRight32 v
  ValueString v -> simpleToStorage . valueBytes $ Text.encodeUtf8 v
  where
    paddingLen bs =
      let len = ByteString.length bs
          lenMod32 = len `mod` 32
       in (32 - lenMod32) `mod` 32
    padRight32 bs = bs `ByteString.append` ByteString.replicate (paddingLen bs) 0
    go :: Bool -> Integer -> [Word8]
    go neg val = go' neg (32 :: Integer) val []
    go' _ 0 _ xs = xs
    go' neg b v xs =
      if v == 0
        then go' neg (b - 1) v ((if neg then 0xff else 0x0) : xs)
        else
          let w = fromInteger (v .&. 0xff)
              x =
                if neg
                  then complement w
                  else w
           in go' neg (b - 1) (v `shiftR` 8) (x : xs)

isDynamic :: Value -> Bool
isDynamic = \case
  ValueArrayDynamic {} -> True
  ValueMapping {} -> True
  ValueArraySentinel {} -> True
  ValueArrayFixed _ vs -> any isDynamic vs
  SimpleValue v -> simpleIsDynamic v
  ValueContract {} -> False
  ValueFunction {} -> False
  ValueEnum {} -> False
  ValueStruct fs -> any isDynamic $ Map.elems fs
  ValueVariadic {} -> True

simpleIsDynamic :: SimpleValue -> Bool
simpleIsDynamic = \case
  ValueBytes Nothing _ -> True
  ValueString _ -> True
  _ -> False
