// TODO HANDLE MetaMask 
document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('paymentSelection');
    const button = form.querySelector('button[type="submit"]');

    // Fetch options from the API
    const queryParams = new URLSearchParams(window.location.search);
    const orderHash = queryParams.get('orderHash') || '';
    const redirectUrl = queryParams.get('redirectUrl') || ''
    let orderInfo = {}
    let currency_amount = 0
    try {
        const res = await fetch(`${window.location.protocol}//${window.location.host}/metamask/order/info?orderHash=${orderHash}`, {
                method: "GET",
            });
        const body = await res.json();
        // Assuming the API returns an array of options
        orderInfo = body;
        const { supported_tokens } = body; // TODO return address as well?

            // Create radio buttons for each option
        supported_tokens.forEach(option => {
            const label = document.createElement('label');
            const input = document.createElement('input');

            input.type = 'radio';
            input.name = 'option';
            input.value = option;
            label.appendChild(input);
            label.appendChild(document.createTextNode(option));

            // Create a line break element
            const br = document.createElement('br');

            // Insert the label before the button
            form.insertBefore(label, button);

            // Insert the line break before the button
            form.insertBefore(br, button);
        });
    } catch(error) {
            console.error('Error fetching options:', error);
    };

    // Handle form submission
    form.addEventListener('submit', (event) => {
        event.preventDefault(); 
        const selectedOption = form.querySelector('input[name="option"]:checked');

        if (selectedOption) {
            fetch(`${window.location.protocol}//${window.location.host}/metamask/tx/params?checkout_total=${orderInfo?.checkoutEvent?.amount}&currency=${selectedOption.value}&username=${orderInfo.sellerCommonName || ''}`, {
                method: 'GET'
            })
            .then(response => response.json())
            .then(async (txParams) => {
                console.log(txParams)
                const accounts = await window.ethereum.request({ method: "eth_requestAccounts"})
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: txParams.networkId }]
                })
                await window.ethereum.request({
                    method: "eth_sendTransaction",
                    params: [{
                        from: accounts[0],
                        ...txParams
                    }]
                }).then((txHash) => console.log(txHash))
            })
            .then(async () => {
                fetch(`${window.location.href}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        currency: selectedOption.value,
                        orderHash: orderHash, 
                    })
                })
                .then(response => response.json())
                .then(({ assets }) => {
                    window.location.href = `${redirectUrl}?assets=${assets}`;
                })
            })
            .catch((error) => {
                console.error('Error:', error);
            });
        } else {
            alert('Please select an option.');
        }
    });
});