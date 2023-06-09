describe("Renders Marketplace Page", () => {
  beforeEach(() => {
    cy.visit('/')
    cy.get("#Login").click();
    cy.login()
  })

  it("it should render marketplace dashboard", () => {
    cy.url().should("include", "/marketplace");
    cy.contains("Explore New Products").should("exist");
    cy.get(".relative").find("img").should('have.attr', 'src').should("include", "hero");
    cy.get("#viewMore").contains("View More").should("exist");
    cy.request({
      method: "GET",
      url: "/api/v1/category",
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.contains("Categories").should("be.visible");

      if (body.data.length !== 0) {
        let name = body.data[0].name;
        cy.contains(name).should("be.visible");
      }
    });
    cy.request({
      method: "GET",
      url: "/api/v1/marketplace/user/topSelling?offset=0",
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.contains("Top Selling Products").should("be.visible");
      if (body.data.length !== 0) {
        let name = decodeURIComponent(body.data[0].name);
        cy.contains(name).should("be.visible");
      }
      cy.get("#topSelling").children().should('have.length', 3);
    });
  });

  it("it should render product list page", () => {
    cy.url().should("contain", "marketplace");
    cy.get("#viewMore", { timeout: 20000 }).should("be.enabled").click();

    cy.url().should("contain", "/marketplace/category");
    cy.get("nav", { timeout: 20000 }).contains("Home").should("exist");
    cy.contains("Filters", { timeout: 20000 }).should("exist");
    cy.contains("Categories", { timeout: 20000 }).should("exist");
    cy.contains("Price", { timeout: 20000 }).should("exist");
    cy.contains("Quantity", { timeout: 20000 }).should("exist");
    cy.contains("Sub-Category",{ timeout: 20000 }).should("exist");
    cy.contains("Product", { timeout: 20000 }).should("exist");
    cy.contains("Brand", { timeout: 20000 }).should("exist");
    cy.contains("Products found").should("be.visible");
    cy.get("#product-list", { timeout: 20000 }).should("exist");
    cy.request({
      method: "GET",
      url: "/api/v1/marketplace/all?range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000"
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.get("#product-list").children().should("have.length", body.data.length);
    });
  });


  it("it should render sub-categories, products, brands and inventories on selecting categories", () => {

    cy.url().should("contain", "marketplace");
    cy.get("#viewMore", { timeout: 20000 }).should("be.enabled").click();

    cy.url().should("contain", "/marketplace/category");
    cy.get("nav", { timeout: 20000 }).contains("Home").should("exist");
    cy.contains("Filters", { timeout: 20000 }).should("exist");
    cy.contains("Categories", { timeout: 20000 }).should("exist");
    cy.contains("Price", { timeout: 20000 }).should("exist");
    cy.contains("Quantity", { timeout: 20000 }).should("exist");
    cy.contains("Sub-Category", { timeout: 20000 }).should("exist");
    cy.contains("Product", { timeout: 20000 }).should("exist");
    cy.contains("Brand", { timeout: 20000 }).should("exist");

    cy.request({
      method: "GET",
      url: "/api/v1/marketplace/all?range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000"
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.contains(`${body.data.length} Products found`).should("be.visible");
      cy.get("#product-list").children().should("have.length", body.data.length);
      if (body.data.length > 0) {
        let card = cy.get("#product-list").children().first();
        card.find("img").should("have.attr", "src");
        card.get("#prod-name").should("be.visible");
        card.get("#prod-category").should("exist")
        card.get("#prod-desc").should("exist")
        card.get("#prod-price").should("be.visible")
        card.get("#prod-quantity").should("be.visible")
        card.get("button").contains("Add To Cart").should("exist");
        card.get("button").contains("Buy Now").should("exist");
      }
    });

    cy.request({
      method: "GET",
      url: "/api/v1/category",
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length !== 0) {
        let category = body.data[0];
        cy.get('[type="checkbox"]').check(category.name);
        cy.contains("Sub-Category", { timeout: 20000 }).should("exist")

        cy.request({
          method: "GET",
          url: `api/v1/product/filter/names?isDeleted=false&&category[]=${category.name}`,
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          if (body.data.length !== 0) {
            cy.contains("Product").should("exist");
            cy.contains("Brand").should("exist");
          }
        });

        cy.request({
          method: "GET",
          url: `/api/v1/marketplace/all?&category[]=${category.name}&range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000`,
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          cy.contains(`${body.data.length} Products found`).should("be.visible");
          cy.get("#product-list").children().should("have.length", body.data.length);
        });
      }
    });
  });

  it("it should render inventories based on filter selection", () => {
    cy.url().should("contain", "marketplace");
    cy.get("#viewMore", { timeout: 20000 }).should("be.enabled").click();
    cy.url().should("contain", "/marketplace/category");

    let category, subCategory, product;
    cy.request({
      method: "GET",
      url: "/api/v1/category",
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length !== 0) {
        category = body.data[0];
        cy.get('[type="checkbox"]', { timeout: 20000 }).check(category.name);
        cy.wait(15000)

        // TO be confirm
        cy.request({
          method: "GET",
          url: `api/v1/subcategory?category[]=${category.name}`,
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          if (body.data.length !== 0) {
            subCategory = body.data[0];
            cy.contains("Sub-Category").should("exist")
            cy.get('[type="checkbox"]').check(subCategory.name);
            let productUrl = subCategory ? `api/v1/product/filter/names?isDeleted=false&&category[]=${category.name}&subCategory[]=${subCategory.name}`
              : `api/v1/product/filter/names?isDeleted=false&&category[]=${category.name}`

            cy.request({
              method: "GET",
              url: productUrl,
            }).then(({ status, body }) => {
              expect(status).to.eq(200);
              if (body.data.length !== 0) {
                product = body.data[0];
                cy.contains("Product", { timeout: 20000 }).should("exist");
                cy.contains("Brand", { timeout: 20000 }).should("exist");
                cy.get('[type="checkbox"]', { timeout: 20000 }).check(product.manufacturer);
                cy.wait(5000)

                cy.request({
                  method: "GET",
                  url: `/api/v1/marketplace/all?&category[]=${category.name}&subCategory[]=${subCategory.name}&manufacturer[]=${product.manufacturer}&range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000`,
                }).then(({ status, body }) => {
                  expect(status).to.eq(200);
                  cy.contains(`${body.data.length} Products found`).should("be.visible");
                  cy.get("#product-list").children().should("have.length", body.data.length);
                  if (body.data.length === 0) {
                    cy.contains("No data found")
                  }
                });
              }
            });
          }
        });

      }
    });
  });


  it("it should render product detail page", () => {
    cy.request({
      method: "GET",
      url: `/api/v1/marketplace/user/topselling?offset=0`,
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.wait(30000);

      if (body.data.length !== 0) {
        let inventory = body.data[0];
        cy.get("#topSelling", { timeout: 20000 }).children().first().click();

        cy.url().should("include", "/marketplace/productList/")
        cy.get("nav", { timeout: 20000 }).contains("Home").should("exist");
        cy.get("nav").contains(decodeURIComponent(inventory.name)).should("exist");
        cy.get("div").find("img").should('have.attr', 'src');
        cy.get("button").contains("Add To Cart").should("exist");
        cy.get("button").contains("Buy Now").should("exist");

        cy.contains(decodeURIComponent(inventory.name)).should("be.visible");
        if (inventory.description) cy.get("#details").contains(decodeURIComponent(inventory.description)).should("exist");
        cy.get("#details").contains(`$ ${inventory.pricePerUnit}`).should("be.visible");
        cy.get("#details").contains("Quantity").should("be.visible");
        cy.get("#quantity").should("exist");
        cy.get(".ant-tabs-tab").should("have.length", 4);
        cy.get(".ant-tabs-tab").first().should('have.class', 'ant-tabs-tab-active')
        cy.get(".ant-tabs-tab").eq(1).should('not.have.class', 'ant-tabs-tab-active')
        cy.contains("Product Id").should("be.visible");
        cy.contains("Unique Product Code").should("be.visible");
        cy.contains("Manufacturer").should("be.visible");
        cy.contains("Unit of Measurement").should("be.visible");
        cy.contains("Least Sellable Unit").should("be.visible");

        cy.get(".ant-tabs-tab").eq(1).click();
        cy.get(".ant-tabs-tab").eq(1).should('have.class', 'ant-tabs-tab-active')
        cy.get(".ant-tabs-tab").first().should('not.have.class', 'ant-tabs-tab-active')
        cy.get("th").contains("NAME").should("be.visible");
        cy.get("th").contains("DESCRIPTION").should("be.visible");

        cy.get(".ant-tabs-tab").eq(2).click();
        cy.get(".ant-tabs-tab").eq(2).should('have.class', 'ant-tabs-tab-active')
        cy.get("th").contains("SERIAL NUMBER").should("be.visible");
        cy.get("th").contains("ITEM NUMBER").should("be.visible");
        cy.request({
          method: "GET",
          url: `/api/v1/item?inventoryId=${inventory.address}`,
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          if (body.data.length > 0) {
            cy.get(`#Ownership-Item-Number-${body.data[0].itemNumber}`).click();

            cy.get(".ownership", { timeout: 20000 }).contains("Ownership History").should("be.visible");
            cy.get("#ownership-serial", { timeout: 20000 }).contains("SERIAL NUMBER").should("be.visible");
            cy.get("#ownership-serial").should("exist");
            cy.get(".ownership").contains("SELLER").should("exist");
            cy.get(".ownership").contains("OWNER").should("exist");
            cy.get(".ownership").contains("OWNERSHIP START DATE").should("exist");
          }

          if (body.data.length > 1) {
            cy.get(`#Ownership-Item-Number-${body.data[0].itemNumber}`).click();

            cy.get(".ownership", { timeout: 20000 }).contains("Ownership History").should("be.visible");
            cy.get("#ownership-serial", { timeout: 20000 }).contains("SERIAL NUMBER").should("be.visible");
            cy.get("#ownership-serial").should("exist");
            cy.get(".ownership").contains("SELLER").should("exist");
            cy.get(".ownership").contains("OWNERSHIP START DATE").should("exist");
          }
        });

        cy.get(".ant-tabs-tab").eq(3).click();
        cy.get(".ant-tabs-tab").eq(3).should('have.class', 'ant-tabs-tab-active')
        cy.get("th").contains("SERIAL NUMBER").should("exist");
        cy.get("th").contains("ITEM NUMBER").should("exist");
        cy.request({
          method: "GET",
          url: `/api/v1/item?inventoryId=${inventory.address}`,
        }).then(({ status, body }) => {
          expect(status).to.eq(200);
          if (body.data.length > 0) {
            cy.get(`#Transformation-Item-Number-${body.data[0].itemNumber}`).click();

            cy.get("#transformation", { timeout: 20000 }).contains("Transformation").should("be.visible");
            cy.get("#transformation", { timeout: 20000 }).contains("SERIAL NUMBER").should("be.visible");
            cy.get("#trans-serial").should("exist");
            cy.get("#transformation").contains("RAW MATERIALS").should("exist")
            cy.get("#transformation").contains("SERIAL NUMBER").should("exist")
          }
        });
      }
    });
  });

  // it("it should render product detail page", () => {
  //   cy.login();
  //   cy.wait(30000);
  //   cy.get("#topSelling").children().first().click();
  //   cy.wait(15000);
  //   cy.url().should("include", "/marketplace/productList/")
  //   cy.get("nav").contains("Home").should("exist");
  //   cy.get("div").find("img").should('have.attr', 'src');
  //   cy.get("button").contains("Add To Cart").should("exist");
  //   cy.get("button").contains("Buy Now").should("exist");

  //   cy.get("#inventory-name").should("exist");
  //   cy.get("#inventory-desc").should("exist");
  //   cy.get("#inventory-price").should("exist");
  //   cy.contains("Quantity").should("be.visible");
  //   cy.get("#quantity").should("exist");
  //   cy.get(".ant-tabs-tab").should("have.length", 4);
  //   cy.get(".ant-tabs-tab").first().should('have.class', 'ant-tabs-tab-active')
  //   cy.get(".ant-tabs-tab").eq(1).should('not.have.class', 'ant-tabs-tab-active')
  //   cy.contains("Product Id").should("be.visible");
  //   cy.contains("Unique Product Code").should("be.visible");
  //   cy.contains("Manufacturer").should("be.visible");
  //   cy.contains("Unit of Measurement").should("be.visible");
  //   cy.contains("Least Sellable Unit").should("be.visible");

  //   cy.get(".ant-tabs-tab").eq(1).click();
  //   cy.get(".ant-tabs-tab").eq(1).should('have.class', 'ant-tabs-tab-active')
  //   cy.get(".ant-tabs-tab").first().should('not.have.class', 'ant-tabs-tab-active')
  //   cy.get("th").contains("NAME").should("be.visible");
  //   cy.get("th").contains("DESCRIPTION").should("be.visible");

  //   cy.get(".ant-tabs-tab").eq(2).click();
  //   cy.get(".ant-tabs-tab").eq(2).should('have.class', 'ant-tabs-tab-active')
  //   cy.get("th").contains("SERIAL NUMBER").should("be.visible");
  //   cy.get("th").contains("ITEM NUMBER").should("be.visible");
  //   cy.get("td").eq(5).click();
  //   cy.wait(13000);
  //   cy.get("#ownership").contains("Ownership History").should("be.visible");
  //   cy.get("#ownership").contains("SERIAL NUMBER").should("be.visible");
  //   cy.get("#ownership-serial").should("exist");
  //   cy.get("#ownership").contains("SELLER").should("exist");
  //   cy.get("#ownership").contains("OWNER").should("exist");
  //   cy.get("#ownership").contains("OWNERSHIP START DATE").should("exist");
  //   cy.get("td").eq(7).click();
  //   cy.wait(13000);
  //   cy.get("#ownership").contains("SELLER").should("exist");
  //   cy.get("#ownership").contains("BUYER").should("exist");
  //   cy.get("#ownership").contains("OWNERSHIP START DATE").should("exist");

  //   cy.get(".ant-tabs-tab").eq(3).click();
  //   cy.get(".ant-tabs-tab").eq(3).should('have.class', 'ant-tabs-tab-active')
  //   cy.get("th").contains("SERIAL NUMBER").should("exist");
  //   cy.get("th").contains("ITEM NUMBER").should("exist");
  //   cy.get("td").eq(17).click();
  //   cy.wait(13000);
  //   cy.get("#transformation").contains("Transformation").should("be.visible");
  //   cy.get("#transformation").contains("SERIAL NUMBER").should("be.visible");
  //   cy.get("#trans-serial").should("exist");
  //   cy.get("#nested-trans").get("RAW MATERIALS").should("exist")
  //   cy.get("#nested-trans").get("SERIAL NUMBER").should("exist")
  // });

})