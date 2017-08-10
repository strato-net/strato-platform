import           Control.Monad
import           Data.Aeson
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Base16          as B16
import qualified Data.Text                       as T
import qualified Data.Text.Encoding              as T
import           Test.Hspec

import           Blockchain.Data.Address
import           Blockchain.Strato.Model.ExtendedWord

main :: IO()
main = hspec $ do
  describe "Address toJSON" $ do
    forM_ [0..40] $ \n -> do
      it "toJSON address should give back a string of length 40" $ do
        let string = getAddressString n
        let address = stringToAddress string
        let a = T.unpack $ addressToString address in a `shouldBe` string

stringToAddress :: [Char] -> Address
stringToAddress x = Address
             $ bytesToWord160
             $ B.unpack
             $ fst . B16.decode
             $ T.encodeUtf8
             $ T.pack x

addressToString :: Address -> T.Text
addressToString address = let (String t) = toJSON address in t

getAddressString :: Int -> String
getAddressString i = (take (40 - i) $ repeat '0') ++ (take i $ repeat 'a')
