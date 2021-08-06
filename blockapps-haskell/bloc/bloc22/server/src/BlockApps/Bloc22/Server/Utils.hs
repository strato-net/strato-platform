
module BlockApps.Bloc22.Server.Utils
  ( 
    partitionWith
  , binRuntimeToCodeHash
  ) where

import qualified Data.ByteString.Base16           as BS16
import qualified Data.Map.Strict                  as M
import           Data.Maybe
import qualified Data.Text                        as Text
import qualified Data.Text.Encoding               as Text

import           Blockchain.Strato.Model.Keccak256

binRuntimeToCodeHash :: Text.Text -> Keccak256
binRuntimeToCodeHash = hash . fst . BS16.decode . Text.encodeUtf8

partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
partitionWith f = map (fmap (map snd)) . indexedPartitionWith f

indexedPartitionWith :: Ord k => (a -> k) -> [a] -> [(k, [(Int, a)])]
indexedPartitionWith f = M.toList . foldr (uncurry builder) M.empty . zip [0..]
  where builder i a = M.alter (Just . ((i,a):) . fromMaybe []) (f a)
