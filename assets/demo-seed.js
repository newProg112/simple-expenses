export const DEMO_SEED_VERSION = 2;

function freezeRecord(id, data){
  return Object.freeze({ id, data: Object.freeze(data) });
}

function isoTimestamp(date, time = "09:00:00"){
  return `${date}T${time}.000Z`;
}

function addDays(date, days){
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function displayDate(date){
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function roundMoney(value){
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function customer(id, name, email, address, paymentTerms = "14 days"){
  return freezeRecord(`demo-customer-${id}`, {
    name,
    email,
    address,
    paymentTerms,
    nameKey: name.toLowerCase(),
    emailKey: email.toLowerCase(),
    createdAt: "2026-01-05T09:00:00.000Z",
    updatedAt: "2026-07-31T16:00:00.000Z"
  });
}

const customers = Object.freeze([
  customer(
    "harbour-pine",
    "Harbour & Pine Joinery Ltd",
    "accounts@harbourandpine.example",
    "Unit 4, Avon Trade Park\nBristol\nBS2 0XA",
    "30 days"
  ),
  customer(
    "willow-reed",
    "Willow & Reed Homewares Ltd",
    "finance@willowandreed.example",
    "42 Milsom Street\nBath\nBA1 1DN"
  ),
  customer(
    "carter-finch",
    "Carter Finch Legal LLP",
    "billing@carterfinch.example",
    "9 Queen Square\nBristol\nBS1 4JE",
    "30 days"
  ),
  customer(
    "lantern-room",
    "The Lantern Room Bristol Ltd",
    "office@thelanternroom.example",
    "7 Welsh Back\nBristol\nBS1 4SP"
  ),
  customer(
    "youth-arts",
    "Bristol Youth Arts Trust",
    "finance@bristolyoutharts.example",
    "16 Jamaica Street\nBristol\nBS2 8JP",
    "30 days"
  ),
  customer(
    "severn-cycle",
    "Severn Cycle Works Ltd",
    "accounts@severncycleworks.example",
    "81 Gloucester Road\nBristol\nBS7 8AS"
  ),
  customer(
    "alder-architecture",
    "Alder & Co Architecture Ltd",
    "studio@alderarchitecture.example",
    "3 The Paragon\nClifton\nBristol\nBS8 2PB",
    "30 days"
  ),
  customer(
    "copper-kettle",
    "Copper Kettle Coffee Roasters Ltd",
    "accounts@copperkettlecoffee.example",
    "5 Temple Gate\nBristol\nBS1 6PL"
  ),
  customer(
    "mendip-garden",
    "Mendip Garden Rooms Ltd",
    "hello@mendipgardenrooms.example",
    "Oak Yard, Wells Road\nChew Magna\nBS40 8SH"
  ),
  customer(
    "west-wellbeing",
    "West Country Wellbeing CIC",
    "finance@westcountrywellbeing.example",
    "22 North Street\nBedminster\nBristol\nBS3 1HW",
    "30 days"
  )
]);

const customerById = new Map(customers.map(record => [record.id, record.data]));

function project(id, customerId, name, reference, status, startDate, endDate, budget, description){
  const linkedCustomer = customerById.get(customerId);
  return freezeRecord(`demo-project-${id}`, {
    name,
    reference,
    customerId,
    customerName: linkedCustomer.name,
    description,
    status,
    startDate,
    endDate,
    budget,
    createdAt: isoTimestamp(startDate, "09:15:00"),
    updatedAt: "2026-08-03T15:30:00.000Z"
  });
}

const projects = Object.freeze([
  project(
    "willow-spring",
    "demo-customer-willow-reed",
    "Willow & Reed spring rebrand",
    "PRJ-1001",
    "Completed",
    "2026-02-01",
    "2026-04-30",
    12000,
    "Brand identity, packaging direction and launch campaign for the spring collection."
  ),
  project(
    "lantern-seasonal",
    "demo-customer-lantern-room",
    "Lantern Room seasonal campaign",
    "PRJ-1002",
    "Active",
    "2026-04-01",
    "2026-09-30",
    10500,
    "Seasonal content, events promotion and paid social creative."
  ),
  project(
    "youth-donor",
    "demo-customer-youth-arts",
    "Youth Arts donor campaign",
    "PRJ-1003",
    "Active",
    "2026-05-01",
    "2026-10-31",
    8000,
    "Donor storytelling and campaign materials for the autumn fundraising appeal."
  ),
  project(
    "severn-ecommerce",
    "demo-customer-severn-cycle",
    "Severn Cycle ecommerce refresh",
    "PRJ-1004",
    "On Hold",
    "2026-03-01",
    "2026-08-31",
    9000,
    "Conversion-focused redesign of the online accessories shop."
  ),
  project(
    "carter-thought-leadership",
    "demo-customer-carter-finch",
    "Carter Finch thought leadership",
    "PRJ-1005",
    "Completed",
    "2026-01-15",
    "2026-03-31",
    6500,
    "Editorial strategy and a three-month professional services content series."
  ),
  project(
    "mendip-leads",
    "demo-customer-mendip-garden",
    "Mendip lead generation",
    "PRJ-1006",
    "Active",
    "2026-06-01",
    "2026-09-30",
    7200,
    "Landing pages, case studies and regional lead-generation creative."
  ),
  project(
    "copper-packaging",
    "demo-customer-copper-kettle",
    "Copper Kettle packaging launch",
    "PRJ-1007",
    "Active",
    "2026-07-01",
    "2026-10-31",
    11000,
    "Packaging system and trade launch assets for three new coffee ranges."
  )
]);

const projectById = new Map(projects.map(record => [record.id, record.data]));

function projectFields(projectId = ""){
  const linkedProject = projectById.get(projectId);
  return linkedProject ? {
    projectId,
    projectName: linkedProject.name,
    projectReference: linkedProject.reference
  } : {
    projectId: "",
    projectName: "",
    projectReference: ""
  };
}

function invoice(number, date, customerId, status, items, projectId = ""){
  const linkedCustomer = customerById.get(customerId);
  const paymentDays = linkedCustomer.paymentTerms === "30 days" ? 30 : 14;
  const amount = roundMoney(items.reduce((sum, item) => sum + item[1], 0));
  const vat = roundMoney(amount * 0.2);
  const invoiceNo = `INV-${number}`;
  return freezeRecord(`demo-invoice-${number}`, {
    invoiceNo,
    client: linkedCustomer.name,
    clientEmail: linkedCustomer.email,
    clientAddress: linkedCustomer.address,
    paymentTerms: linkedCustomer.paymentTerms,
    dueDate: addDays(date, paymentDays),
    amount,
    vat,
    total: roundMoney(amount + vat),
    items: Object.freeze(items.map(([description, itemAmount]) =>
      Object.freeze({ description, amount: itemAmount })
    )),
    status,
    date: displayDate(date),
    createdAt: isoTimestamp(date, "10:30:00"),
    recurringInvoice: "No",
    recurringFrequency: "",
    nextInvoiceDate: "",
    reminderDate: addDays(date, paymentDays - 2),
    ...projectFields(projectId)
  });
}

const invoices = Object.freeze([
  invoice("1001", "2026-02-05", "demo-customer-carter-finch", "Paid", [["Editorial strategy workshop", 1800]], "demo-project-carter-thought-leadership"),
  invoice("1002", "2026-02-12", "demo-customer-willow-reed", "Paid", [["Brand discovery and visual direction", 2400]], "demo-project-willow-spring"),
  invoice("1003", "2026-02-25", "demo-customer-harbour-pine", "Paid", [["Trade brochure design", 950]]),
  invoice("1004", "2026-03-05", "demo-customer-carter-finch", "Paid", [["Article series and social assets", 2200]], "demo-project-carter-thought-leadership"),
  invoice("1005", "2026-03-12", "demo-customer-willow-reed", "Paid", [["Identity design", 1900], ["Packaging concepts", 1200]], "demo-project-willow-spring"),
  invoice("1006", "2026-03-22", "demo-customer-severn-cycle", "Paid", [["Ecommerce research and wireframes", 1600]], "demo-project-severn-ecommerce"),
  invoice("1007", "2026-03-28", "demo-customer-lantern-room", "Paid", [["Campaign planning sprint", 1400]], "demo-project-lantern-seasonal"),
  invoice("1008", "2026-04-04", "demo-customer-willow-reed", "Paid", [["Brand guidelines", 2100], ["Launch toolkit", 1500]], "demo-project-willow-spring"),
  invoice("1009", "2026-04-11", "demo-customer-lantern-room", "Paid", [["Spring content production", 2250]], "demo-project-lantern-seasonal"),
  invoice("1010", "2026-04-18", "demo-customer-alder-architecture", "Paid", [["Practice credentials deck", 1250]]),
  invoice("1011", "2026-04-27", "demo-customer-severn-cycle", "Unpaid", [["Storefront visual design", 2800]], "demo-project-severn-ecommerce"),
  invoice("1012", "2026-05-06", "demo-customer-youth-arts", "Paid", [["Donor campaign discovery", 1500]], "demo-project-youth-donor"),
  invoice("1013", "2026-05-14", "demo-customer-lantern-room", "Paid", [["Summer menu launch campaign", 2600]], "demo-project-lantern-seasonal"),
  invoice("1014", "2026-05-23", "demo-customer-copper-kettle", "Paid", [["Retail brand audit", 1750]]),
  invoice("1015", "2026-05-29", "demo-customer-harbour-pine", "Paid", [["Project photography art direction", 1100]]),
  invoice("1016", "2026-06-04", "demo-customer-youth-arts", "Paid", [["Campaign identity and templates", 2400]], "demo-project-youth-donor"),
  invoice("1017", "2026-06-12", "demo-customer-mendip-garden", "Paid", [["Lead-generation strategy", 1850]], "demo-project-mendip-leads"),
  invoice("1018", "2026-06-19", "demo-customer-lantern-room", "Unpaid", [["Event creative and paid social assets", 2900]], "demo-project-lantern-seasonal"),
  invoice("1019", "2026-06-26", "demo-customer-west-wellbeing", "Paid", [["Community impact report design", 1350]]),
  invoice("1020", "2026-07-03", "demo-customer-copper-kettle", "Paid", [["Packaging concepts", 1800], ["Trade launch planning", 1000]], "demo-project-copper-packaging"),
  invoice("1021", "2026-07-10", "demo-customer-mendip-garden", "Paid", [["Landing page design and build", 2600]], "demo-project-mendip-leads"),
  invoice("1022", "2026-07-17", "demo-customer-youth-arts", "Unpaid", [["Donor stories and campaign photography", 2100]], "demo-project-youth-donor"),
  invoice("1023", "2026-07-25", "demo-customer-lantern-room", "Unpaid", [["August campaign production", 3200]], "demo-project-lantern-seasonal"),
  invoice("1024", "2026-08-01", "demo-customer-copper-kettle", "Unpaid", [["Packaging artwork rollout", 2300], ["Retail launch toolkit", 1200]], "demo-project-copper-packaging"),
  invoice("1025", "2026-08-03", "demo-customer-mendip-garden", "Unpaid", [["Case study production", 1950]], "demo-project-mendip-leads")
]);

function bill(number, supplier, billNumber, billDate, dueDate, category, net, vatRate, status, notes, projectId = ""){
  const vat = roundMoney(net * vatRate);
  const id = `demo-bill-${number}`;
  return freezeRecord(id, {
    id,
    supplier,
    billNumber,
    billDate,
    dueDate,
    category,
    net,
    vatRate,
    vat,
    total: roundMoney(net + vat),
    status,
    notes,
    ...projectFields(projectId),
    attachmentName: "",
    attachmentUrl: "",
    createdAt: isoTimestamp(billDate, "14:00:00")
  });
}

const bills = Object.freeze([
  bill("1001", "Harbourside Workspaces Ltd", "HSW-2602", "2026-02-01", "2026-02-15", "General", 900, 0.2, "Paid", "February studio rent."),
  bill("1002", "Nimbus Creative Cloud Ltd", "NCC-8841", "2026-02-08", "2026-02-22", "Software/subscriptions", 185, 0.2, "Paid", "Creative software licences."),
  bill("1003", "Bristol Energy Services", "BES-1948", "2026-03-03", "2026-03-17", "Utilities", 142, 0.2, "Paid", "Studio electricity and heating."),
  bill("1004", "Pixel Press Ltd", "PP-7842", "2026-03-18", "2026-04-01", "Professional fees", 620, 0.2, "Paid", "Willow & Reed launch proofs.", "demo-project-willow-spring"),
  bill("1005", "Avon Business Insurance", "ABI-6620", "2026-04-02", "2026-04-16", "Other", 480, 0, "Paid", "Annual professional indemnity premium."),
  bill("1006", "Searchlight Media Ltd", "SM-4107", "2026-04-16", "2026-04-30", "Professional fees", 780, 0.2, "Paid", "Paid social campaign setup.", "demo-project-lantern-seasonal"),
  bill("1007", "Nimbus Creative Cloud Ltd", "NCC-9012", "2026-04-28", "2026-05-12", "Software/subscriptions", 210, 0.2, "Paid", "Creative software and review tools."),
  bill("1008", "Clifton Office Supplies", "COS-5531", "2026-05-07", "2026-05-21", "General", 168, 0.2, "Paid", "Paper, notebooks and presentation materials."),
  bill("1009", "Greenbank Print Co", "GPC-1186", "2026-05-19", "2026-06-02", "Professional fees", 540, 0.2, "Paid", "Youth Arts campaign proofing.", "demo-project-youth-donor"),
  bill("1010", "Bristol Energy Services", "BES-2074", "2026-05-31", "2026-06-14", "Utilities", 155, 0.2, "Paid", "Studio utilities."),
  bill("1011", "Maeve Hart Photography", "MHP-0626", "2026-06-14", "2026-07-12", "Professional fees", 950, 0.2, "Unpaid", "Location photography for Mendip case studies.", "demo-project-mendip-leads"),
  bill("1012", "Nimbus Creative Cloud Ltd", "NCC-9274", "2026-06-21", "2026-07-05", "Software/subscriptions", 235, 0.2, "Paid", "Team software licences."),
  bill("1013", "Harbourside Workspaces Ltd", "HSW-2606", "2026-06-30", "2026-07-14", "General", 900, 0.2, "Paid", "July studio rent."),
  bill("1014", "Beacon Digital Advertising", "BDA-3208", "2026-07-12", "2026-08-10", "Professional fees", 720, 0.2, "Unpaid", "Trade launch advertising placement.", "demo-project-copper-packaging"),
  bill("1015", "Bristol Energy Services", "BES-2199", "2026-07-18", "2026-08-12", "Utilities", 164, 0.2, "Unpaid", "Studio utilities."),
  bill("1016", "Clifton Office Supplies", "COS-5910", "2026-07-24", "2026-08-07", "General", 286, 0.2, "Paid", "Ink, archive boxes and desk supplies."),
  bill("1017", "Avon Business Insurance", "ABI-7014", "2026-08-01", "2026-08-20", "Other", 520, 0, "Unpaid", "Equipment and cyber cover renewal."),
  bill("1018", "Nimbus Creative Cloud Ltd", "NCC-9440", "2026-08-02", "2026-08-18", "Software/subscriptions", 248, 0.2, "Unpaid", "August creative software licences.")
]);

function expense(number, date, merchant, category, description, net, vatRate = 0.2, projectId = "", status = "Paid"){
  const vat = roundMoney(net * vatRate);
  const id = `demo-expense-${number}`;
  return freezeRecord(id, {
    id,
    type: "expense",
    date,
    merchant,
    category,
    description,
    from: "",
    to: "",
    businessPurpose: "",
    miles: 0,
    ratePerMile: 0,
    amount: 0,
    net,
    vatRate,
    vat,
    gross: roundMoney(net + vat),
    status,
    notes: "",
    ...projectFields(projectId),
    attachmentName: "",
    attachmentUrl: "",
    attachmentPath: "",
    attachmentSize: 0,
    attachmentType: "",
    createdAt: isoTimestamp(date, "12:00:00"),
    updatedAt: ""
  });
}

const expenses = Object.freeze([
  expense("1001", "2026-02-09", "Cabot Circus Car Park", "Travel", "Parking for Carter Finch workshop", 18, 0.2, "demo-project-carter-thought-leadership"),
  expense("1002", "2026-02-18", "Great Western Railway", "Travel", "Return rail fare to Bath", 24.5, 0, "demo-project-willow-spring"),
  expense("1003", "2026-02-24", "The Glassboat Kitchen", "Meals", "Client discovery lunch", 68, 0.2, "demo-project-willow-spring"),
  expense("1004", "2026-03-07", "TypeFoundry Market", "Software", "Campaign typeface licence", 72, 0.2, "demo-project-carter-thought-leadership"),
  expense("1005", "2026-03-16", "Paper & Grain", "Office", "Sketchbooks and presentation boards", 46.5, 0.2),
  expense("1006", "2026-03-25", "Temple Gate Fuel", "Travel", "Fuel for client visits", 61.2, 0.2, "demo-project-severn-ecommerce"),
  expense("1007", "2026-04-08", "The Clifton Hotel", "Travel", "Accommodation after evening production shoot", 135, 0.2, "demo-project-lantern-seasonal"),
  expense("1008", "2026-04-20", "Colour Sample Co", "Office", "Packaging colour proofs", 84, 0.2, "demo-project-willow-spring"),
  expense("1009", "2026-05-04", "FrameStock Images", "Software", "Campaign image licence", 58, 0.2, "demo-project-youth-donor"),
  expense("1010", "2026-05-12", "Bristol Cycle Couriers", "Other", "Same-day proof delivery", 32, 0.2, "demo-project-lantern-seasonal"),
  expense("1011", "2026-05-21", "Engine Shed Workspace", "Office", "Workshop room hire", 95, 0.2, "demo-project-youth-donor"),
  expense("1012", "2026-06-02", "Poco Tapas", "Meals", "Mendip planning lunch", 74, 0.2, "demo-project-mendip-leads"),
  expense("1013", "2026-06-11", "Domain Harbour", "Software", "Domain and managed DNS renewals", 42, 0.2),
  expense("1014", "2026-06-18", "Bristol Taxi Co", "Travel", "Taxi to location photography", 28.4, 0, "demo-project-mendip-leads"),
  expense("1015", "2026-06-29", "Trenchard Street Car Park", "Travel", "Parking for Youth Arts review", 16, 0.2, "demo-project-youth-donor"),
  expense("1016", "2026-07-06", "WestTech Displays", "Office", "Colour-calibrated studio monitor", 340, 0.2),
  expense("1017", "2026-07-13", "ProofFlow Ltd", "Software", "Online artwork approval subscription", 39, 0.2, "demo-project-copper-packaging"),
  expense("1018", "2026-07-20", "Temple Gate Fuel", "Travel", "Fuel for Bath and Wells client visits", 67.5, 0.2, "demo-project-mendip-leads"),
  expense("1019", "2026-07-28", "Paper & Grain", "Office", "Presentation folders and stationery", 54.75, 0.2),
  expense("1020", "2026-08-03", "The Canteen Bristol", "Meals", "Copper Kettle launch planning meal", 82, 0.2, "demo-project-copper-packaging", "Approved")
]);

function mileage(number, date, from, to, miles, purpose, projectId = "", status = "Approved"){
  const ratePerMile = 0.55;
  const amount = roundMoney(miles * ratePerMile);
  const id = `demo-mileage-${number}`;
  return freezeRecord(id, {
    id,
    type: "mileage",
    date,
    merchant: "",
    category: "Mileage",
    description: "",
    from,
    to,
    businessPurpose: purpose,
    miles,
    ratePerMile,
    amount,
    net: 0,
    vatRate: 0,
    vat: 0,
    gross: amount,
    status,
    notes: "Return journey mileage.",
    ...projectFields(projectId),
    attachmentName: "",
    attachmentUrl: "",
    attachmentPath: "",
    attachmentSize: 0,
    attachmentType: "",
    createdAt: isoTimestamp(date, "17:30:00"),
    updatedAt: ""
  });
}

const mileageClaims = Object.freeze([
  mileage("1001", "2026-02-06", "Bristol", "Bath", 38, "Willow & Reed discovery workshop", "demo-project-willow-spring"),
  mileage("1002", "2026-02-20", "Bristol", "Cardiff", 88, "Supplier print review"),
  mileage("1003", "2026-03-04", "Bristol", "Cheltenham", 78, "Carter Finch editorial interview", "demo-project-carter-thought-leadership"),
  mileage("1004", "2026-03-19", "Bristol", "Weston-super-Mare", 48, "Severn Cycle user research", "demo-project-severn-ecommerce"),
  mileage("1005", "2026-04-09", "Bristol", "Bath", 38, "Willow & Reed launch review", "demo-project-willow-spring"),
  mileage("1006", "2026-04-23", "Bristol", "Gloucester", 72, "Campaign photography recce", "demo-project-lantern-seasonal"),
  mileage("1007", "2026-05-08", "Bristol", "Frome", 50, "Youth Arts donor interview", "demo-project-youth-donor"),
  mileage("1008", "2026-05-26", "Bristol", "Bath", 38, "Lantern Room content planning", "demo-project-lantern-seasonal"),
  mileage("1009", "2026-06-05", "Bristol", "Cardiff", 88, "Industry conference and networking"),
  mileage("1010", "2026-06-16", "Bristol", "Taunton", 96, "Mendip customer case-study interview", "demo-project-mendip-leads"),
  mileage("1011", "2026-06-27", "Bristol", "Bath", 38, "Youth Arts campaign review", "demo-project-youth-donor"),
  mileage("1012", "2026-07-04", "Bristol", "Stroud", 70, "Coffee packaging print test", "demo-project-copper-packaging"),
  mileage("1013", "2026-07-11", "Bristol", "Wells", 58, "Mendip location photography", "demo-project-mendip-leads"),
  mileage("1014", "2026-07-22", "Bristol", "Bath", 38, "Lantern Room August campaign meeting", "demo-project-lantern-seasonal"),
  mileage("1015", "2026-08-02", "Bristol", "Chepstow", 54, "Coffee retail launch planning", "demo-project-copper-packaging")
]);

function budget(id, name, periodType, startDate, endDate, budgetType, category, plannedAmount, projectId = "", status = "Active"){
  return freezeRecord(`demo-budget-${id}`, {
    schemaVersion: 1,
    name,
    periodType,
    startDate,
    endDate,
    budgetType,
    category,
    ...projectFields(projectId),
    plannedAmount,
    status,
    createdAt: isoTimestamp(startDate, "09:30:00"),
    updatedAt: "2026-08-01T09:30:00.000Z"
  });
}

const budgets = Object.freeze([
  budget("q1-operating", "Q1 operating budget", "quarterly", "2026-01-01", "2026-03-31", "overall", "", 18000, "", "Completed"),
  budget("q2-operating", "Q2 operating budget", "quarterly", "2026-04-01", "2026-06-30", "overall", "", 25000, "", "Completed"),
  budget("july-studio", "July studio spending", "monthly", "2026-07-01", "2026-07-31", "overall", "", 9500),
  budget("august-studio", "August studio spending", "monthly", "2026-08-01", "2026-08-31", "overall", "", 11000),
  budget("lantern-delivery", "Lantern Room campaign delivery", "custom", "2026-04-01", "2026-09-30", "overall", "", 10500, "demo-project-lantern-seasonal"),
  budget("youth-arts-delivery", "Youth Arts campaign delivery", "custom", "2026-05-01", "2026-10-31", "overall", "", 8000, "demo-project-youth-donor"),
  budget("software-annual", "Annual software budget", "annual", "2026-01-01", "2026-12-31", "category", "Software", 3600)
]);

export const DEMO_SEED = Object.freeze({
  businessProfile: Object.freeze({
    demoMode: true,
    fullName: "Maya Bennett",
    role: "Owner",
    businessName: "Northbank Creative Studio Ltd",
    businessEmail: "hello@northbankcreative.example",
    phoneNumber: "0117 496 0284",
    businessType: "Limited company",
    addressLine1: "24 Harbour Street",
    addressLine2: "Studio 3",
    townCity: "Bristol",
    postcode: "BS1 4ST",
    vatRegistered: "Yes",
    vatNumber: "GB123456789",
    businessWebsite: "https://northbankcreative.example",
    companyNumber: "12345678",
    paymentTermsDefault: "14 days",
    accountName: "Northbank Creative Studio Ltd",
    sortCode: "20-00-00",
    accountNumber: "12345678",
    companyLogoUrl: ""
  }),
  customers,
  projects,
  invoices,
  bills,
  expenses,
  mileage: mileageClaims,
  budgets
});
