# What is EKS
Amazon Elastic Kubernetes Service (Amazon EKS) is a managed service that we can use to run Kubernetes on AWS without needing to install, operate, and maintain our own Kubernetes control panel. More detailed information can be found [here](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)

# Installing kubectl
Follow steps from [AWS documentation](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)

# Delete Existing Resources (Deployement, EFS Storage Class, Persistent Volume Claims and Persistent Volumes)
kubectl delete deployment strato
kubectl delete sc efs-sc
kubectl delete pvc kafka-pvc
kubectl delete pvc prometheus-pvc
kubectl delete pvc redis-pvc
kubectl delete pvc strato-pvc
kubectl delete pvc zookeeper-pvc
kubectl delete pvc postgres-pvc
kubectl delete pv kafka-pv
kubectl delete pv prometheus-pv
kubectl delete pv redis-pv
kubectl delete pv strato-pv
kubectl delete pv zookeeper-pv
kubectl delete pv postgres-pv

**Note that** *strato* above is the name of the deployment.

# Create EFS Storage Class
kubectl apply -f efs-sc.yaml

# Create Persistence Volumes
kubectl apply -f kafka-pv.yaml
kubectl apply -f prometheus-pv.yaml
kubectl apply -f redis-pv.yaml
kubectl apply -f strato-pv.yaml
kubectl apply -f zookeeper-pv.yaml
kubectl apply -f postgres-pv.yaml

# Create Persistence Volume Claims
kubectl apply -f kafka-pvc.yaml
kubectl apply -f prometheus-pvc.yaml
kubectl apply -f redis-pvc.yaml
kubectl apply -f strato-pvc.yaml
kubectl apply -f zookeeper-pvc.yaml
kubectl apply -f postgres-pvc.yaml

# Create New Deployment
kubectl apply -f deployment.yaml

# Create nginx Service
kubectl apply -f nginx-service.yaml

# Known Issues
* We are using old strato api by setting USE_OLD_STRATO_API as true. New strato api is using [hardcoded](https://github.com/blockapps/strato-platform/blob/develop/strato/api/strato-api/app/StratoAPIInit.hs#L26) postgres service. [STRATO-2805](https://blockapps.atlassian.net/browse/STRATO-2805) has been created for the fix.
* Vault-wrapper password needs to be set within strato container
Jump onto the starto container:
`kubectl exec -it <pod_name> -c strato -- bash`
Setting the password:
`curl -s -H "Content-Type: application/json" -d @- localhost:8000/strato/v2.3/password <<< \"hello\"`
