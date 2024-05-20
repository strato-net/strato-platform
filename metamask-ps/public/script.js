window.addEventListener("DOMContentLoaded", () => {
    const onboarding = new MetaMaskOnboarding();
    let accounts;

    const requestAccount = async () => {
        await window.ethereum.request({
            method: 'eth_requestAccounts',
            params: []
        }).then(window.ethereum.on("accountsChanged", (newAccounts) => {
            fetch(`${window.location.href}&address=${newAccounts[0]}` , {
                method: "POST",
            })
            .then(res => {
                if (res.status === 200) {
                    console.log("success - user's metamask account has been onboarded")
                } else {
                    console.log("error - something has gone wrong")
                }
            })
            .then(() => {
                const queryParams = new URLSearchParams(window.location.search)
                window.location.replace(queryParams.get('redirectUrl'))
            })
        }))
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