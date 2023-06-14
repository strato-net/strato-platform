describe("Renders Products Page", () => {
  beforeEach(function () {
    cy.visit('/')
    cy.get("#Login").click();
    cy.login()

    cy.checkCategory();

    cy.get("#Products").should("exist");
    cy.get("#Products").click();
    cy.url().should("include", "/products");
  });

  it("it should render empty product list components", () => {
    cy.request({
      method: "GET",
      url: "/api/v1/product",
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length == 0) {
        cy.contains("No product found").should("be.visible");
        cy.contains("Start adding your product").should("be.visible");
        cy.get("#add-product-button").should("exist");
      }
    });
  });

  it("it should add a product", () => {
    cy.url().should("include", "/products");

    cy.get("#add-product-button").should("exist");
    cy.get("#add-product-button").click();
    cy.get("#modal-title").contains("Add Product");

    cy.get('input[placeholder="Enter Name"]').type(`Corn Seeds ${Math.floor(Math.random() * 100)}`);
    cy.get("#category").type("Art{enter}");
    cy.get("#subCategory").type("Art{enter}");
    cy.get('input[placeholder="Enter Manufacturer"]').type("Manufacturer A");
    cy.get("#unitofmeasurement").click().type("{enter}", { force: true });
    cy.get('input[placeholder="Enter Least Sellable Unit"]').type("100");
    cy.get('textarea[placeholder="Enter Description"]').type(
      "This is a description"
    );
    cy.get("input[type=file]").attachFile("cottonSeeds.jpg");
    cy.get('input[placeholder="Enter Unique Product Code"]').type("x_103");
    cy.get("#create-product-button").should("exist");
    cy.get("#create-product-button").click();

    cy.contains("Product created successfully").should("be.visible");
  });

  it("it should delete a product", () => {
    cy.createProduct();

    cy.request({
      method: "GET",
      url: "/api/v1/product",
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length != 0) {
        cy.get("#product")
          .first()
          .within(() => {
            cy.get(".anticon svg").should("exist");
            cy.get(".anticon svg").click();
          });
        cy.get("#delete-button").should("exist");
        cy.get("#delete-button").click();
        cy.get("#modal-title").contains("Delete");
        cy.contains("Are you sure you want to delete?").should("be.visible");
        cy.get("#delete-product-yes").should("exist");
        cy.get("#delete-product-yes").click();

        cy.contains("Product has been deleted").should("be.visible");
      }
    });
  });
  
  it("it should edit a product", () => {
    cy.createProduct();

    cy.request({
      method: "GET",
      url: "/api/v1/product",
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length != 0) {
        cy.get("#product")
          .first()
          .within(() => {
            cy.get(".anticon svg").should("exist");
            cy.get(".anticon svg").click();
          });
        cy.get("#edit-button").should("exist");
        cy.get("#edit-button").click();
        cy.get("#modal-title").contains("Edit Product");
        cy.get('textarea[placeholder="Enter Description"]').type(
          " Editing this description"
        );
        cy.get("#update-product-button").should("exist");
        cy.get("#update-product-button").click();

        cy.contains("Product has been updated").should("be.visible");
      }
    });
  });
});
