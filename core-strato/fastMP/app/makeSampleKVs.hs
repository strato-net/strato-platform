
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
--import Crypto.Hash.Keccak

import Blockchain.Strato.Model.SHA

main :: IO ()
main = do
  let x = [0..1000000]::[Integer]
  putStrLn $ unlines $ map (\v -> (BC.unpack $ B16.encode $ keccak256 $ BC.pack $ show v) ++ " "
                           ++ (BC.unpack $ B16.encode $ keccak256 $ BC.pack $ ("a" ++ show v)) ++ " ") x
