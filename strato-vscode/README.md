# STRATO IDE 

This extension interfaces with a running STRATO node using STRATO's API and a debugging API. The extension allows developers to interact with the STRATO blockchain and manage their STRATO dApps from a VS Code workspace.

## Nodes
First-time users will be prompted with a sample configuration file that can be used to get started
and connect to the STRATO Mercata network (`localhost` nodes can be used as well):

```
# STRATO VS Code Extension Node Configuration

VM: SolidVM
nodes:
  - id: 0
    label: node1 # Call this node whatever you like
    url: <nodeURL>
    oauth:
      openIdDiscoveryUrl: >-
        <openIdURL>/.well-known/openid-configuration
      clientId: <clientId>
      clientSecret: <clientSecret>
      # scope: <optional>

# You can have more than one node
# - id: 1
#	  label: ...
#	  url: ...
```

If more than one node is provided, the user can select the active node they
wish to send transactions to and query blockchain data from.

Once the configuration file is set, the user can log into the STRATO Mercata network
to start interacting with the blockchain!

![Nodes Demo 1](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/node-demo-1.gif)

## Contracts

Uploading a contract will add the newly created contract's blockchain address
to the Contracts view list where users can interact with functions and view state data.

![Contract Demo 1](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/contract-demo-1.gif)

Contracts can also be manually added by their address.

![Contract Demo 2](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/contract-demo-2.gif)

## Cirrus
Cirrus can be used to query data in specific contracts using state data as parameters:

![Contract Demo 2](https://raw.githubusercontent.com/blockapps/strato-vscode-images/main/cirrus-demo-1.gif)

[More information about to use Cirrus can be found in our API docs.](https://docs.blockapps.net/app-design-patterns/cirrus/)

## Debugger Setup
**NOTE: The following are required in order to use the debugger:**
- The STRATO node must be started with `VM_DEBUGGER=true`
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


## Troubleshooting
**I pressed step in/over/out while debugging, and the debugger appears to have resumed execution unexpectedly.**

Try pressing the pause button in the debugger control panel again

**I have configured my extension correctly, but I am still not able to connect to my node.**

Check to make sure that the OAuth configuration in your `config.yaml` file matches 
the OAuth configuration used on your selected node.
