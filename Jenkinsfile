githubCredentials = [[$class: 'UsernamePasswordMultiBinding', usernameVariable: 'USR', passwordVariable: 'GITHUB_TOKEN', credentialsId: 'blockapps-cd-github']]
ansiColor('xterm') {
    node('cd9') {
        withDockerRegistry([credentialsId: 'registry-aws-blockapps', url: 'https://registry-aws.blockapps.net:5000/']) {
            stage('CleanupRunningInstance') {
               sh '''#!/bin/bash -l    
                cd strato
                docker-compose kill && docker-compose -v down
                docker ps
                cd ../
                sudo rm -rf strato
                '''
            }
            stage('DeployMultinode') {
                withCredentials([usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'), usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GH_PASSWD', usernameVariable: 'GH_USER')]) {
                    sh '''#!/bin/bash -l
                    docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
                    git config --global credential.helper store
                    git clone https://$GH_USER:$GH_PASSWD@github.com/blockapps/strato.git
                    cd strato
                    cp /home/blockapps/basil .
                    ./basil clone
                    ./basil build
                    ./basil multinode -c 2 > docker-compose.yml
                    lazyBlocks=false miningAlgorithm=SHA apiUrlOverride=http://strato:3000 blockTime=2 minBlockDifficulty=8192 docker-compose up -d
                    docker ps    
                    '''
                }
            }
            // this stage is currently running 'stack test ...' meaning it
            // it depends only on the build environment
            stage('unit-test') {
                sh '''#!/bin/bash -l
                pwd
                cd strato/repos/monstrato
                make unit
                '''
            }
            // this stage needs running dependent docker images such as redis
            // they run with strato running but preferrably they are turned off
            // and are run with 'deep-test'
            stage('integration-test') {
                sh '''#!/bin/bash -l
                pwd
                cd strato/repos/monstrato
                make test-suite
                '''
            }
            // this stage also depends on the docker images but we need all
            // strato components turned off (such as `ethereum-vm`)
            stage('deep-test') {
                sh '''#!/bin/bash -l
                pwd
                cd strato/repos/monstrato
                make vm-test
                '''
            }
            // this stage needs a fully running strato (multi) node environment
            stage('E2E-Test') {
                sh '''#!/bin/bash -l
                pwd
                cd strato/repos/monstrato
                make multinode
                '''
            }
        }
    }  
}
