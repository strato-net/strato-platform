import { useState } from 'react';
import DepositModal from '../components/dashboard/DepositModal';

const DepositPage = () => {
  const [isOpen, setIsOpen] = useState(true);
  
  return (
    <DepositModal 
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
    />
  );
};

export default DepositPage; 