# STRATO VS Code Extension

This extension interfaces with a running STRATO node using STRATO's API and a debugging API. The extension allows developers to interact with the STRATO blockchain and manage their STRATO dApp from a VS Code workspace.


## Project Management
The following commands can be used when there is an existing STRATO project in your VS Code workspace. This could be done either through `Open Folder` or by using `Import Project` command. The extension assumes that your project has a `backend/config` directory that contains a `mercata.config.yaml` file (but these can be changed in the `Extension Settings`).

![image](https://github.com/blockapps/strato-platform/assets/35979292/e28cc74d-1163-4b13-b518-6f3f96a23371)

### Import Project 
When a user clicks **Import Project**, they will be prompted to select their STRATO project directory. This will bring the project into the VS Code workspace and allow the other functions to interact with it.

### Build Project
When a user clicks **Build Project**, they will be prompted to select their `backend` and `frontend` directories in their project structures. The extension will build the `npm` package dependencies in the selected directories.

### Deploy Project
When a user clicks **Deploy Project**, the Dapp will be deployed to the STRATO node specified in the default `backend/config/mercata.config.yaml` file. The command uses (by default) `CONFIG=mercata yarn deploy` but this can be configured in `Extension Settings` (more in `Configuring Extension Scripts & Settings`).

### Run Servers
When a user clicks **Run Server** or **Run UI**, this will run the scripts that make the service available. These functions use the directories selected in **Build Project**.

### Run Tests
When a user clicks **Test Server** or **Test UI**, this will run the test suites in their respective directories. These functions use the directories selected in **Build Project**.


## Nodes
The default `backend/config/mercata.config.yaml` in your project should contain the information about the node(s) to be displayed:
```
apiDebug: true
timeout: 600000
VM: SolidVM
configDirPath: ./config
deployFilename: localhost.deploy.yaml
orgDeployFilename: org.deploy.yaml
serverHost:
serverIP:
orgName: BlockApps
bootMembersFilename: boot_members.yaml
cacheNonce: true

nodes:
  - id: 0
    label: mercata-testnet-node1
    url: https://node1.mercata-testnet.blockapps.net
    port: 30303
    oauth:
      appTokenCookieName: asset_framework_session
      appTokenCookieMaxAge: 7776000000
      openIdDiscoveryUrl: <openIdDiscoveryUrl>
      clientId: localhost
      clientSecret: <clientSecret>
      scope: email openid
      serviceOAuthFlow:
      redirectUri: http://localhost/api/v1/authentication/callback
      logoutRedirectUri: http://localhost
      tokenField:
      tokenUsernameProperty:
      tokenUsernamePropertyServiceFlow:

```
**Configuring Extension Scripts & Settings** will contain more information on how to change the default configuration file and scripts if your project does not use this file path.

## Contracts
You can view the contracts stored on a STRATO node, sorted by their contract name and their addresses:

![image](https://github.com/blockapps/strato-platform/assets/35979292/a25cbe08-40a8-4e63-95fe-330c8fc43e07)

Clicking an address will open the contract's state and allowing you to interact with the contract's functions and copy contract state values to your clipboard:

![image](https://github.com/blockapps/strato-platform/assets/35979292/de384fc7-fcd1-49cd-baac-5a2f69e53606)


## Cirrus
Cirrus can be used to query data in specific contracts based on their state data:
![image](https://github.com/blockapps/strato-platform/assets/35979292/d106cdc0-c904-48cd-8754-4a084bbd74d3)

The above queries the endpoint `STRATO_NODE/cirrus/search/Certificate`, essentially all the `Certificate` contracts.
![image](https://github.com/blockapps/strato-platform/assets/35979292/579c600c-59d2-47ba-8a5f-2d1e5a97de44)

[More information about to use Cirrus can be found in our API docs.](https://docs.blockapps.net/app-design-patterns/cirrus/)

## Debugger Setup
**NOTE: The following are required in order to use the debugger:**
- The STRATO node must be started with vmDebug=true
- The version of STRATO must be 7.0 or higher  

To set the Debugger up, click on the icon for **Run and Debug**. Click the dropdown for the box with the green play arrow. 

In the dropdown, select **Add Configuration...**, which will open the `launch.json` file with a dropdown.   
![Add confugration](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/add_configuration.png)

Click **Debug SolidVM** in the dropdown.   
![Debug SolidVM](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/launch_json.png)
![Configuration Set](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/strato_launch.png)

Go to the box with the green arrow once again and make sure **Debug SolidVM** is selected from the dropdown. Click the green play button itself, which should start the debugger.  
![Run and Debug SolidVM](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/debug_solidvm.png)
![Press Play](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/press_play.png)

## Configuring Extension Scripts & Settings
The scripts used for the various commands in the extension can be found by clicking the `Settings` icon in the `Project Management` view:

![image](https://github.com/blockapps/strato-platform/assets/35979292/a2253973-fc0b-428b-8180-dfc0b2e5c64e)

The scripts use the bare-minimum defaults to run a STRATO project but they can be changed to fit your project's structure and requirements. 

![image](https://github.com/blockapps/strato-platform/assets/35979292/713c6e06-2a9a-4fbb-8e1f-79680806eed6)

## Troubleshooting
**I pressed step in/over/out while debugging, and the debugger appears to have resumed execution unexpectedly.**

Try pressing the pause button in the debugger control panel again

**I have configured my extension correctly, but I am still not able to connect to my node.**

Check to make sure that the OAuth configuration in your config.yaml file matches the OAuth configuration used when starting the node.
