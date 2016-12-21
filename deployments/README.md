# deployments
Scripts and schemas to deploy our product

##To build the Docker image
- cd docker/v1.1
- cd usr/lib/strato/bin
- ./populate.sh (uses binaries in ~/.local/bin)
- cd -
- cd ..
- ./build v1.1
- docker push blockapps/strato:v1.1

##To deploy on Azure
1. Pull this repository, of course.
2. `v1.1/deploy <name> core` will start up *one* node; the hotplug nodes will attach to it.
3. `dashboard/deploy <name> <email> 1` will  start a dashboard looking at that node.
4. `v1.1/deploy <name> hotplug <index>` will create a new node labeled by the index number, attach it to the core, and also register it with the dashboard.
Jobs 2 and 3 *can* be somewhat concurrent, but you have to wait at least until the Azure portal tells you that Job 2 is at the stage of deploying the virtual machine to start Job 2.
Jobs 3 and 4 can also be concurrent, so long as you don't start any Job 4 until Job 3 is in the stage of deploying the Docker Extension, because the dashboard should be up before any hotplug node.
You can run any number of Job 4's in parallel.

##Once deployed
The deployment script produces outputs summarizing the network and login info
for the nodes you created.  You can use those to ssh into the machines and to
reach the API server.

To get into the Docker containers themselves, you must run
```
docker exec -it strato /bin/bash
```
once ssh'd in; or, in one step:
```
ssh -t <user>@<host> docker exec -it strato /bin/bash
```
You can use the same construction to perform other operations, for instance,
`less -R /var/log/strato/ethereum-vm` to see the VM operations output.

##New instance checklist
###Run each time an instance is created or changed:

1. Access Launch page and help
2. Check last 10 blocks - Should only be 1
3. Hit faucet 2 times
4. Check last 10 blocks - Should be 3
5. Run Bloc and upload payout and run it a couple time
6. Check all transactions from Payout
7. Run Bloc and upload Multisig and run it a couple of times
8.  Check all transactions from Multisig

## Azure CLI deployment
```
$ npm install azure-cli [-g]
$ azure config mode arm
$ azure login
```
deploy
```
$ docker/v1.1/deploy $NAME$ $COUNT$
```
node url (nodes.yml)
```
http://$NAME$1.centralus.cloudapp.azure.com/
```
delete (the node must be deleted before deployed again with the same name)
```
$ azure group delete $NAME$
```
