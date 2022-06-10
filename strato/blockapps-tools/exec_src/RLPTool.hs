
import Data.Binary
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))

import Blockchain.Data.Address
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import Blockchain.Format
import Blockchain.Strato.Model.SHA  (keccak256)

getColumn::Int->[String]->String
getColumn i inputColumns = inputColumns !! i

decodeBase16::String->RLPObject
decodeBase16 = rlpDeserialize . fst . B16.decode . BC.pack

decodeRLP::RLPObject->String
decodeRLP = show . pretty

getOutput::[([String]->String)]->[String]->String
getOutput actions inputColumns = unwords $ map ($ inputColumns) actions

getAtRLPArray::Int->RLPObject->RLPObject
getAtRLPArray i (RLPArray x) = x !! i
getAtRLPArray i x = error $ "Can not call getArRLPArray for values: " ++ show i ++ ", " ++ show x

rlpMap::(RLPObject->a)->RLPObject->[a]
rlpMap f (RLPArray vals) = map f vals
rlpMap _ object = error $ "rlpMap was called on an object that wasn't an array: " ++ show object

getTransaction::RLPObject->Transaction
getTransaction = rlpDecode

showIt::Transaction->String
showIt x@(ContractCreationTX _ _ _ _ _ _ _ _) = show (pretty $ whoSignedThisTransaction x) ++ " " ++ format x
showIt x = "" -- format x

main::IO ()
main = do
  contents <- fmap (map words . lines) getContents
{-  putStrLn $ unlines $ map (getOutput [
                               getColumn 0,
                               getColumn 1,
                               getColumn 2,
                               \[address, _, nonce] -> format . flip getNewAddress_unsafe (read nonce) . decode . BL.fromStrict . fst . B16.decode . BC.pack $ address
                               ]) contents -}


  putStrLn $ unlines $ map (getOutput [
                               getColumn 0,
                               getColumn 1,
                               getColumn 2,
                               getColumn 3,
                               format . keccak256 . fst . B16.decode . BC.pack . getColumn 0
                               ]) contents



--  putStrLn $ unlines $ map (getOutput [getColumn 0, unlines . map showIt . rlpMap getTransaction . getAtRLPArray 0 . decodeBase16 . getColumn 1]) contents
--  putStrLn $ unlines $ map (getOutput [getColumn 0, decodeRLP . getAtRLPArray 0 . decodeBase16 . getColumn 1, show . rlpMap getTransaction . getAtRLPArray 0 . decodeBase16 . getColumn 1]) contents
--  putStrLn $ unlines $ map (getOutput [getColumn 0, decodeRLP . decodeBase16 . getColumn 1]) contents
--  putStrLn $ unlines $ map (getOutput [getColumn 0, showIt . getTransaction . decodeBase16 . getColumn 1]) contents
