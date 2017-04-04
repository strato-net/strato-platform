githubCredentials = [[$class: 'UsernamePasswordMultiBinding', usernameVariable: 'USR', passwordVariable: 'GITHUB_TOKEN', credentialsId: 'blockapps-cd-github']]
ansiColor('xterm') {
    node('strato-integration') {
        withDockerRegistry([credentialsId: 'registry-aws-blockapps', url: 'https://registry-aws.blockapps.net:5000/']) {
            stage('CleanupRunningInstance') {
                sh '''#!/bin/bash -l    
                cd silo
                docker-compose kill && docker-compose -v down
                docker ps
                cd ../
                sudo rm -rf silo
                '''
            }
            stage('DeployMultinode') {
                withCredentials([usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'), usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GH_PASSWD', usernameVariable: 'GH_USER')]) {
                    sh '''#!/bin/bash -l
                    docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
                    git config --global credential.helper store
                    git clone https://$GH_USER:$GH_PASSWD@github.com/blockapps/silo.git
                    cd silo
                    cp /home/blockapps/basil .
                    ./basil clone
                    ./basil build
                    ./basil multinode -c 2 > docker-compose.yml
                    genesisBlock=$(< gb.json) lazyBlocks=false miningAlgorithm=SHA apiUrlOverride=http://strato:3000 blockTime=2 minBlockDifficulty=8192 docker-compose up -d
                    docker ps    
                    '''
                }
            }
            stage('E2E-Test') {
                sh '''#!/bin/bash -l
                cd silo/e2e
                npm i
                ./node_modules/mocha/bin/mocha e2e
                '''
            }
        }
    }  
}
