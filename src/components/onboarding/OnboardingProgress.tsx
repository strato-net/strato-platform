
import React from 'react';

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

const OnboardingProgress: React.FC<OnboardingProgressProps> = ({ 
  currentStep, 
  totalSteps 
}) => {
  return (
    <div className="flex justify-center items-center space-x-2 sm:space-x-4">
      {Array.from({ length: totalSteps }).map((_, index) => (
        <React.Fragment key={index}>
          <div 
            className={`w-3 h-3 sm:w-4 sm:h-4 rounded-full transition-all duration-300 flex items-center justify-center ${
              index <= currentStep 
                ? 'bg-strato-purple' 
                : 'bg-gray-300'
            }`}
          >
            {index < currentStep && (
              <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-white animate-pulse" />
            )}
          </div>
          
          {index < totalSteps - 1 && (
            <div 
              className={`h-0.5 w-10 sm:w-16 ${
                index < currentStep ? 'bg-strato-purple' : 'bg-gray-300'
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default OnboardingProgress;
