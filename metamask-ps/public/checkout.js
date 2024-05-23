document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('paymentSelection');

    // Fetch options from the API
    const seller = req.query.seller; // TODO read request
    fetch(`http://${window.location.host}/metamask/checkout/options?seller=${seller}`, {
            method: "GET",
        })
        .then(response => response.json())
        .then(data => {
            // Assuming the API returns an array of options
            const { supported_tokens } = data;

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
                fetch(`${window.location.href}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        token: selectedOption.value,
                        checkout_total: 10 // TODO this should come from the checkout page
                    })
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
                    }).then((txHash) => { 
                        console.log(txHash)
                        // call completeOrder
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