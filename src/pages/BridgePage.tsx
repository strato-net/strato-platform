import { useState } from 'react';
import BridgeModal from '../components/dashboard/BridgeModal';

const BridgePage = () => {
  const [isOpen, setIsOpen] = useState(true);
  
  return (
    <BridgeModal 
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
    />
  );
};

export default BridgePage; 