import { FOOTER_NAVIGATION } from "../../helpers/constants";
import { Images } from "../../images";



export default function FooterComponent() {

  const handleNavigate = (e, category) =>{
    e.preventDefault();
    sessionStorage.setItem('scrollPosition', 0);
    window.location.href = `/c/${category}`
  }

  return (
    <footer className="bg-[#131889]" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="mx-auto max-w-7xl px-6 pb-8 pt-16 sm:pt-24 lg:px-8 lg:pt-32">
        <div className="xl:grid xl:grid-cols-3 xl:gap-8">
          <div className="space-y-4">
            <img
              src={Images.logo_white}
              alt="blockapps logo"
              className="h-[48px] md:h-[60px]"
              preview={false}
            />
            <div className="flex space-x-6">
              {FOOTER_NAVIGATION.social.map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-white hover:text-gray-400"
                >
                  <span className="sr-only">{item.name}</span>
                  <item.icon className="h-6 w-6" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
          <div className="mt-16 grid grid-cols-2 gap-8 xl:col-span-2 xl:mt-0">
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm font-semibold leading-6 text-white">
                  Categories
                </h3>
                <ul role="list" className="mt-6 space-y-4">
                  {FOOTER_NAVIGATION.categories.map((item) => (
                    <li key={item.name}>
                      <a
                        href={`/c/${item.name}`}
                        onClick={(e)=>{handleNavigate(e, item.name)}}
                        className="text-sm leading-6 text-white hover:text-white"
                      >
                        {item.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-10 md:mt-0">
                <h3 className="text-sm font-semibold leading-6 text-white">
                  Support
                </h3>
                <ul role="list" className="mt-6 space-y-4">
                  {FOOTER_NAVIGATION.support.map((item) => (
                    <li key={item.name}>
                      {item.name === "FAQ" ? (
                        <a
                          href={item.href}
                          className="text-sm leading-6 text-white hover:text-white"
                        >
                          {item.name}
                        </a>
                      ) : (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm leading-6 text-white hover:text-white"
                        >
                          {item.name}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="md:grid md:grid-cols-2 md:gap-8">
              <div>
                <h3 className="text-sm font-semibold leading-6 text-white">
                  Company
                </h3>
                <ul role="list" className="mt-6 space-y-4">
                  {FOOTER_NAVIGATION.company.map((item) => (
                    <li key={item.name}>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm leading-6 text-white hover:text-white"
                      >
                        {item.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              {/* <div className="mt-10 md:mt-0">
                <h3 className="text-sm font-semibold leading-6 text-white">
                  Legal
                </h3>
                <ul role="list" className="mt-6 space-y-4">
                  {navigation.legal.map((item) => (
                    <li key={item.name}>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm leading-6 text-white hover:text-white"
                      >
                        {item.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div> */}
            </div>
          </div>
        </div>
        <div className="mt-16 border-t border-white/10 pt-8 sm:mt-20 lg:mt-24">
          <p className="text-xs leading-5 text-white">
            &copy; 2024 BlockApps, Inc. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
