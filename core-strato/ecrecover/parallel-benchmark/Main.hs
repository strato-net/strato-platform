module Main where

import qualified BlockApps.ECRecover.BytesFormat   as A
import qualified BlockApps.ECRecover.IntegerFormat as C
import qualified Control.Parallel.Strategies       as B
import           Criterion.Main

main :: IO ()
main =
  defaultMain [bytes, integer]
  where
    bytes =
      bgroup "bytes" [sequential, parallel]
      where
        sequential =
          bench "sequential" $ nf (map recover) $ transactions
        parallel =
          bench "parallel" $ nf (B.parMap B.rdeepseq recover) $ transactions
        transactions =
          replicate 1000 $
          ("p\SUB~\205\r\196l3\157\145q\136\173&a\223\155\233\nP\179\211\133\179-\217\159x0\164K\147","A\134\202\157\166\FS#\253\170\248\138<E\223\232;<7\248\233J/D4n\tg\191\170\250\157\v",0,"OB\146\nu.\245\178J\159T\241\RSx\210\SYN\143ph\217\210eJ3\233\230\159\&0S*\ETB\t")
        recover =
          uncurry4 A.recoverCompressed
    integer =
      bgroup "integer" [sequential, parallel]
      where
        sequential =
          bench "sequential" $ nf (map recover) $ transactions
        parallel =
          bench "parallel" $ nf (B.parMap B.rdeepseq recover) $ transactions
        transactions =
          replicate 1000 $
          (53009061921330807819223009173068573399970314146107959232891770474150029121003,29809615627007940951178093867324997952009474722137805650637399147083218099518,1,35850334881260372387669542451037370183239639056352960888504548051174843619081)
        recover =
          uncurry4 C.recoverCompressed

uncurry4 :: (a -> b -> c -> d -> e) -> (a, b, c, d) -> e
uncurry4 fn (a, b, c, d) =
  fn a b c d
