document.getElementById('tokenSelection').addEventListener('submit', event => {
    const onboarding = new MetaMaskOnboarding();
    let accounts;

    const requestAccount = async () => {
        event.preventDefault();
        
        const formData = new FormData(event.target);
        const selectedOptions = [];
        
        formData.forEach((value, key) => {
            if (key === 'option') {
            selectedOptions.push(value);
            }
        });

        if (selectedOptions.length > 0) {
            await window.ethereum.request({
                method: 'eth_requestAccounts',
                params: []
            }).then(window.ethereum.on("accountsChanged", (accts) => {
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
                    console.log(res)
                    if (res.status === 204) {
                        console.log(`success - user's metamask account has been onboarded with tokens ${selectedOptions}`)
                    } else {
                        console.log("error - something has gone wrong")
                    }
                    const queryParams = new URLSearchParams(window.location.search)
                    window.location.replace(queryParams.get('redirectUrl'))
                })
            }))
        } else {
            alert('Must select a fucking token')
        }
    };

    if (MetaMaskOnboarding.isMetaMaskInstalled()) {
        requestAccount();
    } else {
        onboarding.startOnboarding();
        // this probably isn't right
        window.ethereum 
            .on("accountsChanged", (newAccounts) => {
                if (accounts && accounts.length === 1) {
                    console.log(accounts)
                    accounts = newAccounts;
                    onboarding.stopOnboarding();
                }
            });
    }
});