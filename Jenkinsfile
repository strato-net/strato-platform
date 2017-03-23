githubCredentials = [[$class: 'UsernamePasswordMultiBinding', usernameVariable: 'USR', passwordVariable: 'GITHUB_TOKEN', credentialsId: 'blockapps-cd-github']]
ansiColor('xterm') {
    node('linux') {
        withDockerRegistry([credentialsId: 'registry-aws-blockapps', url: 'https://registry-aws.blockapps.net:5000/']) {
        withDockerContainer(args: '-u root -v /var/run/docker.sock:/var/run/docker.sock -v /datadrive/ci-build/strato-docker-build-mount:/root -v /home/blockapps/.docker:/root/.docker',
                            image: 'registry-aws.blockapps.net:5000/blockapps/basil-build-agent:latest') {
            stage('Checkout') {
                checkout scm
                  withCredentials(githubCredentials) {
                      sh '''
                      git config --global credential.helper store
                      go get github.com/aktau/github-release
                      export GITHUB_TOKEN=$GITHUB_TOKEN
                      github-release download -u blockapps -r basil -l -n basil-linux_amd64
                      mv basil-linux_amd64 basil
                      chmod a+x basil
                      '''
                    }
            }
            stage('Build') {
                withCredentials(githubCredentials) {
                    sh '''
                    git config credential.helper 'store --file=/root/.git-credentials '
                    git clone https://$USR:$GITHUB_TOKEN@github.com/blockapps/silo.git -b monostrato-cutover
                    rm -rf silo
                    ./basil clone
                    ./basil build
                    '''
                }
            }
            }
        }  
    }
}
