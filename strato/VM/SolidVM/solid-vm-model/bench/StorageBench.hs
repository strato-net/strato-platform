{-# LANGUAGE BangPatterns #-}
{-# OPTIONS_GHC -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS_GHC -fno-warn-unused-local-binds #-}

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import Control.Monad
import Criterion.Main
import Data.Binary (encode)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Unsafe as BU
import Data.Serialize.Put
import Data.Word
import SolidVM.Model.Storable
import Text.Printf

data UnfoldEsc = UnfoldEsc !Int !Bool

escapeUnfold :: B.ByteString -> B.ByteString
escapeUnfold bs = fst $ B.unfoldrN (2 * len) goUnfold (UnfoldEsc 0 False)
  where
    len = B.length bs
    goUnfold :: UnfoldEsc -> Maybe (Word8, UnfoldEsc)
    goUnfold (UnfoldEsc pos c) =
      case (pos < len, c, BU.unsafeIndex bs pos) of
        (False, _, _) -> Nothing
        (True, False, 0x22) -> Just (0x5c, UnfoldEsc pos True)
        (True, False, 0x5c) -> Just (0x5c, UnfoldEsc pos True)
        (True, _, c') -> Just (c', UnfoldEsc (pos + 1) False)

escapeList :: B.ByteString -> B.ByteString
escapeList = B.pack . go . B.unpack
  where
    go (0x22 : ts) = 0x5c : 0x22 : go ts
    go (0x5c : ts) = 0x5c : 0x5c : go ts
    go (t : ts) = t : go ts
    go [] = []

escapeConcat :: B.ByteString -> B.ByteString
escapeConcat = B.concatMap go
  where
    go :: Word8 -> B.ByteString
    go 0x22 = "\\\""
    go 0x5c = "\\\\"
    go x = B.singleton x

escapePut :: B.ByteString -> B.ByteString
escapePut bs = runPut $ go 0
  where
    len = B.length bs
    go n = case (n < len, BU.unsafeIndex bs n) of
      (False, _) -> return ()
      (True, c) -> do
        when (c == 0x5c || c == 0x22) $ putWord8 0x5c
        putWord8 c
        go (n + 1)

unescapeUnfold :: B.ByteString -> B.ByteString
unescapeUnfold bs = fst $ B.unfoldrN (B.length bs) go 0
  where
    go :: Int -> Maybe (Word8, Int)
    go n = case B.length bs - n of
      -1 -> Nothing
      0 -> Nothing
      1 -> Just (B.index bs n, (+ 1) $! n)
      _ ->
        let !np1 = n + 1
         in case (B.index bs n, B.index bs np1) of
              (0x5c, 0x22) -> Just (0x22, (+ 2) $! n)
              (0x5c, 0x5c) -> Just (0x5c, (+ 2) $! n)
              (c, _) -> Just (c, np1)

main :: IO ()
main = do
  let n = 100
  let escapes =
        bgroup
          "Escaping and Unescaping"
          [ bench (printf "escape all %d" n) . nf escapeKey . B.replicate n $ 0x22,
            bench (printf "escape none %d" n) . nf escapeKey . B.replicate n $ 0x43,
            bench (printf "list escape all %d" n) . nf escapeList . B.replicate n $ 0x22,
            bench (printf "list escape none %d" n) . nf escapeList . B.replicate n $ 0x43,
            bench (printf "concat escape all %d" n) . nf escapeConcat . B.replicate n $ 0x22,
            bench (printf "concat escape none %d" n) . nf escapeConcat . B.replicate n $ 0x43,
            bench (printf "unfold escape all %d" n) . nf escapeUnfold . B.replicate n $ 0x22,
            bench (printf "unfold escape none %d" n) . nf escapeUnfold . B.replicate n $ 0x43,
            bench (printf "put escape all %d" n) . nf escapePut . B.replicate n $ 0x22,
            bench (printf "put escape none %d" n) . nf escapePut . B.replicate n $ 0x43,
            bench (printf "unescape all %d" n) . nf unescapeKey . B.replicate n $ 0x5c,
            bench (printf "unescape none %d" n) . nf unescapeKey . B.replicate n $ 0x43,
            bench (printf "unfold unescape all %d" n) . nf unescapeUnfold . B.replicate n $ 0x5c,
            bench (printf "unfold unescape none %d" n) . nf unescapeUnfold . B.replicate n $ 0x43
          ]
  let parses =
        bgroup
          "Parsing"
          [ bench "parse nothing" $ nf parsePath "",
            bench "parse field" $ nf parsePath ".field",
            bench "parse one long field" $
              nf parsePath $
                "." <> B.replicate 100 0x45,
            bench "parse one long map index" $
              nf parsePath $
                B.concat ["<\"", B.replicate 100 0x45, "\">"],
            bench "parse one long quoteful map index" $
              nf parsePath $
                B.concat ["<\"", B.concat (replicate 50 "\\\""), "\">"],
            bench "parse nested" $ nf parsePath ".extra[200]<\"key\">[10].field",
            bench "unparse nothing" $ nf unparsePath empty,
            bench "unparse field" $ nf unparsePath $ singleton "field",
            bench "unparse nested" $
              nf unparsePath $
                fromList
                  [ Field "extra",
                    ArrayIndex 200,
                    MapIndex (IText "key"),
                    ArrayIndex 10,
                    Field "field"
                  ],
            bench "unparse array index" $ nf unparsePath $ fromList [ArrayIndex 1324098]
          ]
  let values =
        bgroup
          "Value conversion"
          [ bench "rlp encode int" $ nf (rlpSerialize . rlpEncode) (BInteger 209318487102),
            bench "binary encode int" $ nf (BL.toStrict . encode) (BInteger 209318487102),
            bench "word256 to bytes" $ nf (\(BInteger k) -> word256ToBytes (fromIntegral k)) (BInteger 209318487102),
            bench "rlp encode string" $ nf (rlpSerialize . rlpEncode) (BString "TKTT"),
            bench "binary encode string" $ nf (BL.toStrict . encode) (BString "TKTT"),
            bench "cons...?" $ nf (\(BString s) -> B.cons 6 s) (BString "TKTT")
          ]
  defaultMain [escapes, parses, values]
