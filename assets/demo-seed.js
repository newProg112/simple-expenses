export const DEMO_SEED_VERSION = 1;

export const DEMO_SEED = Object.freeze({
  businessProfile: Object.freeze({
    demoMode: true,
    fullName: "Alex Morgan",
    role: "Owner",
    businessName: "Northstar Creative Studio Ltd",
    businessEmail: "hello@northstarcreative.example",
    phoneNumber: "020 7946 0284",
    businessType: "Limited company",
    addressLine1: "24 Harbour Street",
    addressLine2: "",
    townCity: "Bristol",
    postcode: "BS1 4ST",
    vatRegistered: "Yes",
    vatNumber: "GB123456789",
    businessWebsite: "https://northstarcreative.example",
    companyNumber: "12345678",
    paymentTermsDefault: "14 days",
    accountName: "Northstar Creative Studio Ltd",
    sortCode: "20-00-00",
    accountNumber: "12345678",
    companyLogoUrl: ""
  }),

  customers: Object.freeze([
    Object.freeze({
      id: "demo-customer-brightside",
      data: Object.freeze({
        name: "Brightside Retail Ltd",
        email: "accounts@brightsideretail.example",
        address: "18 Market Square\nBath\nBA1 1HQ",
        paymentTerms: "14 days",
        nameKey: "brightside retail ltd",
        emailKey: "accounts@brightsideretail.example",
        createdAt: "2026-07-01T09:00:00.000Z",
        updatedAt: "2026-07-01T09:00:00.000Z"
      })
    })
  ]),

  projects: Object.freeze([
    Object.freeze({
      id: "demo-project-brightside-launch",
      data: Object.freeze({
        name: "Brightside summer campaign",
        reference: "PRJ-1001",
        customerId: "demo-customer-brightside",
        customerName: "Brightside Retail Ltd",
        description: "Brand refresh and campaign landing page for the summer launch.",
        status: "Active",
        startDate: "2026-07-01",
        endDate: "2026-08-31",
        budget: 7500,
        createdAt: "2026-07-01T09:15:00.000Z",
        updatedAt: "2026-07-01T09:15:00.000Z"
      })
    })
  ]),

  invoices: Object.freeze([
    Object.freeze({
      id: "demo-invoice-1001",
      data: Object.freeze({
        invoiceNo: "INV-1001",
        client: "Brightside Retail Ltd",
        clientEmail: "accounts@brightsideretail.example",
        clientAddress: "18 Market Square\nBath\nBA1 1HQ",
        paymentTerms: "14 days",
        dueDate: "2026-07-29",
        amount: 3500,
        vat: 700,
        total: 4200,
        items: Object.freeze([
          Object.freeze({ description: "Brand strategy workshop", amount: 1200 }),
          Object.freeze({ description: "Campaign landing page design", amount: 2300 })
        ]),
        status: "Unpaid",
        date: "15/07/2026",
        createdAt: "2026-07-15T10:30:00.000Z",
        recurringInvoice: "No",
        recurringFrequency: "",
        nextInvoiceDate: "",
        reminderDate: "2026-07-27",
        projectId: "demo-project-brightside-launch",
        projectName: "Brightside summer campaign",
        projectReference: "PRJ-1001"
      })
    })
  ]),

  bills: Object.freeze([
    Object.freeze({
      id: "demo-bill-1001",
      data: Object.freeze({
        id: "demo-bill-1001",
        supplier: "Pixel Press Ltd",
        billNumber: "PP-7842",
        billDate: "2026-07-10",
        dueDate: "2026-08-09",
        category: "Professional fees",
        net: 450,
        vatRate: 0.2,
        vat: 90,
        total: 540,
        status: "Unpaid",
        notes: "Print-ready campaign artwork support.",
        projectId: "demo-project-brightside-launch",
        projectName: "Brightside summer campaign",
        projectReference: "PRJ-1001",
        attachmentName: "",
        attachmentUrl: "",
        createdAt: "2026-07-10T14:00:00.000Z"
      })
    })
  ]),

  expenses: Object.freeze([
    Object.freeze({
      id: "demo-expense-1001",
      data: Object.freeze({
        id: "demo-expense-1001",
        type: "expense",
        date: "2026-07-17",
        merchant: "Cloud Design Tools",
        category: "Software",
        description: "Monthly design software subscription",
        from: "",
        to: "",
        businessPurpose: "",
        miles: 0,
        ratePerMile: 0,
        amount: 0,
        net: 49,
        vatRate: 0.2,
        vat: 9.8,
        gross: 58.8,
        status: "Paid",
        notes: "Used by the creative team.",
        projectId: "demo-project-brightside-launch",
        projectName: "Brightside summer campaign",
        projectReference: "PRJ-1001",
        attachmentName: "",
        attachmentUrl: "",
        attachmentPath: "",
        attachmentSize: 0,
        attachmentType: "",
        createdAt: "2026-07-17T08:45:00.000Z",
        updatedAt: ""
      })
    })
  ]),

  mileage: Object.freeze([
    Object.freeze({
      id: "demo-mileage-1001",
      data: Object.freeze({
        id: "demo-mileage-1001",
        type: "mileage",
        date: "2026-07-16",
        merchant: "",
        category: "Mileage",
        description: "",
        from: "Bristol",
        to: "Bath",
        businessPurpose: "Brightside campaign planning meeting",
        miles: 42,
        ratePerMile: 0.55,
        amount: 23.1,
        net: 0,
        vatRate: 0,
        vat: 0,
        gross: 23.1,
        status: "Approved",
        notes: "Return journey.",
        projectId: "demo-project-brightside-launch",
        projectName: "Brightside summer campaign",
        projectReference: "PRJ-1001",
        attachmentName: "",
        attachmentUrl: "",
        attachmentPath: "",
        attachmentSize: 0,
        attachmentType: "",
        createdAt: "2026-07-16T17:30:00.000Z",
        updatedAt: ""
      })
    })
  ]),

  budgets: Object.freeze([
    Object.freeze({
      id: "demo-budget-brightside-july",
      data: Object.freeze({
        schemaVersion: 1,
        name: "Brightside July delivery budget",
        periodType: "monthly",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        budgetType: "overall",
        category: "",
        projectId: "demo-project-brightside-launch",
        projectName: "Brightside summer campaign",
        projectReference: "PRJ-1001",
        plannedAmount: 7500,
        status: "Active",
        createdAt: "2026-07-01T09:30:00.000Z",
        updatedAt: "2026-07-01T09:30:00.000Z"
      })
    })
  ])
});
