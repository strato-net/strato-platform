const selectedOptions = [];
const { ethereum } = window;
let onboarding;

// Polling to check if MetaMask is installed
function pollMetaMaskInstall() {
    const btn = document.getElementById('connect');
    const metaMaskCheck = setInterval(() => {
        if (!MetaMaskOnboarding.isMetaMaskInstalled()) {
            clearInterval(metaMaskCheck);
            btn.innerText = 'Connect to MetaMask';
            btn.disabled = false;
            console.debug('MetaMask has been installed.');
            onboarding.stopOnboarding();
            window.location.reload();
        }
    }, 5000);

    metaMaskCheck();
}

function metaMaskOnboardingStatus() {
    if (!MetaMaskOnboarding.isMetaMaskInstalled()){
        onboarding = new MetaMaskOnboarding()
        onboarding.startOnboarding()

        const btn = document.getElementById('connect').disabled = true;
        btn.disabled = true;
        btn.innerText = "Installing MetaMask..."

        pollMetaMaskInstall()
    }
}

function handleWalletSubmission(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    
    formData.forEach((value, key) => {
        if (key === 'option') {
            selectedOptions.push(value);
        }
    });

    if (selectedOptions.length > 0) {
        ethereum
            .request({ method: 'eth_requestAccounts' })
            .then(handleAccountsChanged)
            .catch((err) => { console.log(err); })
    } else {
        alert('Must select at least 1 token.')
    }
}

function handleAccountsChanged(accts) {
    // If a user selects multiple addresses (because they're a jerk)
    // then just take the first one from the list
    fetch(`${window.location.href}&address=${accts[0]}` , {
        method: "POST",
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ supported_tokens: selectedOptions })
    })
    .then(res => {
        if (res.status === 204) {
            console.debug(`success - user's metamask account has been onboarded with tokens ${selectedOptions}`)
        } else {
            console.debug("error - something has gone wrong")
        }
        const queryParams = new URLSearchParams(window.location.search)
        window.location.replace(queryParams.get('redirectUrl'))
    })
}

document.addEventListener('DOMContentLoaded', metaMaskOnboardingStatus)

document.getElementById('tokenSelection').addEventListener('submit', handleWalletSubmission);