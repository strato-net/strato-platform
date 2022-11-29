# What is EKS
Amazon Elastic Kubernetes Service (Amazon EKS) is a managed service that we can use to run Kubernetes on AWS without needing to install, operate, and maintain our own Kubernetes control panel. More detailed information can be found [here](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)

# Installing kubectl
Follow steps from [AWS documentation](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)

# Check Existing Deployment
kubectl get deployment strato-platform

# Delete Existing Deployment
kubectl delete deployment strato-platform

**Note that** *strato-platform* above is the name of the deployment.

# Create Persistence Volume Claims
kubectl apply -f kafka-pvc.yaml
kubectl apply -f prometheus-pvc.yaml
kubectl apply -f redis-pvc.yaml
kubectl apply -f strato-pvc.yaml
kubectl apply -f zookeeper-pvc.yaml

# Create New Deployment
kubectl apply -f deployment.yaml 

# Known Issues
* We are using old strato api by setting USE_OLD_STRATO_API as true. New strato api is using [hardcoded](https://github.com/blockapps/strato-platform/blob/develop/strato/api/strato-api/app/StratoAPIInit.hs#L26) postgres service. [STRATO-2805](https://blockapps.atlassian.net/browse/STRATO-2805) has been created for the fix.
* Vault-wrapper password needs to be set within strato container
Jump onto the starto container:
`kubectl exec -it <pod_name> -c strato -- bash`
Setting the password:
`curl -s -H "Content-Type: application/json" -d @- localhost:8000/strato/v2.3/password <<< \"hello\"`
