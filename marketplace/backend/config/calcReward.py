import requests
import json
import os
import pandas as pd

def get_access_token():
    # Keycloak token endpoint
    token_url = "https://keycloak.blockapps.net/auth/realms/mercata-testnet2/protocol/openid-connect/token"
    
    # Headers and data for token request
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic bG9jYWxob3N0LWRhdmlkLW46ZjEyNzdkNTUtOGUwNy00NzIwLWI1N2ItOGJiMjBmOWRiMmM0'
    }
    data = {
        'grant_type': 'password',
        'username':'blockapps',
        'password': 'Bl0ck@pps'
    }
    
    response = requests.post(token_url, headers=headers, data=data)
    response.raise_for_status()
    return response.json()['access_token']

def calculate_apy(reward_difference: int, collateral_value: float, days_difference: float) -> float:
    # Correct conversion: 10^18 Cata = 0.1 USD
    reward_usd = (reward_difference / 10**18) * 0.1
    
    # Calculate rate based on the actual time period
    rate = reward_usd / collateral_value
    annual_rate = (rate * 365) / days_difference
    apy = annual_rate * 100
    return apy

def fetch_escrow_history(root: str, borrower_common_name: str, output_file: str = "escrow_history.xlsx"):
    # Get access token dynamically
    access_token = get_access_token()
    
    # Base URL of the endpoint
    base_url = "https://marketplace.mercata-testnet2.blockapps.net/cirrus/search/history@BlockApps-Mercata-Escrow"
    
    # Add authorization header with dynamic token
    headers = {
        "Authorization": f"Bearer {access_token}"
    }
    
    # Query parameters
    params = {
        "root": f"eq.{root}",
        "borrowerCommonName": f"eq.{borrower_common_name}"
    }
    
    # Make the GET request with headers
    response = requests.get(base_url, params=params, headers=headers)
    response.raise_for_status()
    
    # Get full data and filter for specific fields
    data = response.json()
    
    # Sort data by timestamp
    sorted_data = sorted(data, key=lambda x: x['timeStamp'])
    filtered_data = []
    
    for i in range(1, len(sorted_data)):
        current = sorted_data[i]
        previous = sorted_data[i-1]
        
        # Calculate time difference in days
        current_timestamp = pd.to_datetime(current['timeStamp'])
        previous_timestamp = pd.to_datetime(previous['timeStamp'])
        days_difference = (current_timestamp - previous_timestamp).total_seconds() / (24 * 3600)
        
        # Calculate reward difference
        current_reward = int(current['totalCataReward'])
        previous_reward = int(previous['totalCataReward'])
        reward_difference = current_reward - previous_reward
        
        filtered_data.append({
            'assetRootAddress': current['assetRootAddress'],
            'borrowerCommonName': current['borrowerCommonName'],
            'collateralQuantity': current['collateralQuantity'],
            'collateralValue': current['collateralValue'],
            'reserve': current['reserve'],
            'maxLoanAmount': current['maxLoanAmount'],
            'totalCataReward': current['totalCataReward'],
            'rewardDifference': reward_difference,
            'timestamp': current['timeStamp'],
            'daysSinceLastReward': days_difference,
            'apy': calculate_apy(
                reward_difference,
                float(current['collateralValue']),
                days_difference
            ) if reward_difference > 0 and days_difference > 0 else 0
        })
    
    # Convert filtered data to DataFrame and export to Excel
    df = pd.DataFrame(filtered_data)
    df.to_excel(output_file, index=False)
    return filtered_data

if __name__ == "__main__":
    # Example usage:
    # Provide the specific root and borrowerCommonName values here
    ROOT_VALUE = "cbcd281f5ad05d42945cbf97ccbacf8aab3738af"
    COMMON_NAME_VALUE = "Maya Konaka"
    
    result = fetch_escrow_history(ROOT_VALUE, COMMON_NAME_VALUE)
    
    # Print the filtered results as JSON
    print(json.dumps(result, indent=2))
