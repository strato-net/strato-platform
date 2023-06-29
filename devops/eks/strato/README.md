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
Replace below place holders with valid values:
* *REPO_URL*
* *VERSION*
* *REPLACE_WITH_OAUTH_CLIENT_ID*
* *REPLACE_WITH_OAUTH_CLIENT_SECRET*
* *REPLACE_WITH_EXT_STORAGE_S3_ACCESS_KEY_ID*
* *REPLACE_WITH_EXT_STORAGE_S3_SECRET_ACCESS_KEY*
* *REPLACE_WITH_STRIPE_PUBLISHABLE_KEY*
* *REPLACE_WITH_STRIPE_SECRET_KEY*
Replace volume id place holders
* *marketplace-data-volume-id* as *vol-010a0925f5e0b2833*
* *postgres-data-volume-id* as *vol-0a5c04b368b765447*
* *prometheus-data-volume-id* as *vol-00def41e973042bd7*
* *kafka-data-volume-id* as *vol-0d3e6c8fff227730c*
* *redis-data-volume-id* as *vol-0092839fe3c100b4b*
* *strato-data-volume-id* as *vol-00df2d49bd1404a51*
* *zookeeper-data-volume-id* as *vol-08ebb8227e58c0fa3*

Rename the template file
cp eks-strato-deployment.tpl.yaml eks-strato-deployment.yaml
# Create deployment Service
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
