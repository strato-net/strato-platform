import           Data.Aeson
import           Test.Hspec
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Base16          as B16
import qualified Data.Text                       as T
import qualified Data.Text.Encoding              as T

import           Blockchain.Data.Address
import           Blockchain.Strato.Model.ExtendedWord

main :: IO()
main = hspec $ do
  let addressString = "0bc8263b5852b45368661e7c89f08ef5bfab13f6"
  let address = getAddress addressString
  describe "Address toJSON" $ do
    it "toJSON address should give back a string of length 40" $ do
      let l = show $ addressToString address in l `shouldBe` addressString

getAddress :: [Char] -> Address
getAddress x = Address
             $ bytesToWord160
             $ B.unpack
             $ fst . B16.decode
             $ T.encodeUtf8
             $ T.pack x

addressToString :: Address -> T.Text
addressToString address = let (String t) = toJSON address in t
