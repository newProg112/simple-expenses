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
        </section>`
};
