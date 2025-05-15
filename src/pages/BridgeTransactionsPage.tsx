import { useState } from 'react';
import BridgeTransactionsModal from '../components/dashboard/BridgeTransactionsModal';

const BridgeTransactionsPage = () => {
  const [isOpen, setIsOpen] = useState(true);
  
  return (
    <BridgeTransactionsModal 
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
    />
  );
};

export default BridgeTransactionsPage; 