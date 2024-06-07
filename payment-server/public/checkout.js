document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('paymentSelection');

    // Fetch options from the API
    const queryParams = new URLSearchParams(window.location.search);
    const orderHash = queryParams.get('orderHash') || '';
    const redirectUrl = queryParams.get('redirectUrl') || ''
    let orderInfo = {}
    let currency_amount = 0
    fetch(`${window.location.protocol}//${window.location.host}/metamask/order?orderHash=${orderHash}`, {
            method: "GET",
        })
        .then(response => { 
            console.log(response);
            response.json();
        })
        .then(data => {
            console.log(data);
            // Assuming the API returns an array of options
            orderInfo = data;
            const { supported_tokens } = data; // TODO return address as well?

            // Create radio buttons for each option
            supported_tokens.forEach(option => {
                const label = document.createElement('label');
                const input = document.createElement('input');

                input.type = 'radio';
                input.name = 'option';
                input.value = option;
                label.appendChild(input);
                label.appendChild(document.createTextNode(option));

                // Append the label to the form
                form.appendChild(label);
                form.appendChild(document.createElement('br'));
            });
        })
        .catch(error => {
            console.error('Error fetching options:', error);
        });

        // Handle form submission
        form.addEventListener('submit', (event) => {
            event.preventDefault(); 
            const selectedOption = form.querySelector('input[name="option"]:checked');

            if (selectedOption) {
                fetch(`${window.location.protocol}//${window.location.host}/metamask/tx/params?checkout_total=${orderInfo?.orderEvent?.amount}&currency=${selectedOption.value}&username=${orderInfo.sellerCommonName || ''}`, {
                    method: 'GET'
                })
                .then(response => response.json())
                .then(async (txParams) => {
                    console.log(txParams)
                    const accounts = await window.ethereum.request({ method: "eth_requestAccounts"})
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