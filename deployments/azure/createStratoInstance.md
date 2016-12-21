
##Creating a Strato instance on an Azure VM

### Setup

1. Install Azure CLI  ([Doc](https://azure.microsoft.com/en-us/documentation/articles/xplat-cli-install/) -  [Manual](https://azure.microsoft.com/en-us/documentation/articles/virtual-machines-command-line-tools/))

  ```npm install azure-cli -g```
  
1. Get the log-in credentails for:
  * BlockApps github repo `https://github.com/blockapps/deployments.git`
  * Azure portal (using the 'Ryan Reich' account)
  
### Create an Azure VM with containerized Strato

1. Latest deployment scripts

  ```
  git clone https://github.com/blockapps/deployments.git -b develop
  cd deployments/azure
  ```

1. Creatre your own Azure VM.  Make sure to use a unique name ($\_YOUR_NAME\_$) valid for use in url

  This step requires Azure log-in. Make sure to get the credentials for the portal. 
  Follow the prompt instructions, enter the provided code, and click on "Ryan Reich")   

  `./mkTesterVM $_YOUR_NAME_$`

  >Sample Response:

  ```shell
  $ ./mkTesterVM $_YOUR_NAME_$
  info:    Executing command vm create
  + Looking up the VM "$_YOUR_NAME_$vm"                                                
  info:    Using the VM Size "Standard_DS1_v2"
  info:    The [OS, Data] Disk or image configuration requires storage account
  + Looking up the storage account blockapps                                     
  info:    Using "https://blockapps.blob.core.windows.net/system/Microsoft.Compute/Images/vhds/blockapps5209-osDisk.008fce60-6235-45fc-8f79-6f8798b64eb2.vhd" as the user image.
  + Looking up the NIC "$_YOUR_NAME_$vmnic"                                            
  info:    An nic with given name "$_YOUR_NAME_$vmnic" not found, creating a new one
  + Looking up the virtual network "strato-dev3"                                 
  info:    Found an existing virtual network "strato-dev3"
  info:    Existing Subnets:
  info:      default:10.13.0.0/24
  info:    Verifying subnet
  + Looking up the subnet "default" under the virtual network "strato-dev3"      
  info:    Subnet with given name "default" exists under the virtual network "strato-dev3", using this subnet
  info:    Found public ip parameters, trying to setup PublicIP profile
  + Looking up the public ip "$_YOUR_NAME_$vmip"                                       
  info:    PublicIP with given name "$_YOUR_NAME_$vmip" not found, creating a new one
  + Creating public ip "$_YOUR_NAME_$vmip"                                             
  + Looking up the public ip "$_YOUR_NAME_$vmip"                                       
  + Creating NIC "$_YOUR_NAME_$vmnic"                                                  
  + Looking up the NIC "$_YOUR_NAME_$vmnic"                                            
  + Creating VM "$_YOUR_NAME_$vm"                                                      
  info:    vm create command OK
  ```

### Install Strato

If needed, build your own [version of Strato](https://github.com/blockapps/deployments/blob/master/gocd/buildStrato.md)

1. ssh into the machine  (u/p:  blockapps/the-usual-12)

  `ssh blockapps@$_YOUR_NAME_$.centralus.cloudapp.azure.com`

1. Get the installation scripts (requires github credentials)
  
  `git clone https://github.com/blockapps/deployments.git -b develop && cd deployments/docker`

1. Log into our docker registry  (u/p:  blockapps/the-usual-12)

  `docker login auth.blockapps.net:5000`

1. Install the Strato docker images from the registry, and start a single node
  * to install `latest` 

  `./init-strato.sh single`
  
  * to install a specific version
  
  `stratoVersion=$VERSION ./init-strato.sh single`
  
  Expect docker pull progress bars, ending with 

  ```
  Creating docker_bloc_1
  Creating docker_zookeeper_1
  Creating docker_explorer_1
  Creating docker_kafka_1
  Creating docker_nginx_1
  Creating docker_strato-single_1
  ```

### Testing the deployment

1. Test that strato startup completed

  `docker logs docker_strato-single_1`

  Expect:

  ```
  strato-setup: KafkaInvalidBroker (Leader {_leaderId = Nothing})
  Creating a random coinbase
  Registering with the blockchain explorer
  Starting strato-adit and strato-quarry
  Starting strato-index
  Starting ethereum-vm
  Becoming strato-api
  ```

1. Test Strato REST API  (from a local command line)

  `curl blockapps@$_YOUR_NAME_$.centralus.cloudapp.azure.com:8000`
  
  Expect:
  
  ```
  home page!
  ```

1. Test 

  `curl $_YOUR_NAME_$.centralus.cloudapp.azure.com/eth/v1.2/block?number=0`

  Expect something like
  
  ```json
  [{"next":"/eth/v1.0/block?index=1&number=0","kind":"Block","blockUncles":[],"receiptTransactions":[],"blockData":{"extraData":0,"gasUsed":0,"gasLimit":314159200,"kind":"BlockData","unclesHash":"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347","mixHash":"0000000000000000000000000000000000000000000000000000000000000000","receiptsRoot":"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","number":0,"difficulty":131072,"timestamp":"1970-01-01T00:00:00.000Z","coinbase":"0","parentHash":"0000000000000000000000000000000000000000000000000000000000000000","nonce":42,"stateRoot":"3f88486d3d9d7e45e3942ec1ec91319b5a99166ae81288d21ff1a0ec73d5a01e","transactionsRoot":"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"}}]
  ```

1. Test

  `$ curl  http://$_YOUR_NAME_$.centralus.cloudapp.azure.com/eth/v1.2/account?address=$(curl -s -d "password=test&faucet=1" http://$_YOUR_NAME_$.centralus.cloudapp.azure.com:8000/users/accountTest)`
  
  Expect something like:
  
  `[{"contractRoot":"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","kind":"AddressStateRef","balance":"1000000000000000000000","address":"a7e7bc35a5655bf5ced6df62c5ba9d6c91617889","latestBlockNum":9,"code":"","nonce":0}]`

### Update Strato
In order to pull the latest version on an existing instance:
   ```
   docker rm --force $(docker ps -a -q)
   docker rmi $(docker images -q)
   ```
   
# IMPORTANT
Please delete your instance once testing is completed.


  
