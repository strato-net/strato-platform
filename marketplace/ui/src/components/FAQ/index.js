import { Disclosure } from "@headlessui/react";
import { MinusSmallIcon, PlusSmallIcon } from "@heroicons/react/24/outline";

const faqs = [
  {
    question: "About Mercata?",
    answer:
      "Mercata is a marketplace built on the STRATO blockchain decentralizing the buying, selling, and trading of tokenized RWA.",
  },
  {
    question: "What is a RWA?",
    answer:
      "RWA stands for 'real world assets'. RWAs are non-traditional assets with unique markets that are now able to be tokenized and transacted through the blockchain.",
  },
  {
    question: "Using Mercata",
    answer:
      "Create an account, discover unique market categories, and pick your favorite assets to buy, sell, and invest. In the future you also will also be able to work with other members of the community to obtain fractionalized ownership of assets.",
  },
  {
    question: "Investing with Mercata",
    answer:
      "When you purchase a tokenized asset on Mercata, dependent on the rules set by the smart contract, you have the choice to either redeem the physical item, or continue to hold the token and speculate on its future price potential.",
  },
  {
    question: "Trading RWA with Mercata",
    answer:
      "To sell on Mercata either relist tokenized assets you have in your inventory, or tokenize your own items to be tradable on the marketplace",
  },
  {
    question: "Privacy and Security",
    answer: "See our privacy and security policy for more info",
  }, 
];

export default function Example() {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8 lg:py-40">
        <div className="mx-auto max-w-4xl divide-y divide-gray-900/10">
          <h2 className="text-2xl font-bold leading-10 tracking-tight text-gray-900">
            Frequently asked questions
          </h2>
          <dl className="mt-10 space-y-6 divide-y divide-gray-900/10">
            {faqs.map((faq) => (
              <Disclosure as="div" key={faq.question} className="pt-6">
                {({ open }) => (
                  <>
                    <dt>
                      <Disclosure.Button className="flex w-full items-start justify-between text-left text-gray-900">
                        <span className="text-base font-semibold leading-7">
                          {faq.question}
                        </span>
                        <span className="ml-6 flex h-7 items-center">
                          {open ? (
                            <MinusSmallIcon
                              className="h-6 w-6"
                              aria-hidden="true"
                            />
                          ) : (
                            <PlusSmallIcon
                              className="h-6 w-6"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                      </Disclosure.Button>
                    </dt>
                    <Disclosure.Panel as="dd" className="mt-2 pr-12">
                      <p className="text-base leading-7 text-gray-600">
                        {faq.answer}
                      </p>
                    </Disclosure.Panel>
                  </>
                )}
              </Disclosure>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
