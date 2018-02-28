import React from 'react';
import './stepper.css';
import step1LogoActive from './step-1-active.png';
import step2Logo from './step-2.png';
import step2LogoActive from './step-2-active.png';
import step3Logo from './step-3.png';
import step3LogoActive from './step-3-active.png';
import stepCompletedLogo from './step-completed.png';

const Stepper = (props) => {
  let step1LogoSrc, step2LogoSrc, step3LogoSrc;
  if (props.step === 0) {
    step1LogoSrc = step1LogoActive;
    step2LogoSrc = step2Logo;
    step3LogoSrc = step3Logo;
  } else if (props.step === 1) {
    step1LogoSrc = stepCompletedLogo;
    step2LogoSrc = step2LogoActive;
    step3LogoSrc = step3Logo;
  } else {
    step1LogoSrc = step2LogoSrc = stepCompletedLogo;
    step3LogoSrc = step3LogoActive;
  }
  return (
    <div className="steps-form">
      <div className="steps-row">
        <div className={`steps-step-1 ${props.step > 0 && 'completed'}`}>
          <img src={step1LogoSrc} alt="Create STRATO Developer ID" />
        </div>
        <div className={`steps-step-2 ${props.step > 1 && 'completed'}`}>
          <img src={step2LogoSrc} alt="Request Tokens" />
        </div>
        <div className='steps-step-3 final-step'>
          <img src={step3LogoSrc} alt="Download CLI Tool" />
        </div>
      </div>
    </div>
  );
}

export default Stepper;
