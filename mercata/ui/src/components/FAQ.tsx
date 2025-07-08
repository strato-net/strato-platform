import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const faqs = [
    {
      question: "What is STRATO Mercata?",
      answer: "STRATO Mercata is a decentralized finance platform that allows you to earn yield on vaulted gold, silver, and cryptocurrency assets. Built by Ethereum veterans, we provide secure, transparent, and efficient ways to generate returns on your digital and physical assets."
    },
    {
      question: "How does the platform ensure security?",
      answer: "Our platform uses institutional-grade security measures including multi-signature wallets, smart contract audits, and secure custody solutions for physical assets. All gold and silver are stored in audited vaults with full insurance coverage."
    },
    {
      question: "What assets can I deposit?",
      answer: "You can deposit various cryptocurrencies including ETH, BTC, and stablecoins, as well as tokenized representations of physical gold and silver. Each asset class offers different yield opportunities and risk profiles."
    },
    {
      question: "How are yields generated?",
      answer: "Yields are generated through a combination of lending protocols, liquidity provision, and strategic partnerships with institutional borrowers. Our diversified approach helps maintain stable returns while managing risk."
    },
    {
      question: "What are the minimum deposit requirements?",
      answer: "Minimum deposit requirements vary by asset type. For most cryptocurrency deposits, the minimum is $100 equivalent. For precious metals, the minimum is typically $1,000 equivalent. Check each pool for specific requirements."
    },
    {
      question: "How can I withdraw my funds?",
      answer: "You can withdraw your funds at any time through the dashboard. Cryptocurrency withdrawals are typically processed within 24 hours. Physical precious metals withdrawals may take 3-5 business days and may incur additional fees."
    },
    {
      question: "Is there a mobile app?",
      answer: "Currently, STRATO Mercata is available as a web application optimized for both desktop and mobile browsers. We're working on dedicated mobile apps that will be released in the near future."
    },
    {
      question: "How do I get started?",
      answer: "Getting started is easy! Simply connect your wallet, complete the verification process, choose your preferred asset pool, and make your first deposit. Our step-by-step guide will walk you through the entire process."
    }
  ];

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="bg-white py-16">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Frequently Asked Questions</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Find answers to common questions about STRATO Mercata and how our platform works
            </p>
          </div>
          
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div key={index} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <span className="font-semibold text-gray-900">{faq.question}</span>
                  {openIndex === index ? (
                    <ChevronUp className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  )}
                </button>
                {openIndex === index && (
                  <div className="p-6 text-gray-700 leading-relaxed ">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
          
        </div>
      </div>
    </div>
  );
};

export default FAQ;