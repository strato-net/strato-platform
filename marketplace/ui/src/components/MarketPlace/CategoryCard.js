import { Typography } from "antd";
import Slider from "react-slick";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useCategoryState } from "../../contexts/category";
import { Images } from "../../images";
import TagManager from "react-gtm-module";
import { Fade } from "react-awesome-reveal";
import { SEO } from "../../helpers/seoConstant";

const { Title, Text } = Typography;

const CategoryCard = () => {
  const navigate = useNavigate();
  const naviroute = routes.MarketplaceCategoryProductList.url;
  const { categorys } = useCategoryState();

  const categoryImages = [
    Images["Carbon-category"],
    Images["Metal"],
    Images["Clothing-category"],
    Images["collectibles"],
    Images["tokens_card"],
    Images["Art-category"],
    Images["membership_card"],
  ];

  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 5,
    slidesToScroll: 5,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 3,
          slidesToScroll: 3,
          infinite: true,
          dots: true
        }
      },
      {
        breakpoint: 600,
        settings: {
          slidesToShow: 2,
          slidesToScroll: 2
        }
      },
      {
        breakpoint: 480,
        settings: {
          slidesToShow: 1,
          slidesToScroll: 1
        }
      }
    ]
  };
  
  return (
    <>
      <Fade triggerOnce>
      <Title className="md:px-10 !text-xl md:!text-4xl !text-left py-2">
        Shop by Category
      </Title>
      </Fade>
      <Fade direction="left" triggerOnce>
      <Slider {...settings}>
        {categorys.map((category, index) => {
          return (
            <div
              id={category.name}
              key={index}
              className="transition-transform duration-500 hover:scale-105 w-[162px] md:w-[210px] 2xl:w-[248px] h-[160px] md:h-[180px] 2xl:h-[200px] border border-tertiaryB shadow-category rounded-lg cursor-pointer"
              onClick={() => {
                const subCat = category.subCategories.map((item)=>item.contract).join(",")
                const url = `${naviroute.replace(':category', category.name)}?sc=${subCat}`
                navigate(url)
                sessionStorage.setItem('scrollPosition', 0);
                window.LOQ.push(['ready', async LO => {
                  // Track an event
                  await LO.$internal.ready('events')
                  LO.events.track(`Homepage Filter - ${category.name}`)
                }])
                TagManager.dataLayer({
                  dataLayer: {
                    event: `${category.name}_filter_homepage`,
                  },
                });
              }}
            >
              <div className="flex flex-col">
                <img
                  alt={SEO.IMAGE_META}
                  title={SEO.IMAGE_META}
                  src={categoryImages[index]}
                  className="rounded-t-lg px-[9px] py-[6px] lg:px-[0px] lg:py-[0px] h-[110px] md:h-[125px] 2xl:h-[140px]"
                  preview={false}
                />

                  <div className="py-2 xl:py-3 flex justify-center md:justify-start ">
                    <Text
                      type="secondary"
                      className="text-lg md:text-xl lg:text-2xl !text-primaryB font-semibold"
                    >
                      <span className="p-3 font-sans">{category.name}</span>
                    </Text>
                  </div>
                </div>
              </div>
            );
          })}
        </Slider>
      </Fade>
    </>
  );
};

export default CategoryCard;
