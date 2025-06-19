import { useState } from 'react';
import DepositOptionsModal from '../components/dashboard/DepositOptionsModal';

const DepositOptionsPage = () => {
  const [isOpen, setIsOpen] = useState(true);
  
  const handleOptionSelect = (option: 'credit-card' | 'bridge') => {
    console.log('Selected option:', option);
    // Handle option selection logic here
  };
  
  return (
    <DepositOptionsModal 
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      onSelectOption={handleOptionSelect}
    />
  );
};

export default DepositOptionsPage; 