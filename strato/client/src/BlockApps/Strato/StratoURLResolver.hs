
module BlockApps.Strato.StratoURLResolver where

resolveStratoURL::String->String
resolveStratoURL "stratoDev" = "http://bayar4a.eastus.cloudapp.azure.com/strato-api/eth/v1.2"
resolveStratoURL "avocado" = "http://strato-ms-dev.eastus.cloudapp.azure.com/strato-api/eth/v1.2"
resolveStratoURL x = x
