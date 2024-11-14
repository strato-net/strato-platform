import { Disclosure } from '@headlessui/react';
import { MinusSmallIcon, PlusSmallIcon } from '@heroicons/react/24/outline';

const faqs = [
  {
    question: 'About Mercata?',
    answer:
      'Mercata is a marketplace built on the STRATO blockchain decentralizing the buying, selling, and trading of tokenized RWA.',
  },
  {
    question: 'What is a RWA?',
    answer:
      "RWA stands for 'real world assets'. RWAs are non-traditional assets with unique markets that are now able to be tokenized and transacted through the blockchain.",
  },
  {
    question: 'Using Mercata',
    answer:
      'Create an account, discover unique market categories, and pick your favorite assets to buy, sell, and invest. In the future you also will also be able to work with other members of the community to obtain fractionalized ownership of assets.',
  },
  {
    question: 'Investing with Mercata',
    answer:
      'When you purchase a tokenized asset on Mercata, dependent on the rules set by the smart contract, you have the choice to either redeem the physical item, or continue to hold the token or list it for sale.',
  },
  {
    question: 'Trading RWA with Mercata',
    answer:
      'To sell on Mercata either relist tokenized assets you have in your inventory, or tokenize your own items to be tradable on the marketplace',
  },
  {
    question: 'Privacy and Security',
    answer: 'See our privacy and security policy for more info',
  },
  {
    question: 'Delivery and Return Policy',
    answer: (
      <>
        <p className="mt-1">
          Delivery is on demand and will be processed and shipped within 3-5
          business days from receipt of delivery request and sent via standard
          delivery methods.
        </p>
        <br />
        <p>
          We're happy to accept returns for most items within 10 days of
          delivery. We inspect all returned items and to qualify for a refund,
          item(s) must be:
        </p>
        <br />
        <ul class="list-disc space-y-2 ml-10">
          <li class="text-gray-700 font-medium">
            In its original, undamaged condition, with all original product
            tags, accessories, and inserts in place.
          </li>
          <li class="text-gray-700 font-medium">In its original packaging.</li>
        </ul>
        <h3 className="text-xl font-bold my-6"> Return Shipping Fee: </h3>
        <ul class="list-disc space-y-2 ml-10">
          <li class="text-gray-700 font-medium">
            {' '}
            You are responsible for the return shipping fee.{' '}
          </li>
          <li class="text-gray-700 font-medium">
            If an order is returned to us because you refused delivery, we will
            charge the appropriate return costs and they will be deducted from
            your refund.
          </li>
        </ul>
        <h3 className="text-xl font-bold my-6"> Refund Timing: </h3>
        <p>
          {' '}
          We will initiate your refund once items are received. Please allow up
          to 2 weeks (10 business days) for us to fully process your return and
          issue your refund.
        </p>

        <h3 className="text-xl font-bold my-6">
          {' '}
          There are a few items that can't be returned:{' '}
        </h3>
        <ul class="list-disc space-y-2 mk-4 ml-10">
          <li class="text-gray-700 font-medium"> Electronics </li>
          <li class="text-gray-700 font-medium">Gift Cards</li>
          <li class="text-gray-700 font-medium">VIP Cards</li>
          <li class="text-gray-700 font-medium">
            Blended Mercata Carbon Tonne Purchases
          </li>
          <li class="text-gray-700 font-medium">
            Sad Dog Kennel Club Purchases
          </li>
          <li class="text-gray-700 font-medium">
            Items marked “Non-Returnable” on the website
          </li>
        </ul>
        <br />
        <p>
          Please note that this return policy does not apply to the products
          sold by approved 3rd party marketplace sellers on STRATO Mercata.
          Third party marketplace seller products are subject to each seller's
          own return policy, and are excluded from the return policy above. To
          view the return policy for a marketplace seller item, please refer to
          the seller's individual policy.
        </p>
      </>
    ),
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
