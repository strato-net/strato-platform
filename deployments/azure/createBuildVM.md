# Spin a new Build VM

### Setup

1. Install Azure CLI  ([Doc](https://azure.microsoft.com/en-us/documentation/articles/xplat-cli-install/) -  [Manual](https://azure.microsoft.com/en-us/documentation/articles/virtual-machines-command-line-tools/))

  ```npm install azure-cli -g```

1. Get the log-in credentails for:
  * BlockApps github repo `https://github.com/blockapps/deployments.git`
  * Azure portal (using the 'Ryan Reich' account)
  
#### Get the deployment scripts
* `git clone https://github.com/blockapps/deployments.git -b develop`

#### Create the VM
Use your initials and an optional numeric identifier. Make sure the name is unique.  Example: `jh2`.

The final url will look like: `cd-$NAME$.eastus.cloudapp.azure.com`
* `cd deployments/azure`
* `./mkBuildTwoVM $NAME$`
* When prompted, go to `https://aka.ms/devicelogin`, enter the code, and click on 'Ryan Reich'.

# Configure your new VM
#### Login:
* `ssh strato@cd-$NAME$.eastus.cloudapp.azure.com`
* password: funny

#### Set server:
* get the local IP `hostname --ip-address`
* edit `/etc/default/go-agent`
 * `GO_SERVER=$LOCAL_IP$`

#### Set slack notifications
* edit `~go/go_notify.conf`
  * `server-host = "http://cd-$NAME$.eastus.cloudapp.azure.com:8153/"`
  * `channel = "@$SLACK_NAME$"`

#### Login into the registry
* `docker login auth.blockapps.net:5000`
* u/p:  blockapps/the-usual-123

#### Start the GoCd server and agent
* `sudo cp ~/go-binaries/go-* /etc/init.d/`
* `sudo /etc/init.d/go-agent start`
* `sudo /etc/init.d/go-server start`

#### Sign in to the web interface 
Take a moment, and wait for the server to start. Log into the web interface:
* url: `http://cd-$NAME$.eastus.cloudapp.azure.com:8153/go/auth/login`
* u/p:  admin/funny

#### Attach the go-agent to the go-server
* Click on the `Agents` tab in the top nav
* Refresh the page until the agent shows up in the list with the right IP address and status `idle`
* Select the agent and click `enable`

#### Test pipeline
* pipeline: test_exit_code
* press the play button
* expect
  * passed
  * slack notification on start and end of the build process
