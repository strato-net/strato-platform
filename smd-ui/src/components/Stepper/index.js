import React from 'react';
import './stepper.css';
import step1LogoActive from './step-1-active.png';
import step2and3Logo from './step-2&3.png';
import step2and3LogoActive from './step-2&3-active.png';
import step4Logo from './step-4.png';
import step4LogoActive from './step-4-active.png';
import stepCompletedLogo from './step-completed.png';

const Stepper = (props) => {
  let step1LogoSrc, step2LogoSrc, step3LogoSrc, step4LogoSrc;
  if (props.step === 0) {
    step1LogoSrc = step1LogoActive;
    step2LogoSrc = step3LogoSrc = step2and3Logo;
    step4LogoSrc = step4Logo;
  } else if (props.step === 1) {
    step1LogoSrc = stepCompletedLogo;
    step2LogoSrc = step2and3LogoActive;
    step3LogoSrc = step2and3Logo;
    step4LogoSrc = step4Logo;
  } else if (props.step === 2) {
    step1LogoSrc = step2LogoSrc = stepCompletedLogo;
    step3LogoSrc = step2and3LogoActive;
    step4LogoSrc = step4Logo;
  } else if (props.step === 3) {
    step1LogoSrc = step2LogoSrc = step3LogoSrc = stepCompletedLogo;
    step4LogoSrc = step4Logo;
  } else if (props.step === 4) {
    step1LogoSrc = step2LogoSrc = step3LogoSrc = stepCompletedLogo;
    step4LogoSrc = step4LogoActive;
  } else {
    step1LogoSrc = step2LogoSrc = step3LogoSrc = step4LogoSrc = stepCompletedLogo;
  }
  return (
    <div className="steps-form">
      <div className="steps-row">
        <div className={`steps-step-1 ${props.step > 0 && 'completed'}`}>
          <img src={step1LogoSrc} alt="Create STRATO Developer ID" />
        </div>
        <div className={`steps-step-2 ${props.step > 1 && 'completed'}`}>
          <img src={step2LogoSrc} alt="Enter temporary password" />
        </div>
        <div className={`steps-step-3 ${props.step > 3 && 'completed'}`}>
          <img src={step3LogoSrc} alt="Create password" />
        </div>
        <div className='steps-step-4 final-step'>
          <img src={step4LogoSrc} alt="Download CLI Tool" />
        </div>
      </div>
    </div>
  );
}

export default Stepper;
