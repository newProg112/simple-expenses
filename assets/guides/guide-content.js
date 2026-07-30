// Long-form guide articles live here so generated HTML remains disposable.
export const GUIDE_CONTENT = {
  "how-to-create-an-invoice": `<section>
          <h2>Introduction</h2>
          <p>An invoice is a document asking a customer to pay for products or services you have supplied. It records the amount the customer owes your business, but it is not proof that you have received the money. The invoice remains unpaid until the payment reaches you and you update its status.</p>
          <p>This guide explains how to create an invoice for a customer in Simple Books, from gathering the details to saving, downloading and sending it. It is practical guidance for UK freelancers, sole traders and small businesses, not legal, tax or accounting advice.</p>
        </section>

        <section>
          <h2>Before you create an invoice</h2>
          <p>Have the following information ready:</p>
          <ul class="remember-list">
            <li>Your business name, contact details and address.</li>
            <li>Your customer’s correct name, email address and billing address.</li>
            <li>A clear description of each product or service and its price before VAT.</li>
            <li>The agreed payment terms, such as 14 days.</li>
            <li>Your bank account name, sort code and account number if the customer will pay by bank transfer.</li>
            <li>Your VAT number and the correct VAT rate if your business is VAT-registered and the sale is taxable.</li>
          </ul>
          <p>Simple Books loads your business details, default payment terms and bank details from Account. Complete those details first if necessary; see <a href="/guides/setting-up-your-business">how to set up your business details</a>.</p>
          <p>It helps to agree the price and payment terms with the customer before doing the work. Check which details your invoice must contain for your business type and circumstances.</p>
        </section>

        <section>
          <h2>Create a new invoice in Simple Books</h2>
          <ol class="remember-list">
            <li>Open the invoice tool and find <strong>Create invoice</strong>.</li>
            <li>Expand <strong>Your Business</strong> to review the business name, email, website and VAT number loaded from Account. Changes here affect this invoice preview; update Account if the saved business information itself is wrong.</li>
            <li>Work down through <strong>Client details</strong> and <strong>Invoice details</strong>.</li>
          </ol>
          <p>The <strong>Invoice preview</strong> stays beside the form. It initially asks you to fill in the form; the finished customer-facing version appears when you select <strong>Generate Invoice</strong>.</p>
        </section>

        <section>
          <h2>Choose or enter the customer</h2>
          <p>If the customer already has a record, choose them from <strong>Saved Customer</strong>. Simple Books fills in their <strong>Client Name</strong>, <strong>Client Email</strong>, <strong>Client Address</strong> and saved <strong>Payment Terms</strong>.</p>
          <p>For a new customer, enter those details yourself. Select <strong>Save Customer</strong> if you want to keep or update the customer record for later invoices. A client name is required to save a customer record, although the invoice form itself does not stop you generating an invoice with a blank customer name. Check it before saving.</p>
          <p>Use the customer’s legal or trading name and an address they recognise. The email address is also used when Simple Books prepares an email draft.</p>
        </section>

        <section>
          <h2>Check the invoice number and date</h2>
          <p><strong>Invoice Number</strong> identifies the invoice. Simple Books suggests the next number in the sequence <strong>INV-001</strong>, <strong>INV-002</strong> and so on, based on the highest saved number with that format. You can edit the field, but each saved invoice number must be unique. If the number already exists, including with different capitalisation, Simple Books asks you to use another one.</p>
          <p><strong>Invoice Date</strong> defaults to today and can be changed. It is normally the date the invoice is issued. Choose the correct date before generating the invoice because it also affects the calculated due date and the period in which the invoice appears in dashboard and reporting totals.</p>
          <p>These three dates have different purposes:</p>
          <ul class="remember-list">
            <li><strong>Invoice date:</strong> when the invoice is issued.</li>
            <li><strong>Due date:</strong> the deadline by which the customer should pay.</li>
            <li><strong>Paid date:</strong> when the money actually reaches you. The current invoice tool can mark an invoice Paid, but it does not store a separate paid date.</li>
          </ul>
          <p>If the work belongs to a saved project, choose it from <strong>Project</strong>. Otherwise leave <strong>No project</strong> selected. The allocation is saved with the invoice and shown in the invoice list and preview.</p>
        </section>

        <section>
          <h2>Add products or services</h2>
          <p>The form provides three item rows. For each one you use, enter an <strong>Item Description</strong> and its <strong>Amount Before VAT (£)</strong>. Describe the work clearly enough for the customer to understand what they are paying for, for example “Website maintenance — July 2026”.</p>
          <p>Enter the total price for each line rather than a quantity and unit rate: the current form does not have quantity or unit-price fields. Only lines with a description and an amount greater than zero are included. Blank lines, zero amounts and negative amounts are left out.</p>
          <p>Simple Books adds the included line amounts to calculate the net total. “Net” means before VAT.</p>
        </section>

        <section>
          <h2>Add VAT where applicable</h2>
          <p>VAT is a tax charged on certain sales by VAT-registered businesses. Not every business is VAT-registered, and not every sale uses the standard rate. Do not add VAT simply because the field is available.</p>
          <p>Choose <strong>20%</strong>, <strong>5%</strong> or <strong>0%</strong> from <strong>VAT Rate</strong>. The selected rate applies to the whole invoice; Simple Books does not support a different VAT rate for each line. The form starts at 20%, so check it carefully. If you are not charging VAT, choose 0% and make sure the business VAT number is not shown incorrectly.</p>
          <p>Simple Books calculates VAT from the net total and then adds it to reach the gross total, which is the full amount the customer owes. For an introduction to the rules and terminology, read <a href="/guides/what-is-vat">What is VAT?</a> and <a href="/guides/input-vat-and-output-vat">understanding input VAT and output VAT</a>. Ask a qualified adviser or HMRC if you are unsure which treatment applies.</p>
        </section>

        <section>
          <h2>Set payment terms and the due date</h2>
          <p><strong>Payment Terms</strong> explains how long the customer has to pay. The default is loaded from Account, or 14 days if no saved default is available.</p>
          <p>When the payment terms contain a number, Simple Books takes the first number as a number of days and calculates <strong>Due Date</strong> from the invoice date. For example, “14 days” produces a due date 14 calendar days after the invoice date. Changing the invoice date or payment terms recalculates it, and <strong>Generate Invoice</strong> checks the calculation again.</p>
          <p>The <strong>Due Date</strong> field is editable, but a manual date will be replaced during generation while the payment terms still contain a number. If you need an individually agreed date, use payment-terms wording without a number, enter the date, and review both fields in the preview.</p>
          <p>An Unpaid invoice becomes Overdue in Simple Books once its due date is earlier than today. See <a href="/guides/understanding-overdue-invoices">how overdue invoices work</a> for help following up late payment.</p>
        </section>

        <section>
          <h2>Add payment details and any agreed wording</h2>
          <p>If Account contains an account name, sort code or account number, Simple Books automatically places the available details under <strong>Payment details</strong> in the invoice preview. Review them before sending the invoice. The payment terms also appear on the invoice.</p>
          <p>The current form has no free-text notes field. Put a useful reference or scope in an item description where appropriate, but do not use it for sensitive information. If the customer needs purchase-order wording or other notes that the form cannot represent, provide that information separately rather than assuming it has been added to the PDF.</p>
        </section>

        <section>
          <h2>Review and save the invoice</h2>
          <p>Before saving, check the customer, invoice number, invoice date, due date, item descriptions, net amount, VAT rate, VAT amount, total and payment details. Also confirm the selected project if you use project tracking.</p>
          <p>Select <strong>Generate Invoice</strong>. This is the save action for a new invoice: it saves the record with an <strong>Unpaid</strong> status and creates the <strong>Invoice preview</strong>. There is no separate Save button. The saved invoice appears under <strong>Recent invoices</strong>, and its amount and status feed the invoice dashboard totals, status and ageing views, customer statements and financial records. Project details remain attached to the invoice where selected.</p>
          <p>A generated invoice can be opened later with <strong>Edit invoice</strong>. Make your changes and select <strong>Update Invoice</strong>. If saving succeeds but the related ledger entry cannot be completed, Simple Books keeps the invoice and shows a warning so you can retry or contact support.</p>
        </section>

        <section>
          <h2>Download, print or send the invoice</h2>
          <p>After generating and reviewing the preview, select <strong>Save / Print PDF</strong>. Your browser’s print window opens; choose its PDF option to save a file, or choose a printer to print it. If you have not generated a preview first, Simple Books asks you to generate the invoice.</p>
          <p>Select <strong>Create Email Draft</strong> to open your usual email application with the customer’s email address, an invoice subject and a short message. This does not send the email and does not attach the invoice automatically. Save the PDF first, attach it to the draft yourself, check the recipient and wording, then send it from your email application.</p>
        </section>

        <section>
          <h2>Mark the invoice as paid</h2>
          <p>Generating an invoice records money owed; it does not record money received. When you can see the customer’s payment in your bank or payment service, find the invoice under <strong>Recent invoices</strong> and select <strong>Mark Paid</strong>. The button changes to <strong>Mark Unpaid</strong> so you can correct the status if necessary.</p>
          <p>Updating the status removes the invoice from outstanding and overdue totals and includes it in paid totals and customer-statement figures. Simple Books does not ask for or store the payment date, amount, method or bank match in this action, so keep suitable evidence of when the payment arrived. For a focused walkthrough, see <a href="/guides/how-to-mark-an-invoice-as-paid">how to mark an invoice as paid</a>.</p>
        </section>

        <section>
          <h2>Worked example</h2>
          <p>A VAT-registered freelance designer invoices a customer for a brand consultation and design work:</p>
          <ul class="remember-list">
            <li>Brand consultation: £200.00 before VAT</li>
            <li>Logo design: £600.00 before VAT</li>
            <li>Net total: £800.00</li>
            <li>VAT at 20%: £160.00 (£800.00 × 0.20)</li>
            <li>Gross total due: £960.00</li>
          </ul>
          <p>With an invoice date of 1 July 2026 and payment terms of 14 days, the due date is 15 July 2026. The customer owes £960.00. The invoice stays Unpaid until the money arrives and the designer selects <strong>Mark Paid</strong>.</p>
          <p>If the designer were not VAT-registered, they would not charge the £160.00 VAT merely because 20% is available in the form; they would select 0% and invoice £800.00, subject to the correct treatment for their circumstances.</p>
        </section>

        <section>
          <h2>Common invoice mistakes</h2>
          <ul class="remember-list">
            <li><strong>Using the wrong customer details.</strong> Check the saved record rather than assuming it is current.</li>
            <li><strong>Leaving the suggested 20% VAT rate unchanged.</strong> Select the correct rate for your VAT status and sale.</li>
            <li><strong>Using a duplicate or unclear invoice number.</strong> Keep a consistent, unique sequence.</li>
            <li><strong>Entering quantity instead of the line total.</strong> Each Amount field expects the full amount before VAT.</li>
            <li><strong>Using vague descriptions.</strong> State what was supplied and, where helpful, the period or project.</li>
            <li><strong>Overlooking the recalculated due date.</strong> Check it after changing the invoice date or payment terms.</li>
            <li><strong>Assuming Generate Invoice means paid.</strong> New invoices are saved as Unpaid.</li>
            <li><strong>Assuming the email draft includes the PDF.</strong> Attach the saved PDF before sending.</li>
            <li><strong>Marking the invoice Paid too early.</strong> Wait until you have confirmed receipt of the money.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>To create a clear small business invoice in Simple Books, choose or enter the customer, check the number and dates, add up to three products or services, apply the correct VAT rate and review the payment terms and bank details. Select <strong>Generate Invoice</strong> to save it as Unpaid and build the preview, then use <strong>Save / Print PDF</strong> or <strong>Create Email Draft</strong> to deliver it.</p>
          <p>After the customer pays, confirm the money has arrived and select <strong>Mark Paid</strong>. Keeping the invoice status accurate makes your outstanding, overdue and paid figures—and your customer statements—more useful.</p>
        </section>`,
  "how-to-mark-an-invoice-as-paid": `<section>
          <h2>Introduction</h2>
          <p>Creating an invoice records that a customer owes your business money. Sending it asks for payment. Neither action means the money has arrived.</p>
          <p>In Simple Books, <strong>Paid</strong> is a status you apply after independently confirming that the customer has paid the invoice in full. Simple Books does not check your bank or payment provider for you. This guide explains how to mark an invoice as paid, what changes afterwards and what the status does not record. This guide provides general product guidance and is not accounting, legal or tax advice.</p>
        </section>

        <section>
          <h2>When should you mark an invoice as paid?</h2>
          <p>Mark an invoice as paid only when you have confirmed that the full amount has reached you. Check the transaction in your bank account, card processor or other payment provider rather than relying only on a customer’s message or remittance advice.</p>
          <p>It helps to keep three ideas separate:</p>
          <ul class="remember-list">
            <li><strong>Money owed:</strong> the invoice total the customer is expected to pay.</li>
            <li><strong>Money received:</strong> funds that have actually arrived through your bank or payment provider.</li>
            <li><strong>Invoice status:</strong> the Paid, Unpaid or calculated Overdue label used by Simple Books to organise invoices.</li>
          </ul>
          <p>A newly generated invoice starts as <strong>Unpaid</strong>, even if you create and send it immediately. For the earlier steps, see <a href="/guides/how-to-create-an-invoice">how to create an invoice in Simple Books</a>.</p>
        </section>

        <section>
          <h2>Find the invoice in Simple Books</h2>
          <ol class="remember-list">
            <li>Open <strong>Invoices</strong>.</li>
            <li>Go to <strong>Recent invoices</strong>.</li>
            <li>Use the search box to search by customer, invoice number or project if needed.</li>
            <li>Use the status filter to show <strong>Unpaid</strong> or <strong>Overdue</strong> invoices when that helps narrow the list.</li>
            <li>Check the invoice number, customer, due date and total so that you update the correct record.</li>
          </ol>
          <p>An invoice whose due date has passed is displayed as Overdue while its stored status remains Unpaid. Read <a href="/guides/understanding-overdue-invoices">Understanding overdue invoices</a> for more about due dates and overdue figures.</p>
        </section>

        <section>
          <h2>Mark the invoice as paid</h2>
          <p>On the correct row under <strong>Recent invoices</strong>, select <strong>Mark Paid</strong>. Simple Books changes the stored status from Unpaid to Paid and refreshes the invoice list and its dashboard figures.</p>
          <p>The invoice’s status badge then reads <strong>Paid</strong>, its ageing text reads Paid, and the action changes to <strong>Mark Unpaid</strong>. There is no separate confirmation screen and Simple Books does not verify the bank transaction, so check the invoice carefully before selecting the button.</p>
        </section>

        <section>
          <h2>What changes after you mark it paid?</h2>
          <p>A paid invoice is no longer treated as outstanding, overdue or due soon. This means:</p>
          <ul class="remember-list">
            <li>Its full total is removed from the <strong>Outstanding</strong> card.</li>
            <li>If it was overdue, its full total is removed from the <strong>Overdue</strong> card and the overdue ageing chart.</li>
            <li>If it was due within seven days, it is no longer included in the <strong>Due Soon</strong> count.</li>
            <li>The <strong>Invoice Status</strong> chart moves one invoice from unpaid to paid.</li>
            <li>The invoice can be found with the <strong>Paid</strong> status filter.</li>
          </ul>
          <p>The change is based on the whole invoice total. It is a status update, not a bank transaction or payment record.</p>
        </section>

        <section>
          <h2>How paid invoices affect totals, statements and reports</h2>
          <p>When you generate a customer statement again, a paid invoice is included in the statement’s <strong>Paid</strong> amount instead of <strong>Outstanding</strong>. If <strong>Unpaid only</strong> is selected, the paid invoice is left out. The statement still includes the invoice in <strong>Total Raised</strong> when all statuses are shown.</p>
          <p>The invoice dashboard’s <strong>Revenue Trend</strong>, <strong>Invoiced This Month</strong> and top-customer figures use invoices whether they are paid or unpaid, so marking an invoice paid does not change those values. The dashboard does not currently display a separate paid money card; the <strong>Invoice Status</strong> chart compares counts of paid and unpaid invoices.</p>
          <p>Creating or updating an invoice produces the sales and VAT ledger posting used by financial reports. Marking it Paid changes only its status and does not create, replace or reverse that posting. Therefore reports such as <a href="/guides/understanding-profit-and-loss">Profit &amp; Loss</a> do not change merely because you select Mark Paid. For more context on the cards and charts, see <a href="/guides/understanding-the-dashboard">Understanding the dashboard</a>.</p>
        </section>

        <section>
          <h2>Correct a mistake with Mark Unpaid</h2>
          <p>If you marked the wrong invoice as paid, or the payment was later reversed, find the invoice under <strong>Recent invoices</strong> and select <strong>Mark Unpaid</strong>. Its stored status returns to Unpaid and the dashboard and statement calculations refresh accordingly.</p>
          <p>The invoice returns to Outstanding. If its due date is earlier than today, Simple Books displays it as Overdue again; if it falls within the next seven days, it can return to Due Soon. The status chart also moves one invoice back from paid to unpaid.</p>
          <p>Mark Unpaid is a correction to the invoice status only. Like Mark Paid, it does not alter the invoice’s accounting journal.</p>
        </section>

        <section>
          <h2>What Simple Books does not record</h2>
          <p>The Mark Paid action records only whether the invoice status is Paid or Unpaid. It does not store:</p>
          <ul class="remember-list">
            <li>A separate paid date.</li>
            <li>The payment amount.</li>
            <li>The payment method, such as bank transfer, card or cash.</li>
            <li>Several payments against one invoice or a remaining balance.</li>
            <li>A match between the invoice and a bank transaction.</li>
          </ul>
          <p>Partial payments are therefore not supported. If a customer pays only part of an invoice, do not mark the invoice as paid: Simple Books would treat the full total as paid. Keep appropriate evidence outside this status action and leave the invoice Unpaid until the full amount arrives, or seek advice on the correct way to handle the situation.</p>
          <p>There is no automatic bank matching or reconciliation in this workflow. Retain bank statements, payment-provider records and other supporting information suitable for your business.</p>
        </section>

        <section>
          <h2>Worked example</h2>
          <p>A freelance designer has sent invoice INV-014 for <strong>£960.00</strong>. Until payment arrives, Simple Books shows the invoice as Unpaid—or Overdue if its due date has passed—and includes £960.00 in Outstanding.</p>
          <ol class="remember-list">
            <li>The customer pays the full £960.00.</li>
            <li>The designer checks their bank and confirms that £960.00 has arrived.</li>
            <li>They find INV-014 under <strong>Recent invoices</strong> and select <strong>Mark Paid</strong>.</li>
            <li>The badge changes to Paid and the action changes to <strong>Mark Unpaid</strong>.</li>
          </ol>
          <p>The £960.00 leaves Outstanding and, if applicable, Overdue. A newly generated customer statement includes it in Paid. No paid date, payment method or bank match is created, and the original invoice ledger posting remains unchanged.</p>
        </section>

        <section>
          <h2>Common mistakes</h2>
          <ul class="remember-list">
            <li><strong>Marking an invoice as paid when it is created or sent.</strong> Wait until the money actually arrives.</li>
            <li><strong>Relying only on the customer’s message.</strong> Confirm the transaction with your bank or payment provider.</li>
            <li><strong>Updating the wrong invoice.</strong> Check the invoice number, customer and total first.</li>
            <li><strong>Marking a partial payment as paid.</strong> The status applies to the full invoice; partial balances are not supported.</li>
            <li><strong>Expecting a paid date or payment method to be saved.</strong> Keep those details in suitable supporting records.</li>
            <li><strong>Expecting Profit &amp; Loss to change.</strong> Mark Paid does not alter the invoice’s accounting posting.</li>
            <li><strong>Forgetting to correct a mistake.</strong> Use Mark Unpaid to restore the invoice to the unpaid calculations.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>To record invoice payment accurately in Simple Books, first confirm independently that the customer has paid the full amount. Find the invoice under <strong>Recent invoices</strong> and select <strong>Mark Paid</strong>. The invoice leaves outstanding, overdue and due-soon calculations, its badge changes to Paid, and customer statements and the status chart reflect the update.</p>
          <p>Use <strong>Mark Unpaid</strong> if the status needs correcting. Remember that these buttons update status only: they do not verify payment, store payment details, support partial payments, match a bank transaction or change the invoice’s ledger posting.</p>
        </section>`,
  "how-to-record-a-bill": `<section>
          <h2>Introduction</h2>
          <p>A bill records money your business owes to a supplier for goods or services it has received. It is the purchase-side counterpart to a customer invoice: a customer invoice records money owed to you, while a supplier bill records money you owe. If you also sell to customers, see <a href="/guides/how-to-create-an-invoice">how to create an invoice</a>.</p>
          <p>You can save a bill before you pay it. Recording the bill and paying the bill are separate events:</p>
          <ul class="remember-list">
            <li><strong>Recording a bill</strong> captures the supplier, dates, net amount, VAT, total and amount owed. Saving also creates or updates the bill’s accounting journal.</li>
            <li><strong>Paying a bill</strong> means money actually leaves your bank or other payment account.</li>
            <li><strong>Marking a bill as paid</strong> changes how Simple Books classifies the saved bill. It does not itself move money or create a bank transaction.</li>
          </ul>
          <p>This guide explains the current Bills workflow in Simple Books and the accounting records it creates. It is general product guidance, not accounting or tax advice.</p>
        </section>

        <section>
          <h2>When should you record a bill?</h2>
          <p>Record a bill when a supplier has issued a document showing an amount your business must pay, even if its due date is later. Saving it promptly keeps upcoming payments visible and records the cost in the period dated on the bill.</p>
          <p>For example, if your accountant sends a £600 bill on 10 July with payment due on 9 August, record it using the 10 July bill date. Leave its status as <strong>Unpaid</strong> until you have actually paid it. You do not need to wait until 9 August to enter it.</p>
          <p>A bill is normally appropriate where the business owes the supplier. A cost already paid may instead belong in the Expenses workflow, depending on how you keep your records. Avoid recording the same purchase as both a bill and an expense because that can duplicate the cost and VAT in your reports.</p>
        </section>

        <section>
          <h2>Open the Bills page</h2>
          <ol class="remember-list">
            <li>Sign in to Simple Books.</li>
            <li>Open <strong>Bills</strong> from the app navigation.</li>
            <li>Find the <strong>Add bill</strong> form.</li>
          </ol>
          <p>The page also shows bill summary cards, charts and <strong>Recent bills</strong>. Those areas update after a bill is saved. You can use <strong>Scan Bill</strong> to draft details from a supported document, but always review the extracted fields against the supplier’s original bill before saving.</p>
        </section>

        <section>
          <h2>Enter the supplier details</h2>
          <p>Start with the information that identifies the bill:</p>
          <ul class="remember-list">
            <li><strong>Supplier:</strong> enter the supplier’s name. This is required.</li>
            <li><strong>Bill number:</strong> enter the reference printed on the supplier’s bill so you can find and check it later.</li>
            <li><strong>Bill date:</strong> use the date shown on the bill. This date determines the accounting date of the journal.</li>
            <li><strong>Due date:</strong> enter the agreed payment deadline. Simple Books uses this to identify unpaid bills that are overdue or due soon.</li>
            <li><strong>Category:</strong> choose the option that best describes the cost, such as <strong>Utilities</strong>, <strong>Professional fees</strong> or <strong>Software/subscriptions</strong>.</li>
            <li><strong>Status:</strong> choose <strong>Unpaid</strong> when the supplier is still owed money. A bill can be recorded and saved with this status before it is paid.</li>
          </ul>
          <p>If the cost belongs to a saved project, choose it from <strong>Project</strong>; otherwise leave <strong>No project</strong> selected. You can also add <strong>Notes</strong> and attach a PDF receipt or bill where useful. These details support the record, but they do not replace checking the supplier, dates and figures.</p>
        </section>

        <section>
          <h2>Add bill items, VAT and totals</h2>
          <p>The current Bills form records one <strong>Net amount (£)</strong> for the bill rather than separate item rows. Add together the bill’s relevant lines and enter the total before VAT. Keep the supplier’s document attached or otherwise available if you need the individual line detail.</p>
          <p>Choose <strong>20%</strong>, <strong>5%</strong> or <strong>0%</strong> from <strong>VAT rate</strong>. The selected rate applies to the whole net amount; Simple Books does not currently apply different VAT rates to separate bill lines. It calculates the VAT amount from the net amount and adds the two figures to produce the gross total.</p>
          <p>For example, a £500.00 net bill at 20% produces £100.00 VAT and a £600.00 total. Where VAT is recoverable, the bill journal records it as VAT Input separately from the expense. Choosing a rate in the form does not establish that VAT is recoverable, so use the supplier document and the correct treatment for your circumstances. Read <a href="/guides/input-vat-and-output-vat">understanding input VAT and output VAT</a> for the distinction.</p>
          <p>Check that the calculated VAT and total agree with the supplier’s bill before saving. If one supplier bill contains mixed VAT rates, the single-rate form cannot reproduce those lines exactly; do not force the figures to fit.</p>
        </section>

        <section>
          <h2>Save the bill</h2>
          <p>Review the supplier, bill number, bill date, due date, category, net amount, VAT rate, status and project. Then select <strong>Save bill</strong>. The bill appears under <strong>Recent bills</strong> and begins contributing to the Bills page and dashboard totals.</p>
          <p>Saving the bill is not the same as paying it. If <strong>Unpaid</strong> is selected, Simple Books records the full gross amount as money owed to the supplier. The save action also creates an accounting journal dated with the bill date: the net amount is posted to the category’s expense account, recoverable VAT is posted to VAT Input where present, and the gross total is credited to Trade Payables.</p>
          <p>If the bill saves but its ledger posting cannot be completed, Simple Books keeps the bill and displays a warning. Retry the update or contact support rather than assuming the reports contain the posting.</p>
        </section>

        <section>
          <h2>Mark a bill as paid</h2>
          <p>Marking a bill as paid tells Simple Books that the supplier has now been paid. It updates the bill’s status and dashboard totals, but it does not record the bank payment automatically. Pay the supplier through your normal bank or payment process and independently confirm that the full amount has left your account. Then find the bill under <strong>Recent bills</strong> and select <strong>Mark paid</strong>. The bill’s status changes to Paid, the action changes to <strong>Mark unpaid</strong>, and the Bills page refreshes its status totals.</p>
          <p>After the status changes, the bill’s total moves out of the unpaid and overdue calculations and into paid totals. It no longer contributes to unpaid-bill or bill-due reminders on the dashboard. Simple Books stores the time of this status update, but the action does not ask for a payment amount, payment method or bank account and does not reconcile a bank transaction.</p>
          <p><strong>Marking a bill as paid changes its status only. It does not create, replace or reverse the accounting journal</strong> created when the bill was saved. In particular, the current action does not post a debit to Trade Payables and a credit to Bank. It therefore does not, by itself, record the accounting movement for settlement.</p>
          <p>If you update the wrong bill or mark it paid too early, select <strong>Mark unpaid</strong>. This reverses the status change: the amount returns to unpaid and, where its due date has passed, overdue totals. It does not reverse or recreate an accounting journal.</p>
        </section>

        <section>
          <h2>How bills affect the dashboard, reports and financial statements</h2>
          <p>A saved bill affects operational totals and accounting reports in different ways:</p>
          <ul class="remember-list">
            <li><strong>Dashboard:</strong> an Unpaid bill contributes its gross total to <strong>Unpaid bills</strong>, reduces the dashboard’s net-position calculation and can appear in overdue or due-soon actions. Bill charts and monthly bill totals use saved bills whether they are Paid or Unpaid.</li>
            <li><strong>Profit &amp; Loss:</strong> the net cost appears in the relevant expense account for the bill date. The VAT amount and gross payable do not form part of that expense figure. See <a href="/guides/understanding-profit-and-loss">understanding Profit &amp; Loss</a>.</li>
            <li><strong>Balance Sheet:</strong> the gross amount owed is credited to Trade Payables, a liability. Recoverable VAT is debited to VAT Input, an asset. See <a href="/guides/understanding-the-balance-sheet">understanding the Balance Sheet</a>.</li>
            <li><strong>General Ledger:</strong> the journal shows the individual debit and credit lines behind the bill, including the expense, VAT Input where applicable and Trade Payables. See <a href="/guides/understanding-the-general-ledger">understanding the General Ledger</a>.</li>
          </ul>
          <p>The Profit &amp; Loss, Balance Sheet and General Ledger use the journal created when the bill is saved, not the Paid or Unpaid label. Selecting <strong>Mark paid</strong> changes the dashboard’s unpaid and status-based figures, but it does not change those accounting postings. This means Trade Payables is not cleared by that button alone under the current Simple Books behaviour.</p>
        </section>

        <section>
          <h2>Edit or delete a bill</h2>
          <p>To correct a saved record, find it under <strong>Recent bills</strong> and select <strong>Edit</strong>. The details return to the form. Make the changes, review the recalculated VAT and total, then select <strong>Update bill</strong>. Updating replaces the bill’s accounting journal with one based on the revised values.</p>
          <p>Use <strong>Delete</strong> only after checking that you have selected the right bill and understanding the reporting effect. Simple Books asks you to confirm before removing the bill record. Under the current behaviour, deleting a bill does not create an accounting reversal, so do not assume that Delete also removes or reverses its existing ledger posting. Correcting a genuine accounting record may require separate review.</p>
          <p>Keep the original supplier document and an audit trail appropriate for your business. Editing or deleting a record purely to make a report look different can make the books harder to explain.</p>
        </section>

        <section>
          <h2>Worked example</h2>
          <p>A VAT-registered web designer receives a monthly cloud-software bill from Northstar Hosting with these details:</p>
          <ul class="remember-list">
            <li>Bill number: NSH-4821</li>
            <li>Bill date: 3 July 2026</li>
            <li>Due date: 17 July 2026</li>
            <li>Category: Software/subscriptions</li>
            <li>Net amount: £240.00</li>
            <li>VAT at 20%: £48.00</li>
            <li>Total owed: £288.00</li>
          </ul>
          <p>The designer enters £240.00 as the net amount, chooses <strong>20%</strong>, leaves the status as <strong>Unpaid</strong> and selects <strong>Save bill</strong>. Simple Books calculates £48.00 VAT and a £288.00 total.</p>
          <p>The saved journal debits Software &amp; Subscriptions by £240.00, debits VAT Input by £48.00 and credits Trade Payables by £288.00. The Profit &amp; Loss therefore includes a £240.00 software cost, while the Balance Sheet includes £48.00 VAT Input and £288.00 Trade Payables. The General Ledger shows all three lines.</p>
          <p>Until payment, the dashboard includes £288.00 in <strong>Unpaid bills</strong>. On 15 July the designer pays Northstar Hosting and confirms the payment with the bank. They select <strong>Mark paid</strong>, so £288.00 leaves the unpaid and due calculations and moves into paid status totals. The original three-line journal remains unchanged because Mark paid is only a status update; it does not record the bank payment or clear Trade Payables.</p>
        </section>

        <section>
          <h2>Common mistakes</h2>
          <ul class="remember-list">
            <li><strong>Waiting until payment to record the bill.</strong> Save an Unpaid bill when the supplier issues it so the amount owed and due date stay visible.</li>
            <li><strong>Treating Save bill as a payment.</strong> Saving records the bill and its accounting journal; it does not send money.</li>
            <li><strong>Entering the gross amount as Net amount.</strong> Use the amount before VAT or the calculated total will be too high.</li>
            <li><strong>Leaving the default VAT rate unchecked.</strong> Match the rate and VAT amount to the supplier document and your VAT treatment.</li>
            <li><strong>Forcing a mixed-rate bill into one VAT rate.</strong> The current form applies one rate to the whole net amount.</li>
            <li><strong>Using the wrong category or date.</strong> These choices affect the expense account and reporting period.</li>
            <li><strong>Recording the same purchase twice.</strong> Check that it has not already been entered as a bill or expense.</li>
            <li><strong>Marking a bill paid before confirming payment.</strong> The button does not check your bank.</li>
            <li><strong>Expecting Mark paid to clear Trade Payables.</strong> It changes status only and does not post settlement entries.</li>
            <li><strong>Ignoring a mistaken status.</strong> Select <strong>Mark unpaid</strong> to return the bill to unpaid and overdue calculations where applicable.</li>
            <li><strong>Deleting a bill to correct its accounting.</strong> Delete does not currently create a reversal of the existing journal.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>To record a bill in Simple Books, open <strong>Bills</strong>, enter the supplier and bill references, check the bill and due dates, choose a category, add the net amount and correct VAT rate, and leave the status as <strong>Unpaid</strong> while money is still owed. Select <strong>Save bill</strong> to store the record and create its accounting journal.</p>
          <p>After the supplier has been paid, select <strong>Mark paid</strong> to update unpaid, overdue and paid status totals. Use <strong>Mark unpaid</strong> if that status was applied by mistake. These actions organise the bill’s status; they do not create a bank payment or alter the bill’s Profit &amp; Loss, Balance Sheet or General Ledger posting.</p>
        </section>`,
  "how-to-record-a-business-expense": `<section>
          <h2>Introduction</h2>
          <p>A business expense is a cost incurred for the work your business carries out. Recording it in Simple Books keeps the merchant, date, category, VAT, receipt and approval status together and creates the accounting journal used by your reports.</p>
          <p>The Expenses page handles both expenses and mileage claims. This guide covers the <strong>Expense</strong> option: purchases from a merchant or supplier rather than business journeys. For journeys, see <a href="/guides/claiming-business-mileage">claiming business mileage</a>.</p>
          <p>Saving an expense and paying or reimbursing it are different events. Saving records the expense and its journal. The status shows where the claim sits in the workflow, but changing that status does not automatically record money moving through a bank account. This is general product guidance, not accounting or tax advice.</p>
        </section>

        <section>
          <h2>When should you record an expense?</h2>
          <p>Record an expense when the business has incurred a day-to-day cost or an expense claim needs to be tracked. Typical examples include office supplies, software, professional fees, meals or business travel that is not being entered as a mileage claim.</p>
          <p>Enter the expense promptly using the date on the receipt or purchase document. This helps place the cost in the correct reporting period and keeps the supporting receipt close to the saved record. Use the appropriate status—<strong>Draft</strong>, <strong>Submitted</strong>, <strong>Approved</strong> or <strong>Paid</strong>—for the stage the expense has reached.</p>
          <p>Record a genuine business cost only once. Entering the same purchase as both an expense and a supplier bill creates two records and can duplicate the cost, VAT and liability in your financial reports.</p>
        </section>

        <section>
          <h2>Bills vs Expenses</h2>
          <p>Both workflows record purchase-side costs, but they serve different records in Simple Books:</p>
          <ul class="remember-list">
            <li><strong>Use Bills</strong> when a supplier has issued a bill that your business owes and you need to track its bill number, bill date, due date and Paid or Unpaid status. The bill journal credits Trade Payables. See <a href="/guides/how-to-record-a-bill">how to record a bill</a>.</li>
            <li><strong>Use Expenses</strong> for a day-to-day purchase or expense claim that you want to track through Draft, Submitted, Approved and Paid statuses. The expense journal credits Employee Reimbursements Payable.</li>
          </ul>
          <p>The Expenses form does not contain a supplier bill number or due date. The Bills form does not use the expense approval statuses. Choose the workflow that matches the source document and how the cost needs to be tracked, and do not enter the same transaction in both.</p>
        </section>

        <section>
          <h2>Open the Expenses page</h2>
          <ol class="remember-list">
            <li>Sign in to Simple Books.</li>
            <li>Open <strong>Expenses</strong> from the app navigation.</li>
            <li>In the <strong>Add expense</strong> form, make sure <strong>Expense</strong> is selected rather than <strong>Mileage</strong>.</li>
          </ol>
          <p>The page also contains summary cards, status and category charts, and <strong>Recent expenses</strong>. These update after an expense is saved. The <strong>Scan Receipt</strong> button opens the document-scanning workflow described later in this guide.</p>
        </section>

        <section>
          <h2>Enter the expense details</h2>
          <p>Complete the purchase and claim fields with the information from the receipt or other supporting document:</p>
          <ul class="remember-list">
            <li><strong>Date:</strong> use the purchase or expense date. The journal uses this date for financial reporting.</li>
            <li><strong>Merchant / Supplier:</strong> enter the business that supplied the goods or services. This field is required before saving.</li>
            <li><strong>Category:</strong> choose <strong>General</strong>, <strong>Travel</strong>, <strong>Meals</strong>, <strong>Office</strong>, <strong>Software</strong>, <strong>Utilities</strong>, <strong>Professional fees</strong> or <strong>Other</strong>.</li>
            <li><strong>Status:</strong> choose <strong>Draft</strong>, <strong>Submitted</strong>, <strong>Approved</strong> or <strong>Paid</strong>. New forms start at Draft.</li>
            <li><strong>Description:</strong> briefly explain what the purchase was for.</li>
          </ul>
          <p>The category determines which expense account receives the net cost. Travel, Utilities, Professional fees and Software have matching accounts; categories without a dedicated account currently post to General Expenses. Review the choice rather than relying on the default <strong>General</strong> category.</p>
        </section>

        <section>
          <h2>Add VAT and totals</h2>
          <p>Enter the amount before VAT in <strong>Net amount (£)</strong>. Choose <strong>20%</strong>, <strong>5%</strong> or <strong>0%</strong> from <strong>VAT rate</strong>. Simple Books calculates <strong>VAT amount (£)</strong> from the net amount and rate, then adds the two figures to the read-only <strong>Gross amount (£)</strong>.</p>
          <p>The VAT amount is editable. This is useful where the document’s VAT differs from the simple rate calculation, but the gross amount will always be recalculated as net plus the VAT amount entered. Changing the VAT rate recalculates VAT from the net amount again. Check all three figures against the receipt before saving.</p>
          <p>The form starts with a 20% rate, so do not leave it unchanged without checking. A VAT rate being available does not mean the VAT is recoverable. Use the correct treatment for the purchase and your VAT position. For the terminology behind purchase VAT, see <a href="/guides/input-vat-and-output-vat">understanding input VAT and output VAT</a>.</p>
          <p>The current expense form records one net amount and one VAT amount for the whole expense. It does not provide separate item rows or different VAT rates for individual lines.</p>
        </section>

        <section>
          <h2>Attach receipts</h2>
          <p>A receipt supports the amount, merchant, date and VAT you have recorded. Under <strong>Attachment</strong>, select <strong>Attach PDF receipt</strong> and choose the document from your device. Manual expense attachments currently accept PDF files up to 10 MB.</p>
          <p>The file is uploaded when you select <strong>Save expense</strong>. After saving, <strong>Recent expenses</strong> provides a <strong>View PDF</strong> link. When you edit an expense, the current attachment is retained unless you select a replacement.</p>
          <p>The separate receipt scanner accepts additional image formats and can keep the scanned document as the attachment. That route is explained under <strong>AI Scan Expense</strong>. For more general document-handling guidance, see <a href="/guides/uploading-receipts">uploading receipts</a>.</p>
        </section>

        <section>
          <h2>Add notes and project allocation</h2>
          <p>Use <strong>Notes</strong> for optional supporting context that does not fit the short description. For example, explain the business reason for an unusual purchase or add an internal reference. Avoid including unnecessary sensitive information.</p>
          <p>If the expense belongs to a saved project, choose it from <strong>Project</strong>. Otherwise leave <strong>No project</strong> selected. Simple Books saves the project name and reference with the expense, displays the allocation under <strong>Recent expenses</strong>, and includes allocated expense costs in project views. See <a href="/guides/tracking-project-profitability">tracking project profitability</a> for wider context.</p>
        </section>

        <section>
          <h2>Save the expense</h2>
          <p>Review the date, merchant, category, project, net amount, VAT, gross amount, status, description, notes and attachment. Then select <strong>Save expense</strong>. The record appears under <strong>Recent expenses</strong> and contributes to the Expenses page totals and charts.</p>
          <p>Saving a non-mileage expense creates an accounting journal using the expense date. Simple Books debits the selected expense account for the net amount, debits VAT Input for any VAT amount, and credits Employee Reimbursements Payable for the gross amount. This posting is created whether the saved status is Draft, Submitted, Approved or Paid.</p>
          <p>If the expense saves but the related journal cannot be completed, Simple Books keeps the expense and shows a warning. Retry the update or contact support rather than assuming the cost appears in financial reports.</p>
          <p>For an expense that is not yet Paid, <strong>Recent expenses</strong> shows <strong>Mark paid</strong>. Selecting it stores a Paid status and the time of the update. Mark paid updates the expense’s status only: it does not create, replace or reverse the accounting journal, record a bank payment or reconcile a bank transaction. There is no <strong>Mark unpaid</strong> action for expenses; use <strong>Edit</strong> and choose the correct status if you need to fix a mistake.</p>
        </section>

        <section>
          <h2>AI Scan Expense</h2>
          <p>Select <strong>Scan Receipt</strong> to upload a JPG, JPEG, PNG, WEBP or PDF document up to 10 MB. Choose the file, select <strong>Scan receipt</strong>, and wait while Simple Books reads it. The scanner then displays the details it extracted for you to review.</p>
          <p>Select <strong>Use these details</strong> to add safe extracted values to the expense form. Depending on the document, Simple Books can draft the merchant, date, category, net amount and VAT rate. Extracted descriptive text is added to <strong>Notes</strong>. It calculates the form totals and warns when a category, VAT rate or total needs manual review.</p>
          <p>The scan does not save the expense. Check every highlighted value against the original document, complete any missing fields, choose the status and project yourself, then select <strong>Save expense</strong>. If no manual attachment is already selected, the scanned document is kept as a pending attachment and uploaded during the save.</p>
          <p>You cannot apply scanned details while editing an existing expense. If a manual attachment is already selected, Simple Books keeps that manual file and warns that it cannot also use the scanned document as the attachment. For an overview of document scanning across purchase records, see <a href="/guides/using-ai-invoice-scanning">using AI invoice scanning</a>.</p>
        </section>

        <section>
          <h2>How expenses affect the Dashboard, Profit &amp; Loss, Balance Sheet and General Ledger</h2>
          <p>A saved expense affects operational views and accounting reports in different ways:</p>
          <ul class="remember-list">
            <li><strong>Expenses page:</strong> the gross amount contributes to total expenses and the chosen status total. The VAT amount contributes to <strong>VAT reclaimable</strong>. Paid and non-Paid records feed the paid and outstanding expense summaries.</li>
            <li><strong>Dashboard:</strong> saved expenses can appear in recent activity with their merchant or description, gross amount, status and activity date. The main dashboard’s invoice-and-bill chart does not add expense records to its bills figure.</li>
            <li><strong>Profit &amp; Loss:</strong> the net amount appears in the relevant expense account for the expense date and reduces profit. See <a href="/guides/understanding-profit-and-loss">understanding Profit &amp; Loss</a>.</li>
            <li><strong>Balance Sheet:</strong> VAT is debited to VAT Input and the gross amount is credited to Employee Reimbursements Payable. See <a href="/guides/understanding-the-balance-sheet">understanding the Balance Sheet</a>.</li>
            <li><strong>General Ledger:</strong> the detailed journal shows the expense debit, any VAT Input debit and the Employee Reimbursements Payable credit. See <a href="/guides/understanding-the-general-ledger">understanding the General Ledger</a>.</li>
          </ul>
          <p>The financial statements and General Ledger use the journal created when the expense is saved. Changing the status, including selecting <strong>Mark paid</strong>, does not clear Employee Reimbursements Payable or create a Bank entry under the current behaviour.</p>
        </section>

        <section>
          <h2>Edit or delete an expense</h2>
          <p>Find the record under <strong>Recent expenses</strong> and select <strong>Edit</strong>. The saved values return to the form and the action changes to <strong>Update expense</strong>. Make the correction, check the VAT and gross amount again, then select <strong>Update expense</strong>. Updating replaces the expense journal with one based on the revised values.</p>
          <p>Select <strong>Cancel edit</strong> if you do not want to save the changes. Starting an edit also removes any separate scanned receipt that was waiting to be applied or uploaded.</p>
          <p>Use <strong>Delete</strong> only after checking the record. Simple Books asks for confirmation, removes the expense record and attempts to remove its stored attachment. Under the current behaviour, deleting an expense does not create an accounting reversal, so do not assume that Delete also removes or reverses the existing journal. A correction to accounting records may need separate review.</p>
        </section>

        <section>
          <h2>Worked example</h2>
          <p>A design studio buys stationery from Parkside Office Supplies for a client project. The receipt shows:</p>
          <ul class="remember-list">
            <li>Date: 8 July 2026</li>
            <li>Merchant / Supplier: Parkside Office Supplies</li>
            <li>Category: Office</li>
            <li>Net amount: £85.00</li>
            <li>VAT at 20%: £17.00</li>
            <li>Gross amount: £102.00</li>
            <li>Status: Draft</li>
            <li>Project: Website refresh</li>
          </ul>
          <p>The studio enters £85.00 as the net amount and chooses 20%. Simple Books calculates £17.00 VAT and a £102.00 gross amount. The user adds “Sketchbooks and presentation materials” as the description, selects the project, attaches the PDF receipt and selects <strong>Save expense</strong>.</p>
          <p>Because Office currently uses the General Expenses account, the journal debits General Expenses by £85.00, debits VAT Input by £17.00 and credits Employee Reimbursements Payable by £102.00. Profit &amp; Loss includes the £85.00 cost. The Balance Sheet includes the £17.00 VAT Input asset and £102.00 payable liability, while the General Ledger shows all three lines.</p>
          <p>The expense appears in the Expenses page’s Draft and outstanding totals and can appear in Dashboard recent activity. If the user later selects <strong>Mark paid</strong>, the status changes to Paid, but the three accounting lines remain unchanged and no bank transaction is created.</p>
        </section>

        <section>
          <h2>Common mistakes</h2>
          <ul class="remember-list">
            <li><strong>Using Expenses for a supplier bill with a due date.</strong> Use Bills when you need bill references, due dates and Trade Payables.</li>
            <li><strong>Recording the same purchase twice.</strong> Check Bills and Expenses before adding another record.</li>
            <li><strong>Leaving the default category unchanged.</strong> The category controls the expense account used by the journal.</li>
            <li><strong>Entering the gross amount as Net amount.</strong> Enter the before-VAT figure and check the calculated gross total.</li>
            <li><strong>Assuming the default 20% VAT applies.</strong> Match the receipt and the correct VAT treatment.</li>
            <li><strong>Overwriting a correct VAT amount.</strong> The VAT field is editable, so compare it with the document after any change.</li>
            <li><strong>Trying to attach an image manually.</strong> Manual expense attachments currently require a PDF; use <strong>Scan Receipt</strong> for supported receipt images.</li>
            <li><strong>Trusting AI-extracted details without review.</strong> Check the merchant, date, category and all amounts before saving.</li>
            <li><strong>Assuming Save expense records payment.</strong> Saving creates the expense and journal, not a bank transaction.</li>
            <li><strong>Expecting Mark paid to update the ledger.</strong> It changes status only and does not clear Employee Reimbursements Payable.</li>
            <li><strong>Deleting an expense to reverse its journal.</strong> Delete does not currently create an accounting reversal.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>To record a business expense in Simple Books, open <strong>Expenses</strong>, select <strong>Expense</strong>, enter the date and merchant, choose the appropriate category and status, add the net amount and correct VAT, and include a clear description. Attach a PDF receipt manually or use <strong>Scan Receipt</strong> to draft details from a supported document, then review everything and select <strong>Save expense</strong>.</p>
          <p>Saving creates the expense journal used by Profit &amp; Loss, the Balance Sheet and the General Ledger. Status changes help organise Draft, Submitted, Approved and Paid expenses, but they do not record or reconcile bank payments. Keep the source document, category, VAT and project allocation accurate so the expense remains useful in both operational views and accounting reports.</p>
        </section>`,
  "how-to-claim-business-mileage": `<section>
          <h2>Introduction</h2>
          <p>A business mileage claim records a journey made for work and calculates a claim amount from the miles travelled and the rate per mile. In Simple Books, mileage claims share the <strong>Expenses</strong> page with ordinary business expenses, but they use a separate Mileage form and create their own accounting journal.</p>
          <p>This guide explains how to enter a mileage claim, attach supporting evidence, save it and understand how it affects the current Simple Books totals and reports. It covers the software’s present behaviour only and is general product guidance, not tax or accounting advice.</p>
        </section>

        <section>
          <h2>When should you claim business mileage?</h2>
          <p>Record mileage when you have made a journey for a business purpose and want to calculate a claim from the distance travelled. Examples might include travelling to a client site, attending a business meeting or visiting a supplier.</p>
          <p>Keep enough information to explain the journey: the date, start and end locations, business purpose, miles travelled and rate used. Do not use Mileage for train fares, parking, fuel receipts or other purchases that need a merchant, VAT and gross amount. Those belong in the Expense form; see <a href="/guides/how-to-record-a-business-expense">how to record a business expense</a>.</p>
          <p>Simple Books calculates the amount you enter but does not decide whether a journey is allowable, choose the correct rate for your circumstances or track annual mileage thresholds. Confirm the appropriate treatment separately.</p>
        </section>

        <section>
          <h2>Open the Expenses page and switch to Mileage</h2>
          <ol class="remember-list">
            <li>Sign in to Simple Books.</li>
            <li>Open <strong>Expenses</strong> from the app navigation.</li>
            <li>In the claim-type control above the form, select <strong>Mileage</strong>.</li>
          </ol>
          <p>The heading changes from <strong>Add expense</strong> to <strong>Add mileage</strong>. The purchase and VAT fields are replaced by <strong>Journey details</strong> and <strong>Mileage calculation</strong>.</p>
          <p>Switch before entering the claim so you are working in the correct form. If a scanned receipt is waiting to be attached to an expense, selecting Mileage removes that pending scanned receipt. Receipt scanning does not populate mileage journeys.</p>
        </section>

        <section>
          <h2>Enter the journey details</h2>
          <p>Complete the fields that identify why and where you travelled:</p>
          <ul class="remember-list">
            <li><strong>Date:</strong> enter the date of the journey. The accounting journal uses this date.</li>
            <li><strong>From:</strong> enter the start location. A start location is required before saving.</li>
            <li><strong>To:</strong> enter the end location. An end location is also required.</li>
            <li><strong>Project:</strong> choose a saved project if the journey relates to one, or leave <strong>No project</strong> selected.</li>
            <li><strong>Description / business purpose:</strong> explain why the journey was necessary, for example “Client planning meeting”.</li>
            <li><strong>Notes:</strong> add any optional supporting context or internal reference.</li>
          </ul>
          <p>Project allocation is saved with the claim, shown in the recent list and included in the selected project’s mileage costs and project totals. See <a href="/guides/tracking-project-profitability">tracking project profitability</a> for more about allocated costs.</p>
        </section>

        <section>
          <h2>Mileage calculation</h2>
          <p>Enter the total distance in <strong>Miles</strong>. The value must be greater than zero before the claim can be saved. Decimal distances are supported, so a journey can be entered as 24.6 miles where appropriate.</p>
          <p><strong>Rate per mile (£)</strong> starts at £0.55 per mile and can be edited. Simple Books does not look up or validate the rate. Enter the rate that applies to the claim you are recording.</p>
          <p>The read-only <strong>Amount (£)</strong> is calculated automatically as miles multiplied by the rate per mile. It updates when either field changes and is rounded to two decimal places. For example, 40 miles at £0.55 per mile produces a £22.00 claim.</p>
          <p>Mileage claims do not contain net, VAT or gross purchase fields. The calculated mileage amount becomes the claim value, and the saved mileage journal does not create a VAT journal line.</p>
        </section>

        <section>
          <h2>Attach supporting evidence</h2>
          <p>Use <strong>Attach mileage file</strong> if you want to keep supporting evidence with the claim. The current Mileage form accepts PDF, JPG and PNG files up to 10 MB. A PDF journey log, route record or other suitable evidence can therefore be attached directly.</p>
          <p>The file uploads when the mileage claim is saved. Once available, the row under <strong>Recent expenses</strong> provides a <strong>View attachment</strong> link. If no file is needed, the claim can be saved without one.</p>
          <p>Choose supporting material that helps explain the saved journey without adding unnecessary sensitive information. For more general attachment guidance, see <a href="/guides/uploading-receipts">uploading receipts</a>.</p>
        </section>

        <section>
          <h2>Save the mileage claim</h2>
          <p>Choose the current <strong>Status</strong>: <strong>Draft</strong>, <strong>Submitted</strong>, <strong>Approved</strong> or <strong>Paid</strong>. A new Mileage form starts at Draft. These labels organise claims by their current stage; they do not change the mileage calculation.</p>
          <p>Review the journey date, route, purpose, project, miles, rate, amount, status, notes and attachment. Then select <strong>Save mileage</strong>. The saved record appears in the shared <strong>Recent expenses</strong> list. Select the <strong>Mileage</strong> filter to show mileage claims only; search and the project, status and date filters can narrow the list further.</p>
          <p>Saving creates an accounting journal using the journey date. Simple Books debits Travel &amp; Mileage for the calculated amount and credits Employee Reimbursements Payable for the same amount. This journal is created regardless of whether the saved status is Draft, Submitted, Approved or Paid.</p>
          <p>If the claim saves but the ledger posting cannot be completed, Simple Books keeps the mileage claim and shows a warning. Retry the update or contact support rather than assuming it appears in financial reports.</p>
          <p>A claim that is not Paid has a <strong>Mark paid</strong> action in the recent list. Selecting it changes the status to Paid and stores the time of the update. It does not create, replace or reverse the mileage journal, record a bank payment or reconcile a bank transaction. There is no <strong>Mark unpaid</strong> action; use <strong>Edit</strong> to choose the correct status if you make a mistake.</p>
        </section>

        <section>
          <h2>How mileage affects the Dashboard, Profit &amp; Loss, Balance Sheet and General Ledger</h2>
          <p>A saved mileage claim affects operational summaries and accounting reports in different ways:</p>
          <ul class="remember-list">
            <li><strong>Expenses page totals:</strong> the claim contributes to <strong>Total mileage</strong>, the total miles recorded, the combined claims value and the mileage portion of <strong>Claims by type</strong>.</li>
            <li><strong>Expenses page charts and statuses:</strong> its amount contributes to the chosen Draft, Submitted, Approved or Paid total and to paid or outstanding claim values. Mileage is not included in the expense-category or monthly-expense charts, which use non-mileage expenses.</li>
            <li><strong>Dashboard:</strong> the saved claim can appear in recent activity as an Expense with its claim amount, status and activity date. The main Dashboard does not have a separate mileage total or mileage chart.</li>
            <li><strong>Profit &amp; Loss:</strong> the full calculated claim amount is posted to Travel &amp; Mileage for the journey date and reduces profit. See <a href="/guides/understanding-profit-and-loss">understanding Profit &amp; Loss</a>.</li>
            <li><strong>Balance Sheet:</strong> the same amount is credited to Employee Reimbursements Payable, which is shown as a liability. See <a href="/guides/understanding-the-balance-sheet">understanding the Balance Sheet</a>.</li>
            <li><strong>General Ledger:</strong> the journal contains a Travel &amp; Mileage debit and an equal Employee Reimbursements Payable credit, with the route, purpose, miles and rate in its description. See <a href="/guides/understanding-the-general-ledger">understanding the General Ledger</a>.</li>
          </ul>
          <p>Changing a claim’s status does not change these financial-report postings. In particular, <strong>Mark paid</strong> does not clear Employee Reimbursements Payable or create a Bank entry under the current behaviour.</p>
        </section>

        <section>
          <h2>Edit or delete a mileage claim</h2>
          <p>Find the claim under <strong>Recent expenses</strong> and select <strong>Edit</strong>. Simple Books switches the form to Mileage and restores the journey, calculation, status, notes and project values. Make the changes, check the recalculated amount, then select <strong>Update mileage</strong>. Updating replaces the mileage journal with one based on the revised claim.</p>
          <p>Select <strong>Cancel edit</strong> to leave edit mode without saving changes. If you choose a new attachment while editing, it replaces the previous stored file when the update succeeds.</p>
          <p>Select <strong>Delete</strong> only after checking the claim. The current confirmation prompt asks whether to delete the expense, then removes the mileage record and attempts to remove its stored attachment. Under the current behaviour, deleting a mileage claim does not create an accounting reversal, so do not assume that Delete also removes or reverses its existing journal.</p>
        </section>

        <section>
          <h2>Worked example</h2>
          <p>A UK marketing consultant drives from their Leeds office to a client meeting in Sheffield and returns the same day. The total business distance is 80.0 miles. They record:</p>
          <ul class="remember-list">
            <li>Date: 14 July 2026</li>
            <li>From: Leeds office</li>
            <li>To: Sheffield client site</li>
            <li>Description / business purpose: Quarterly campaign meeting</li>
            <li>Miles: 80.0</li>
            <li>Rate per mile: £0.55</li>
            <li>Calculated amount: £44.00</li>
            <li>Status: Draft</li>
            <li>Project: Sheffield campaign</li>
          </ul>
          <p>Simple Books calculates £44.00 because 80.0 miles × £0.55 equals £44.00. The consultant adds a PDF route record, checks the project and selects <strong>Save mileage</strong>.</p>
          <p>The journal debits Travel &amp; Mileage by £44.00 and credits Employee Reimbursements Payable by £44.00. Profit &amp; Loss includes the £44.00 travel cost, the Balance Sheet includes the £44.00 liability, and the General Ledger shows both lines. No VAT line is created.</p>
          <p>The claim contributes 80.0 miles and £44.00 to the Mileage summaries on the Expenses page. If it is later marked Paid, the status totals change, but the two journal lines remain unchanged and Simple Books does not create a bank transaction.</p>
        </section>

        <section>
          <h2>Common mistakes</h2>
          <ul class="remember-list">
            <li><strong>Entering the journey in Expense mode.</strong> Select <strong>Mileage</strong> before completing the route and distance.</li>
            <li><strong>Using Mileage for a travel purchase.</strong> Record train fares, parking and similar merchant costs as expenses rather than mileage distance.</li>
            <li><strong>Leaving the route unclear.</strong> Enter recognisable start and end locations.</li>
            <li><strong>Omitting the business purpose.</strong> Add a concise explanation of why the journey was made.</li>
            <li><strong>Entering one-way miles for a return journey.</strong> Record the actual total business distance represented by the claim.</li>
            <li><strong>Assuming £0.55 is automatically the correct rate.</strong> It is the form’s editable starting value, not a rate decision made by Simple Books.</li>
            <li><strong>Typing a claim total instead of the distance.</strong> Enter miles and the rate; Simple Books calculates Amount.</li>
            <li><strong>Expecting VAT to be calculated.</strong> Mileage claims create no VAT journal line.</li>
            <li><strong>Assuming Save mileage records payment.</strong> Saving creates the claim and its journal, not a bank transaction.</li>
            <li><strong>Expecting Mark paid to clear the liability.</strong> It changes status only.</li>
            <li><strong>Deleting a claim to reverse its journal.</strong> Delete does not currently create an accounting reversal.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>To claim business mileage in Simple Books, open <strong>Expenses</strong>, switch to <strong>Mileage</strong>, enter the journey date, start and end locations, project and business purpose, then add the miles travelled and check the editable rate. Simple Books calculates the amount automatically. Add notes or a PDF, JPG or PNG attachment where useful, choose the status and select <strong>Save mileage</strong>.</p>
          <p>The saved claim contributes to Mileage and status summaries and creates a two-line accounting journal: a debit to Travel &amp; Mileage and a credit to Employee Reimbursements Payable. Status changes organise the claim but do not record payment, alter the journal or reconcile a bank transaction.</p>
        </section>`,
  "uploading-receipts": `<section>
          <h2>Introduction</h2>
          <p>Uploading receipts and other supporting documents keeps the evidence close to the bill, expense or mileage claim it relates to. In Simple Books, the available file types and what happens to a file depend on the record and whether you attach it manually or use document scanning.</p>
          <p>The same workflows let you attach receipts to expenses and save receipt documents alongside the records you review in Simple Books.</p>
          <p>This guide explains the current attachment behaviour for Bills, Expenses, Mileage, AI scanning and recent records. It is practical product guidance for UK freelancers, sole traders and small businesses, not legal, tax or accounting advice.</p>
        </section>

        <section>
          <h2>Why attach receipts and supporting documents?</h2>
          <p>A receipt, supplier bill or route record can help you understand what a saved entry represents and check it later. Keeping the document with the record can also make routine review and handover easier.</p>
          <p>An attachment is supporting evidence, not a substitute for checking the record. Before saving, compare the document with the <strong>merchant or supplier</strong>, <strong>date</strong>, <strong>amount</strong>, <strong>VAT</strong>, <strong>category</strong> and <strong>business purpose</strong> you entered. Keep only information that is useful to the business record, and avoid uploading unnecessary personal, payment or other sensitive information.</p>
        </section>

        <section>
          <h2>Where attachments are available in Simple Books</h2>
          <p>Attachments are available in three record workflows:</p>
          <ul class="remember-list">
            <li><strong>Bills:</strong> the <strong>Attachment</strong> area uses <strong>Attach PDF receipt/bill</strong>. See <a href="/guides/how-to-record-a-bill">how to record a bill</a>.</li>
            <li><strong>Expenses:</strong> the <strong>Attachment</strong> area uses <strong>Attach PDF receipt</strong>. See <a href="/guides/how-to-record-a-business-expense">how to record a business expense</a>.</li>
            <li><strong>Mileage:</strong> switch the Expenses page to <strong>Mileage</strong>; the attachment control changes to <strong>Attach mileage file</strong>. See <a href="/guides/how-to-claim-business-mileage">how to claim business mileage</a>.</li>
          </ul>
          <p>Bills and ordinary expenses also have a separate AI document-scanning workflow. Scanning can draft form values and, for a new record, hold the scanned document as a pending attachment. It does not save the record automatically.</p>
        </section>

        <section>
          <h2>Attach a receipt to a bill</h2>
          <ol class="remember-list">
            <li>Open <strong>Bills</strong> and complete the bill details.</li>
            <li>Under <strong>Attachment</strong>, select <strong>Attach PDF receipt/bill</strong>.</li>
            <li>Choose a PDF from your device. The file name appears with the message <strong>Manual attachment selected. It will be uploaded when you save.</strong></li>
            <li>Check the supplier, bill dates, amounts, VAT, category and notes, then select <strong>Save bill</strong>.</li>
          </ol>
          <p>The manual bill control accepts PDF files only. The current bill code checks that the file is a PDF, but it does not apply an app-level file-size limit to this manual route. Do not assume the 10 MB scanning limit also applies here.</p>
        </section>

        <section>
          <h2>Attach a receipt to an expense</h2>
          <ol class="remember-list">
            <li>Open <strong>Expenses</strong> and keep <strong>Expense</strong> selected.</li>
            <li>Complete the expense details, including the merchant, date, category, amounts, VAT and description.</li>
            <li>Under <strong>Attachment</strong>, select <strong>Attach PDF receipt</strong>.</li>
            <li>Choose a PDF no larger than 10 MB, then select <strong>Save expense</strong>.</li>
          </ol>
          <p>Although the underlying file picker lists some image extensions for the shared Expense and Mileage control, the current Expense validation accepts PDF only. A JPG, JPEG or PNG selected in Expense mode is rejected with <strong>Please choose a PDF file.</strong> Use <strong>Scan Receipt</strong> when you want to use a supported receipt image.</p>
        </section>

        <section>
          <h2>Attach evidence to a mileage claim</h2>
          <ol class="remember-list">
            <li>Open <strong>Expenses</strong> and select <strong>Mileage</strong>.</li>
            <li>Enter the journey date, route, business purpose, miles and rate.</li>
            <li>Select <strong>Attach mileage file</strong> and choose a PDF, JPG, JPEG or PNG file no larger than 10 MB.</li>
            <li>Review the calculated claim and select <strong>Save mileage</strong>.</li>
          </ol>
          <p>A route record, journey log or suitable image can support the claim. Receipt scanning does not fill mileage fields. Switching from Expense to Mileage also removes any scanned receipt that was waiting to be attached.</p>
        </section>

        <section>
          <h2>Upload a document with AI scanning</h2>
          <p>On Bills, select <strong>Scan Bill</strong>. On Expenses, select <strong>Scan Receipt</strong>. Both scanners accept JPG, JPEG, PNG, WEBP and PDF files up to 10 MB. After choosing a file, select <strong>Scan bill</strong> or <strong>Scan receipt</strong>, review the extracted results, then select <strong>Use these details</strong>.</p>
          <p>Simple Books applies only values it can safely place in the form and highlights them for review. You must still check the supplier or merchant, dates, amounts, VAT, category and description or business purpose. For more detail about the extracted fields and limitations, see <a href="/guides/using-ai-invoice-scanning">using AI invoice scanning</a>.</p>
          <p>For a new bill or expense, the scanned file becomes a pending attachment if no manual attachment is already selected. It is uploaded only when you save the record. If a manual file is already selected, Simple Books keeps the manual file and warns that you must remove it first to use the scanned document as the attachment. Selecting a manual attachment after a scan uses the manual file instead and removes the pending scanned file.</p>
          <p>Scanned details cannot be applied while you are editing an existing bill or expense. Starting an edit also removes any separate scanned document that was waiting to be applied or uploaded.</p>
        </section>

        <section>
          <h2>Save and view an attachment</h2>
          <p>Choosing a file does not upload it immediately. A manual file uploads when you select <strong>Save bill</strong>, <strong>Save expense</strong> or <strong>Save mileage</strong>. A pending AI-scanned document is also uploaded during the save, after the new record itself has first been saved.</p>
          <p>If a scanned-document upload fails at that later stage, the bill or expense remains saved and Simple Books warns that you can edit the record and attach the file manually.</p>
          <p>After a successful save, use the relevant recent-record list:</p>
          <ul class="remember-list">
            <li><strong>Recent bills:</strong> the attachment name is a link and a <strong>View PDF</strong> action appears.</li>
            <li><strong>Recent expenses:</strong> an attached expense has a <strong>View PDF</strong> link.</li>
            <li><strong>Recent expenses</strong> for Mileage: an attached claim has a <strong>View attachment</strong> link.</li>
          </ul>
          <p>These links open the stored file in a new browser tab. A record without a stored attachment shows <strong>No attachment</strong>.</p>
        </section>

        <section>
          <h2>Replace an attachment while editing</h2>
          <p>Select <strong>Edit</strong> beside the saved record. Bills show the existing file name and <strong>Existing PDF will be kept.</strong> Expenses show the current file name and <strong>Current attachment will be kept unless replaced.</strong> A mileage attachment is retained when you update the claim without choosing a new file, although the Mileage edit form does not currently display the existing file name or a “kept” message.</p>
          <p>Choose a new permitted file and select <strong>Update bill</strong>, <strong>Update expense</strong> or <strong>Update mileage</strong> to replace the attachment reference on the record. There is no control that removes an existing stored attachment while keeping the record attachment-free.</p>
          <p>Expense and mileage replacements attempt to delete the previous stored file after the updated record saves. Bill replacements update the bill to the new attachment, but the current Bills implementation does not track a storage path or delete the previous stored file. If the replacement uses a different filename, the earlier bill file can therefore remain in storage even though it is no longer linked from the bill.</p>
        </section>

        <section>
          <h2>Delete a record and its attachment</h2>
          <p>Use <strong>Delete</strong> only after checking the record and confirming the prompt. The attachment behaviour differs by workflow:</p>
          <ul class="remember-list">
            <li><strong>Bills:</strong> deleting a bill removes the record, but the current Bills implementation does not attempt to delete its stored attachment.</li>
            <li><strong>Expenses and Mileage:</strong> deleting the record also attempts to delete the stored file when an attachment storage path is available.</li>
          </ul>
          <p>If an Expense or Mileage storage deletion fails, Simple Books logs the failure but does not restore or block deletion of the underlying record. The file may therefore remain in storage without a record linking to it.</p>
        </section>

        <section>
          <h2>Supported file types and size limits</h2>
          <ul class="remember-list">
            <li><strong>Manual bill attachment:</strong> PDF only. No app-level maximum file size is currently enforced.</li>
            <li><strong>Manual expense attachment:</strong> PDF only, up to 10 MB.</li>
            <li><strong>Manual mileage attachment:</strong> PDF, JPG, JPEG or PNG, up to 10 MB.</li>
            <li><strong>AI Scan Bill and Scan Receipt:</strong> PDF, JPG, JPEG, PNG or WEBP, up to 10 MB.</li>
          </ul>
          <p>The 10 MB limit means 10 × 1,024 × 1,024 bytes. A file above that limit is rejected before upload in the relevant workflow. Renaming an unsupported file does not reliably make it a supported document; use a genuine file in one of the listed formats.</p>
        </section>

        <section>
          <h2>Worked examples</h2>
          <h3>Attach a PDF supplier bill</h3>
          <p>A freelance designer receives a PDF bill from a printer. They open Bills, enter the supplier, dates, category, net amount and VAT, select <strong>Attach PDF receipt/bill</strong>, choose the PDF and select <strong>Save bill</strong>. The saved row in <strong>Recent bills</strong> then provides <strong>View PDF</strong>.</p>
          <h3>Scan a photographed expense receipt</h3>
          <p>A consultant photographs a café receipt as a JPG. They select <strong>Scan Receipt</strong>, choose the photo, select <strong>Scan receipt</strong> and then <strong>Use these details</strong>. The photo becomes a pending attachment because no manual PDF is selected. They check the merchant, date, category, net, VAT and gross figures before selecting <strong>Save expense</strong>.</p>
          <h3>Attach a route record to mileage</h3>
          <p>A sole trader records a client journey in Mileage and selects <strong>Attach mileage file</strong> to add a PNG route image under 10 MB. After selecting <strong>Save mileage</strong>, the claim appears in <strong>Recent expenses</strong> with <strong>View attachment</strong>.</p>
        </section>

        <section>
          <h2>Common attachment mistakes</h2>
          <ul class="remember-list">
            <li><strong>Uploading an image through the manual Expense control.</strong> Ordinary expenses accept only PDF manually; use <strong>Scan Receipt</strong> for JPG, JPEG, PNG or WEBP.</li>
            <li><strong>Assuming every upload has the same limit.</strong> The 10 MB check applies to manual Expenses, manual Mileage and both scanners, but not to the current manual Bill attachment code.</li>
            <li><strong>Expecting a chosen file to upload immediately.</strong> It remains selected or pending until the record is saved.</li>
            <li><strong>Applying a scan during an edit.</strong> Scanned details can be applied only to a new bill or expense.</li>
            <li><strong>Expecting two attachments.</strong> Each record stores one attachment reference; a manual file takes priority over a pending scanned document.</li>
            <li><strong>Assuming a replacement or deletion always removes the old bill file.</strong> Bills do not currently clean up stored attachments.</li>
            <li><strong>Relying on the document without checking the form.</strong> Confirm the merchant or supplier, date, amount, VAT, category and business purpose yourself.</li>
            <li><strong>Uploading unnecessary sensitive information.</strong> Keep the supporting evidence relevant and proportionate.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>To upload a receipt in Simple Books, choose the attachment control for the record, select a supported file and save the bill, expense or mileage claim. Manual Bills and Expenses are PDF-only; Mileage also accepts JPG, JPEG and PNG. AI scanning accepts PDF, JPG, JPEG, PNG and WEBP and can hold the scanned document as a pending attachment for a new bill or expense.</p>
          <p>Attachments upload when the record is saved and can then be opened from the recent-record list. Existing attachments normally remain during editing unless you choose a replacement. Remember that Expense and Mileage deletion attempts storage cleanup, while Bills currently leave stored files untouched. Always check the saved figures and avoid keeping sensitive information that the business record does not need.</p>
        </section>`
};
