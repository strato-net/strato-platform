
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const DashboardFAQ = () => {
  const faqItems = [
    {
      question: "What assets can I deposit?",
      answer: "You can deposit various assets including gold, silver, and cryptocurrencies like Ethereum and wrapped Bitcoin. Each asset has different yield opportunities and borrowing capabilities."
    },
    {
      question: "How does borrowing work?",
      answer: "You can borrow against your deposited assets. The amount you can borrow depends on the collateralization ratio of each asset. Keep your risk level below 80% to avoid liquidation."
    },
    {
      question: "What are CATA Rewards?",
      answer: "CATA points is the reward system on STRATO Mercata. Points are rewarded based on your deposits and platform activity."
    },
    {
      question: "How secure are my assets?",
      answer: "All deposited assets are secured through multiple layers of security including third-party audits, multi-signature wallets, and insurance coverage. Physical assets are stored in high-security vaults with regular audits."
    },
    {
      question: "What is the liquidation process?",
      answer: "If your risk level exceeds the liquidation threshold (typically 80%), a portion of your collateral may be liquidated to maintain the health of your position. You'll receive notifications as you approach this threshold."
    }
  ];
  
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <h2 className="font-bold text-lg mb-4">Frequently Asked Questions</h2>
      
      <Accordion type="single" collapsible className="w-full">
        {faqItems.map((item, index) => (
          <AccordionItem key={index} value={`item-${index}`}>
            <AccordionTrigger className="text-left font-medium">{item.question}</AccordionTrigger>
            <AccordionContent>
              <p className="text-gray-600">{item.answer}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
};

export default DashboardFAQ;
