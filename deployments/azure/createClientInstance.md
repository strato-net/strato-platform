## Create a client instance
These instructions are used to create a client instance, based on the marketplace image, but not via the marketplace interface.  

### In the portal
1. Create a new resource group 
1. Create a new storage account ($DEST_STORAGE_ACCOUNT$) - type vm extensions
1. Create a new container named `vhds` inside the storage account
  * open the storage account
  * click on blobs
  * click on 'blob service' -> '+'
  * name the new container `vhds`

### Azure CLI
1. Get the primary key ($DEST_ACCOUNT_KEY$) for the target storage account 
  
  `$ azure storage account keys list $DEST_STORAGE_ACCOUNT$`
  
1. Get the primary key ($SRC_ACCOUNT_KEY$) for the source storage account (bamarketstorage)
  
  `$ azure storage account keys list bamarketstorage`
  
1. Create a shared access signature (SAS) for the source account ($SOURCE_SAS$)

  ```
  $ azure storage container sas create -a bamarketstorage -k $SRC_ACCOUNT_KEY$ \
  --container vhds --permissions rl \
  --start "$(date -u -d "last hour")" \
  --expiry "$(date -u -d "next week")"  
  ```
  
1. Copy the image

  ```
  $ sourceUri=https://bamarketstorage.blob.core.windows.net/vhds/bamarket_2016-06.vhd; \
  $ azure storage blob copy start \
    --source-uri $sourceUri -a bamarketstorage \
    --source-sas '$SOURCE_SAS$' \
    --dest-account-name $DEST_STORAGE_ACCOUNT$ \
    --dest-account-key $DEST_ACCOUNT_KEY$ \
    --dest-container vhds \
    --dest-blob $NAME$-image.vhd
  ```
1. View progress (this will take a while)

```
$ azure storage blob copy show --blob bamarket_2016-06.vhd \
  --container vhds -a bamarketstorage \
  -k $SRC_ACCOUNT_KEY$
```

### Build the instance
1. In deployments branch test-arm-template, go to directory azure/
1. adjust ./mkRaiVM and the template to create the node.
    
