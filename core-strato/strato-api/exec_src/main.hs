import           Application (appMain)
import           BlockApps.Init
import           Prelude     (IO)

main :: IO ()
main = do
  blockappsInit "strato-api"
  appMain
