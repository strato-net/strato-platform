import Joi from '@hapi/joi';

interface ValidationResult {
  success: boolean;
  error?: string;
}

interface EthToStratoRequest {
  amount: string;
  fromAddress: string;
  toAddress: string;
  userToken: string;
  tokenAddress: string;
  ethHash: string;
}

export class BridgeValidator {
  public validateEthToStrato(data: EthToStratoRequest): string | null {
    const schema = Joi.object({
      amount: Joi.string().required(),
      fromAddress: Joi.string().required(),
      toAddress: Joi.string().required(),
      userToken: Joi.string().required(),
      tokenAddress: Joi.string().required(),
      ethHash: Joi.string().required()
    });

    const { error } = schema.validate(data);
    return error ? error.details[0].message : null;
  }
}

export const validateEthToStratoRequest = (body: any): ValidationResult => {
  const { ethHash, fromAddress, toAddress, amount, tokenAddress } = body;

  // Check if all required fields are present
  if (!ethHash || !fromAddress || !toAddress || !amount || !tokenAddress) {
    return {
      success: false,
      error: 'Missing required fields'
    };
  }

  // Validate ethHash format (should be a valid transaction hash)
  if (!/^0x[a-fA-F0-9]{64}$/.test(ethHash)) {
    return {
      success: false,
      error: 'Invalid ETH transaction hash format'
    };
  }

  // Validate Ethereum addresses
  if (!/^0x[a-fA-F0-9]{40}$/.test(fromAddress) || !/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
    return {
      success: false,
      error: 'Invalid Ethereum address format'
    };
  }

  // Validate amount (should be a positive number)
  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    return {
      success: false,
      error: 'Amount must be a positive number'
    };
  }

  // Validate token address
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    return {
      success: false,
      error: 'Invalid token address format'
    };
  }

  return { success: true };
}; 