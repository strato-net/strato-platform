import { useState } from 'react';
import { Plus, Minus, Shield, HelpCircle, Wallet, TrendingUp, Users, Smartphone, Zap, PlayCircle } from 'lucide-react';

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const faqs = [
    {
      question: "What is STRATO Mercata?",
      answer: "STRATO Mercata is a decentralized finance platform that allows you to earn yield on vaulted assets. Built by Ethereum veterans, we provide secure, transparent, and efficient ways to generate returns on your digital and physical assets.",
      icon: <HelpCircle className="h-5 w-5" />,
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100"
    },
    {
      question: "How does the platform ensure security?",
      answer: "Our platform uses institutional-grade security measures including multi-signature wallets, smart contract audits, and secure custody solutions for physical assets. All gold and silver are stored in audited vaults with full insurance coverage.",
      icon: <Shield className="h-5 w-5" />,
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100"
    },
    {
      question: "What assets can I deposit?",
      answer: "You can deposit various cryptocurrencies including ETH, BTC, and stablecoins, as well as tokenized representations of physical gold and silver. Each asset class offers different yield opportunities and risk profiles.",
      icon: <Wallet className="h-5 w-5" />,
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100"
    },
    {
      question: "How are yields generated?",
      answer: "Yields are generated through a combination of lending protocols, liquidity provision, and strategic partnerships with institutional borrowers. Our diversified approach helps maintain stable returns while managing risk.",
      icon: <TrendingUp className="h-5 w-5" />,
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100"
    },
    {
      question: "What are the minimum deposit requirements?",
      answer: "No minimum deposit is required to start earning on STRATO Mercata. You can deposit any amount of supported assets, allowing you to start small and scale up as you become more comfortable with the platform.",
      icon: <Zap className="h-5 w-5" />,
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100"
    },
    {
      question: "How can I withdraw my funds?",
      answer: "You can withdraw your funds at any time through the dashboard. Cryptocurrency withdrawals are typically processed within 24 hours. Physical precious metals withdrawals may take 3-5 business days and may incur additional fees.",
      icon: <Users className="h-5 w-5" />,
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100"
    },
    {
      question: "Is there a mobile app?",
      answer: "Currently, STRATO Mercata is available as a web application optimized for both desktop and mobile browsers. We're working on dedicated mobile apps that will be released in the near future.",
      icon: <Smartphone className="h-5 w-5" />,
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100"
    },
    {
      question: "How do I get started?",
      answer: "Getting started is easy! Simply signup and make your first deposit. Our step-by-step guide will walk you through the entire process.",
      icon: <PlayCircle className="h-5 w-5" />,
      gradient: "bg-gradient-to-br from-blue-50 to-blue-100"
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
          
          <div className="space-y-6">
            {faqs.map((faq, index) => (
              <div key={index} className="group">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => toggleFAQ(index)}
                    className="w-full px-6 py-5 text-left flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center justify-center w-10 h-10 bg-gray-100 rounded-lg text-gray-600 group-hover:bg-strato-blue group-hover:text-white transition-colors duration-300">
                        {faq.icon}
                      </div>
                      <span className="font-semibold text-gray-900 group-hover:text-strato-blue transition-colors duration-200">
                        {faq.question}
                      </span>
                    </div>
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 group-hover:bg-strato-blue group-hover:text-white transition-all duration-300">
                      {openIndex === index ? (
                        <Minus className="h-4 w-4 text-gray-500 group-hover:text-white group-hover:rotate-180 transition-all duration-300" />
                      ) : (
                        <Plus className="h-4 w-4 text-gray-500 group-hover:text-white group-hover:rotate-90 transition-all duration-300" />
                      )}
                    </div>
                  </button>
                  {openIndex === index && (
                    <div className={`${faq.gradient} transition-all duration-500 ease-out`}>
                      <div className="p-6 text-gray-700 leading-relaxed">
                        {faq.answer}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
        </div>
      </div>
    </div>
  );
};

export default FAQ;