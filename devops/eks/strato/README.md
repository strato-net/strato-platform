# What is EKS
Amazon Elastic Kubernetes Service (Amazon EKS) is a managed service that we can use to run Kubernetes on AWS without needing to install, operate, and maintain our own Kubernetes control panel. More detailed information can be found [here](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)

# Installing kubectl
Follow steps from [AWS documentation](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)

# AWS EBS for volumes
This template uses AWS EBS volumes for container volumes. For AWS EFS volumes see the ./efs subfolder

# Delete Existing Resources (Deployement, EFS Storage Class, Persistent Volume Claims and Persistent Volumes)
kubectl delete deployment strato
kubectl delete service nginx-service
**Note that** *strato* above is the name of the deployment.

# Create New Deployment
**Note:**
Replace image *REPO_URL and VERSION* in eks-strato-deployment.tpl.yaml file and rename this file as *eks-strato-deployment.yaml*
Replace volume id place holders
* *prometheus-data-volume-id* is *vol-0334b826317434504*
* *kafka-data-volume-id* is *vol-0334b826317434504*
* *redis-data-volume-id* is *vol-0fd90c145c88224d2*
* *zookeeper-data-volume-id* is *vol-09a78def133bc911c*
* *strato-data-volume-id* is *vol-01c298651694dcfce*
* *postgres-data-volume-id* is *vol-0a4ac71b70905f806*
cp eks-strato-deployment.tpl.yaml eks-strato-deployment.yaml
kubectl apply -f eks-strato-deployment.yaml

# Create nginx Service
kubectl apply -f nginx-service.yaml

# Known Issues
* We are using old strato api by setting USE_OLD_STRATO_API as true. New strato api is using [hardcoded](https://github.com/blockapps/strato-platform/blob/develop/strato/api/strato-api/app/StratoAPIInit.hs#L26) postgres service. [STRATO-2805](https://blockapps.atlassian.net/browse/STRATO-2805) has been created for the fix.
* Vault-wrapper password needs to be set within strato container
Jump onto the starto container:
`kubectl exec -it <pod_name> -c strato -- bash`
Setting the password:
`curl -s -H "Content-Type: application/json" -d @- localhost:8000/strato/v2.3/password <<< \"hello\"`
