/**
 * Rounds down a decimal string to the specified number of decimal places
 * using string manipulation to avoid floating point precision issues.
 * 
 * @param value - The decimal string to round
 * @param decimals - The number of decimal places to round to
 * @returns The rounded decimal string
 */
export const roundToDecimals = (value: string, decimals: number): string => {
  if (!value || !decimals) return value;
  
  // Split by decimal point
  const parts = value.split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1] || '';
  
  // Ensure proper decimal format (add 0 if integer part is empty)
  const normalizedIntegerPart = integerPart || '0';
  
  // If no decimal part, return just the integer part
  if (!decimalPart) {
    return normalizedIntegerPart;
  }
  
  // If decimal part is shorter than required decimals, return normalized value
  if (decimalPart.length < decimals) {
    return `${normalizedIntegerPart}.${decimalPart}`;
  }
  
  // If decimal part is longer than required decimals, truncate
  if (decimalPart.length > decimals) {
    const truncatedDecimal = decimalPart.substring(0, decimals);
    return `${normalizedIntegerPart}.${truncatedDecimal}`;
  }
  
  // If decimal part is exactly the right length, return normalized value
  return `${normalizedIntegerPart}.${decimalPart}`;
};

/**
 * Adds commas to the integer part of a decimal string for better readability
 * 
 * @param value - The decimal string to format
 * @returns The formatted string with commas in the integer part
 */
export const addCommasToInput = (value: string): string => {
  if (!value) return '';
  
  const parts = value.split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  if (parts.length === 2) {
    return integerPart + '.' + parts[1];
  }
  
  return integerPart;
}; 

export const truncateAddress = (address: string | null | undefined, front: number = 6, back: number = 4) => {
    if (!address) return "N/A";
    if (address.length <= front + back) return address;
    return `${address.substring(0, front)}...${address.substring(address.length - back)}`;
  };