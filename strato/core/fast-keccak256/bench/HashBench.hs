import Criterion.Main
import qualified Data.ByteString as B
import FastKeccak256
import Text.Printf

inputs :: [B.ByteString]
inputs =
  [ B.empty,
    B.replicate 32 0xfe,
    B.replicate 1024 0xca,
    B.replicate (1024 * 1024) 0x33
  ]

hashBenches :: String -> (B.ByteString -> B.ByteString) -> [Benchmark]
hashBenches s f = map (\i -> bench (printf "%s - %d bytes" s (B.length i)) $ nf f i) inputs

main :: IO ()
main = defaultMain $ hashBenches "slowKeccak256" slowKeccak256 ++ hashBenches "fastKeccak256" fastKeccak256
