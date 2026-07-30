// Long-form guide articles live here so generated HTML remains disposable.
export const GUIDE_CONTENT = {
  "understanding-the-dashboard": `<section>
          <h2>Introduction</h2>
          <p>The Dashboard is the operational overview shown when you open Simple Books. It brings together selected invoice, bill, client, customer, expense and mileage data so you can see amounts still outstanding, items needing attention, recent records and broad monthly patterns.</p>
          <p>This guide explains the Dashboard exactly as it is currently implemented. Its figures are management prompts based on saved transaction records. They are not accounting balances and should not be treated as a replacement for the Trial Balance, General Ledger, Profit &amp; Loss or Balance Sheet.</p>
        </section>

        <section>
          <h2>What the Dashboard is for</h2>
          <p>Use the Dashboard to answer practical questions such as: how much do customers currently owe, how much is still owed on supplier bills, are any invoices or bills past their due dates, and which records were most recently active?</p>
          <p>The page contains a Getting Started checklist, four calculated KPI cards, two accounting-report shortcuts, two charts, a Next Actions area and Recent Activity. Selecting the Outstanding invoices or Overdue items cards opens Invoices. Selecting Unpaid bills or Net position opens Bills. The Trial Balance and Balance Sheet cards are shortcuts to those reports rather than calculated Dashboard KPIs.</p>
          <p>The Dashboard has no date-range, customer, supplier, project or status filters. It loads its figures once when the page opens.</p>
        </section>

        <section>
          <h2>Dashboard KPIs</h2>
          <h3>Outstanding invoices</h3>
          <p><strong>Outstanding invoices</strong> adds the full <strong>Total</strong> of every saved invoice whose status is not exactly <strong>Paid</strong>. In normal use this means Unpaid invoices, including those whose due dates have passed. The figure includes VAT where VAT forms part of the invoice total. It is not restricted to the current month.</p>

          <h3>Paid invoices</h3>
          <p>The current Dashboard does not display a separate <strong>Paid invoices</strong> KPI. Paid invoices are excluded from Outstanding invoices, overdue checks and the receivables ageing chart. They remain included in the Income vs Bills chart because that chart adds all saved invoice totals regardless of status.</p>

          <h3>Overdue invoices and Overdue items</h3>
          <p>The current card is labelled <strong>Overdue items</strong>, not Overdue invoices. It shows a count, not a money value, and combines overdue invoices with overdue supplier bills. An invoice or bill is overdue when its status is not exactly Paid, it has a valid due date, and that date is earlier than today. A due date of today is not overdue.</p>
          <p>There is no separate Overdue invoices KPI. The overdue-invoice count and value are shown in Next Actions when at least one invoice needs chasing.</p>

          <h3>Unpaid bills</h3>
          <p>The current bills KPI is labelled <strong>Unpaid bills</strong>. It adds the full <strong>Total</strong> of every saved bill whose status is not exactly Paid, including overdue bills. The value includes VAT where VAT forms part of the bill total and covers all dates.</p>

          <h3>Net position</h3>
          <p><strong>Net position</strong> is Outstanding invoices minus Unpaid bills. It compares gross operational totals. A positive amount means the outstanding invoice total is greater than the unpaid bill total; a negative amount means unpaid bills are greater. It is not a bank balance, cash forecast, profit figure or accounting Balance Sheet position.</p>

          <h3>Expenses this month and Mileage this month</h3>
          <p>The current Dashboard does not display separate <strong>Expenses this month</strong> or <strong>Mileage this month</strong> KPIs. Expenses and mileage claims do not contribute to Outstanding invoices, Unpaid bills, Net position, Overdue items or either chart. They can appear in Recent Activity using the saved expense gross amount or mileage amount.</p>

          <h3>Income vs Bills Difference</h3>
          <p>The current page does not show Income vs Bills Difference as a KPI card. <strong>Difference</strong> is the third series in the Income vs Bills chart. For each month it is all invoice totals minus all bill totals for that month. It includes Paid and Unpaid records and excludes expenses and mileage.</p>
        </section>

        <section>
          <h2>Dashboard charts</h2>
          <h3>Income vs Bills</h3>
          <p>The <strong>Income vs Bills</strong> line chart groups records by month and plots three series:</p>
          <ul class="remember-list">
            <li><strong>Invoices:</strong> the full totals of all saved invoices in the month, regardless of Paid or Unpaid status.</li>
            <li><strong>Bills:</strong> the full totals of all saved bills in the month, regardless of Paid or Unpaid status.</li>
            <li><strong>Difference:</strong> Invoices minus Bills for that month.</li>
          </ul>
          <p>Invoices are grouped using invoice date, falling back to created date. Bills use bill date, falling back to due date and then created date. Months with activity are shown in chronological order. The chart uses gross totals, including VAT where present. It does not include expenses, mileage, projects or payment dates, and its Difference line is not accounting profit.</p>

          <h3>Outstanding Receivables Ageing</h3>
          <p>The <strong>Outstanding Receivables Ageing</strong> bar chart groups outstanding invoice value into <strong>Not yet due</strong>, <strong>0–30 days</strong>, <strong>31–60 days</strong> and <strong>61+ days</strong>. It includes invoice statuses Unpaid, Outstanding and Overdue without regard to capitalisation; a missing status is treated as Unpaid. Paid invoices and unsupported status values are excluded.</p>
          <p>Age is measured from the due date to today. A due date after today goes into Not yet due. An invoice due today and invoices up to 30 days overdue go into 0–30 days. If no due date exists, the ageing calculation falls back to invoice date. Invalid dates are ignored. Each bucket uses the invoice’s full total, including VAT.</p>
          <p>Both charts are rebuilt from the records loaded when the Dashboard opens. They do not update live while the page remains open in another tab.</p>
        </section>

        <section>
          <h2>Recent activity</h2>
          <p>Recent Activity combines invoices, bills, clients or customers, and the shared expense/mileage collection. It sorts them by the date chosen for each record and displays the five most recent items.</p>
          <ul class="remember-list">
            <li><strong>Invoices:</strong> show invoice number or client, gross total, status and invoice date, falling back to created date and then due date.</li>
            <li><strong>Bills:</strong> show bill number or supplier, gross total, status and bill date, falling back to due date and then created date.</li>
            <li><strong>Clients or customers:</strong> show the name and status but no amount. If at least one client record exists, the customer collection is not added separately.</li>
            <li><strong>Expenses and mileage:</strong> are both labelled <strong>Expense</strong>. The amount uses gross expense value first, then the mileage amount. Their ordering date uses updated date before transaction date or created date, so editing one can move it up the list.</li>
          </ul>
          <p>Recent Activity is a display list, not an audit log. It shows at most five current records and does not preserve a history of every edit or status change.</p>
        </section>

        <section>
          <h2>Dashboard reminders and alerts</h2>
          <p>The <strong>Getting Started</strong> checklist tracks five setup conditions: a profile with full name, business name and email; default payment terms; at least one client or customer; at least one invoice; and a first backup recorded as downloaded in the browser. Completed items are hidden. When all five are complete, the card shows <strong>Setup complete</strong>.</p>
          <p><strong>Next Actions</strong> currently creates up to two reminders:</p>
          <ul class="remember-list">
            <li><strong>Overdue invoices to chase:</strong> appears when one or more non-Paid invoices have due dates earlier than today. It shows their count and combined gross total, with a link to Invoices.</li>
            <li><strong>Bills need attention:</strong> combines non-Paid bills already overdue with non-Paid bills due from today through seven days from today. It shows the relevant counts and combined gross total, with a link to Bills.</li>
          </ul>
          <p>If neither reminder applies, the page says <strong>You’re all caught up.</strong> These are fixed date-and-status checks. They do not judge whether an invoice should be disputed, whether a bill has been scheduled for payment or whether a transaction’s accounting treatment is correct.</p>
        </section>

        <section>
          <h2>How dashboard figures are calculated</h2>
          <ul class="remember-list">
            <li><strong>Outstanding invoices</strong> = sum of invoice Total where status is not exactly Paid.</li>
            <li><strong>Unpaid bills</strong> = sum of bill Total where status is not exactly Paid.</li>
            <li><strong>Net position</strong> = Outstanding invoices − Unpaid bills.</li>
            <li><strong>Overdue items</strong> = count of overdue non-Paid invoices + count of overdue non-Paid bills.</li>
            <li><strong>Monthly chart Difference</strong> = all invoice totals in the month − all bill totals in the month.</li>
          </ul>
          <p>The four calculated cards also show trend badges. These compare the current month with the previous month, not the all-time card total. Outstanding uses non-Paid invoices grouped by invoice activity date; Unpaid bills uses non-Paid bills grouped by bill activity date; Net position subtracts those two monthly values; and Overdue items compares records by the month of their due dates.</p>
          <p>If the current and previous values are equal, the badge says <strong>No change</strong>. If the previous value is zero and the current value differs, the change is shown as 100%. The arrow shows whether the numeric value increased or decreased; it is not an accounting assessment of whether that movement is favourable.</p>
          <p>When signed in, the Dashboard attempts to load invoices, bills, clients, customers and expenses from the user’s Firestore collections. If an individual load fails, the error is written to the browser console and that collection retains its locally loaded fallback. The current Dashboard does not show a visible incomplete-data warning, so refresh or check the underlying page if a figure looks unexpected.</p>
        </section>

        <section>
          <h2>When dashboard values update</h2>
          <p>Saving, editing, deleting or changing the status of a source record can change the next Dashboard calculation. However, the Dashboard loads data once rather than listening for live changes. If it is already open, refresh it; otherwise open it again after saving the source record.</p>
          <ul class="remember-list">
            <li>Saving or editing an invoice can change Outstanding invoices, Net position, Overdue items, both charts, alerts and Recent Activity.</li>
            <li>Saving or editing a bill can change Unpaid bills, Net position, Overdue items, the Income vs Bills chart, alerts and Recent Activity.</li>
            <li>Saving or editing an expense or mileage claim can change Recent Activity only on the current Dashboard.</li>
            <li>Marking an invoice or bill Paid removes it from outstanding or unpaid calculations, overdue checks and related alerts on the next load, but it remains in the Income vs Bills chart.</li>
          </ul>
          <p>Charts are therefore updated from saved records on the next Dashboard load, not immediately in an already open page. Project allocation does not change any Dashboard calculation because the Dashboard has no project filter.</p>
        </section>

        <section>
          <h2>Why dashboard totals may differ from accounting reports</h2>
          <p>The Dashboard reads operational source records. Its monetary cards and charts use invoice and bill <strong>Totals</strong>, which are gross values including VAT where present. Payment status and due dates control several Dashboard figures. Expenses and mileage are omitted from its KPI and chart calculations.</p>
          <p>The <a href="/guides/understanding-the-trial-balance">Trial Balance</a>, <a href="/guides/understanding-the-general-ledger">General Ledger</a>, <a href="/guides/understanding-profit-and-loss">Profit &amp; Loss</a> and <a href="/guides/understanding-the-balance-sheet">Balance Sheet</a> read accounting journals. Profit &amp; Loss uses net Sales Revenue and expense account postings, separates VAT into balance-sheet accounts, and includes posted bills, expenses and mileage for the selected period. The Balance Sheet shows receivables, payables, VAT accounts and current-year result from those journals.</p>
          <p>Current payment-status actions do not post Bank entries or clear the journal balances. This creates another important difference: marking an invoice Paid removes it from the Dashboard’s Outstanding invoices figure, but the existing sales journal still debits Trade Receivables. Similarly, marking a bill Paid removes it from Unpaid bills while its journal still credits Trade Payables. Read <a href="/guides/what-is-double-entry-bookkeeping">What is double-entry bookkeeping?</a> for the exact current postings.</p>
          <p>A saved operational record can also remain on the Dashboard if its ledger posting failed, while it is absent from accounting reports. Conversely, current delete workflows can remove a source record from the Dashboard without reversing its existing journal. Always investigate differences at source-record and journal level.</p>
        </section>

        <section>
          <h2>Worked examples</h2>
          <h3>Operational overview with invoices and bills</h3>
          <p>A design business has three invoices: £120 Unpaid and not yet due, £240 Paid, and £60 Unpaid and overdue. It also has a £90 Unpaid bill due in five days, a £30 Paid bill and a £50 Unpaid overdue bill.</p>
          <ul class="remember-list">
            <li>Outstanding invoices: £120 + £60 = <strong>£180</strong>.</li>
            <li>Unpaid bills: £90 + £50 = <strong>£140</strong>.</li>
            <li>Net position: £180 − £140 = <strong>£40</strong>.</li>
            <li>Overdue items: one overdue invoice + one overdue bill = <strong>2</strong>.</li>
            <li>Overdue invoice reminder value: <strong>£60</strong>.</li>
            <li>Bills needing attention: £90 due soon + £50 overdue = <strong>£140</strong>.</li>
          </ul>
          <p>If all six records have transaction dates in the same month, the Income vs Bills chart shows Invoices of £420, Bills of £170 and Difference of £250. Paid records remain in this chart. A £36 expense and a £22 mileage claim do not change those figures, although either may appear in Recent Activity.</p>

          <h3>Gross Difference versus accounting profit</h3>
          <p>A VAT-registered consultant raises one £120 invoice made up of £100 net plus £20 VAT and enters one £60 supplier bill made up of £50 net plus £10 VAT. The chart Difference is £120 − £60 = <strong>£60</strong> because it uses gross totals. Ignoring other entries, Profit &amp; Loss uses £100 Sales Revenue less £50 expense, giving <strong>£50</strong>. The £10 difference comes from the separate VAT postings, not an error in either calculation.</p>

          <h3>Marking an invoice Paid</h3>
          <p>An overdue £300 invoice is marked Paid. After the Dashboard is refreshed, Outstanding invoices falls by £300, Net position falls by £300, Overdue items falls by one, the chase reminder no longer includes it and the ageing chart excludes it. The Income vs Bills chart is unchanged because it includes invoices of every status. The current accounting journal is also unchanged because the status action does not post a receipt to Bank.</p>
        </section>

        <section>
          <h2>Common mistakes and misunderstandings</h2>
          <ul class="remember-list">
            <li><strong>Treating Net position as cash or profit.</strong> It is gross non-Paid invoice totals minus gross non-Paid bill totals.</li>
            <li><strong>Reading Overdue items as overdue invoices only.</strong> The card combines invoice and bill counts.</li>
            <li><strong>Expecting separate Paid invoices, Expenses this month or Mileage this month KPIs.</strong> The current Dashboard does not display them.</li>
            <li><strong>Calling chart Difference profit.</strong> It includes VAT, includes every payment status and omits expenses and mileage.</li>
            <li><strong>Expecting a Paid invoice or bill to disappear from the monthly chart.</strong> Status does not filter that chart.</li>
            <li><strong>Assuming due today means overdue.</strong> Overdue checks require the due date to be earlier than today.</li>
            <li><strong>Expecting charts to change live in an open tab.</strong> Reopen or refresh the Dashboard after saving or editing records.</li>
            <li><strong>Assuming Recent Activity is a full history.</strong> It contains at most five current records and is not an audit log.</li>
            <li><strong>Looking for separate mileage activity.</strong> Mileage records are currently labelled Expense in Recent Activity.</li>
            <li><strong>Comparing gross Dashboard totals directly with net Profit &amp; Loss figures.</strong> The data sources, VAT treatment and included transaction types differ.</li>
            <li><strong>Ignoring possible load gaps.</strong> Collection failures are logged to the console without a visible incomplete-data warning.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>The current Simple Books Dashboard provides four calculated KPIs: gross Outstanding invoices, gross Unpaid bills, their Net position and a combined count of Overdue items. Its Income vs Bills chart compares all gross invoice and bill totals by month, while Outstanding Receivables Ageing groups supported outstanding invoice values by due-date age.</p>
          <p>Use Next Actions for overdue invoices and bills due or overdue, and Recent Activity for the latest five invoice, bill, client/customer and expense/mileage records. Refresh the page after changing source records. For accounting balances and performance, use the journal-based reports and investigate any difference rather than treating Dashboard Difference or Net position as profit.</p>
        </section>`,
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
        </section>`,
  "using-ai-invoice-scanning": `<section>
          <h2>Introduction</h2>
          <p>AI invoice scanning in Simple Books reads a supplier bill, invoice, receipt or expense document and prepares selected details for you to review. It can reduce retyping, but it does not decide whether an entry is correct, allowable or suitable for a particular accounting treatment.</p>
          <p>This guide covers the current <strong>Scan Bill</strong> and <strong>Scan Receipt</strong> workflows for UK freelancers, sole traders and small businesses. It explains exactly what the software displays and can add to each form. It is product guidance, not legal, tax or accounting advice.</p>
        </section>

        <section>
          <h2>What AI invoice scanning does</h2>
          <p>Document scanning is available on the <strong>Bills</strong> page and in the ordinary <strong>Expense</strong> workflow on the Expenses page. It is not available for invoices you send to customers, Mileage claims or other records.</p>
          <p>Both pages send one selected document to the same protected scanning service. The service checks the file, reads it and returns a structured set of possible accounting details. Simple Books then shows every returned field under <strong>Extracted details</strong>. Nothing is added to the form until you select <strong>Use these details</strong>, and scanning by itself does not create or save a bill or expense.</p>
          <p>The two workflows use different contexts:</p>
          <ul class="remember-list">
            <li><strong>Scan Bill</strong> is intended for a supplier invoice or bill and applies bill-related fields.</li>
            <li><strong>Scan Receipt</strong> is intended for a receipt or other expense document and applies expense-related fields. It switches the shared Expenses form to <strong>Expense</strong>, not Mileage.</li>
          </ul>
        </section>

        <section>
          <h2>Supported file types and size limits</h2>
          <p>Both scanners accept one file in any of these formats:</p>
          <ul class="remember-list">
            <li>JPG or JPEG image</li>
            <li>PNG image</li>
            <li>WEBP image</li>
            <li>PDF document</li>
          </ul>
          <p>The maximum size is 10 MB, calculated as 10 × 1,024 × 1,024 bytes. The page rejects a larger file before scanning. The server checks the declared type, filename extension, file size and actual file signature, so renaming an unsupported file to “.pdf” or “.jpg” does not make it valid.</p>
        </section>

        <section>
          <h2>Open AI invoice scanning</h2>
          <p>You must be signed in to scan a document.</p>
          <ol class="remember-list">
            <li>For a supplier bill, open <strong>Bills</strong> and select <strong>Scan Bill</strong>. The dialog is headed <strong>Scan a supplier bill</strong>.</li>
            <li>For a purchase already treated as an expense, open <strong>Expenses</strong> and select <strong>Scan Receipt</strong>. The dialog is headed <strong>Scan a receipt</strong>.</li>
          </ol>
          <p>The bill dialog asks for a supplier invoice or bill. The expense dialog asks for a receipt or expense document. If you are unsure whether to use a bill or an expense, see <a href="/guides/how-to-record-a-bill">how to record a bill</a> and <a href="/guides/how-to-record-a-business-expense">how to record a business expense</a>.</p>
        </section>

        <section>
          <h2>Upload a document</h2>
          <ol class="remember-list">
            <li>Select <strong>Choose file</strong>.</li>
            <li>Choose one supported file from your device.</li>
            <li>Check the displayed filename, format and size. An image is shown as a preview; a PDF is represented by a PDF panel with its filename.</li>
            <li>If necessary, select <strong>Choose another file</strong>.</li>
            <li>Select <strong>Scan bill</strong> or <strong>Scan receipt</strong> to start the scan.</li>
          </ol>
          <p>While the request is running, Simple Books shows <strong>Reading document...</strong> and disables the scan and file-change controls. Selecting or previewing the file is not the scan itself; the document is sent for extraction only after you select the relevant scan button.</p>
          <p>A clear, upright image with the complete document in frame is more likely to produce useful results. Avoid blur, heavy shadows, glare, cropped totals and text that is too small to read.</p>
          <p>Errors appear inside the scanner. Simple Books identifies unsupported or oversized files before scanning and the server rejects files whose contents, extension, declared type and size do not agree. It also reports documents that do not appear to be a supported bill, invoice or receipt, scans with no usable details, unreadable results, sign-in problems and timeouts. Temporary service failures ask you to try again; the fallback message advises checking your connection and retrying.</p>
        </section>

        <section>
          <h2>How extracted information is reviewed</h2>
          <p>After a successful scan, the dialog displays <strong>Extracted details</strong> as a labelled list:</p>
          <ul class="remember-list">
            <li><strong>Document Type</strong></li>
            <li><strong>Supplier</strong></li>
            <li><strong>Merchant</strong></li>
            <li><strong>Invoice Number</strong></li>
            <li><strong>Invoice Date</strong></li>
            <li><strong>Due Date</strong></li>
            <li><strong>Currency</strong></li>
            <li><strong>Net</strong></li>
            <li><strong>VAT</strong></li>
            <li><strong>Total</strong></li>
            <li><strong>Description</strong></li>
            <li><strong>Category Suggestion</strong></li>
            <li><strong>Confidence</strong></li>
          </ul>
          <p>Dates are displayed in a readable UK format, monetary values use the extracted three-letter currency when valid and confidence is shown as a percentage. A missing or unreadable value appears as <strong>Not found</strong>. The confidence percentage is for review only: the current page does not apply a minimum confidence threshold before enabling <strong>Use these details</strong>.</p>
        </section>

        <section>
          <h2>Using the extracted details</h2>
          <p>Select <strong>Use these details</strong> only after looking through the results. Simple Books closes the scanner, moves back to the form, highlights the fields it changed and shows a message asking you to check them. The highlight clears after a short period or when you edit the field.</p>
          <p>Values that are missing, empty, negative where an amount must be non-negative, or not in a valid date format are not added. The page shows warnings for invalid extracted amounts or dates, an unmatched VAT rate, an unmatched expense category, or a total that differs from net plus VAT by more than two pence.</p>
          <p>If no extracted values can safely be added, the dialog remains open and reports either <strong>No extracted values could be safely added to the bill form.</strong> or <strong>No extracted values could be safely added to the expense form.</strong></p>
        </section>

        <section>
          <h2>What information AI can populate</h2>
          <h3>Scan Bill</h3>
          <p>The Bills workflow can add:</p>
          <ul class="remember-list">
            <li><strong>Supplier</strong> from the extracted Supplier value.</li>
            <li><strong>Bill number</strong> from Invoice Number.</li>
            <li><strong>Bill date</strong> from Invoice Date.</li>
            <li><strong>Due date</strong> from Due Date.</li>
            <li><strong>Net amount</strong> from Net.</li>
            <li><strong>VAT rate</strong> when the ratio of extracted VAT to net closely matches one of the form’s available rates.</li>
            <li><strong>Notes</strong> from Description.</li>
          </ul>
          <p>Scan Bill does not use Merchant as a fallback for Supplier. It does not populate the bill’s category, project or status. Category Suggestion is displayed in the results but is not applied to a bill.</p>

          <h3>Scan Receipt</h3>
          <p>The Expenses workflow can add:</p>
          <ul class="remember-list">
            <li><strong>Merchant / Supplier</strong> from Merchant, or from Supplier when Merchant is empty.</li>
            <li><strong>Date</strong> from Invoice Date.</li>
            <li><strong>Category</strong> when Category Suggestion exactly matches an available category or one of the current safe aliases, such as stationery to Office or software subscription to Software.</li>
            <li><strong>Net amount</strong> from Net.</li>
            <li><strong>VAT rate</strong> when extracted VAT divided by net closely matches an available rate.</li>
            <li><strong>Notes</strong> from Description.</li>
          </ul>
          <p>Scan Receipt does not populate the expense’s <strong>Description</strong> field, project or status. It does not apply Invoice Number or Due Date to an expense.</p>

          <h3>Displayed but not directly populated</h3>
          <p>In both workflows, Currency, Total, Document Type and Confidence are displayed for review but are not copied into form fields. The extracted total is used only for a consistency warning when net and VAT are also available. Form totals are calculated from the net amount and selected VAT rate rather than copied from the extracted Total.</p>
        </section>

        <section>
          <h2>Manual review before saving</h2>
          <p>AI extraction is a draft. Before saving, compare every populated field with the original document and check:</p>
          <ul class="remember-list">
            <li>The correct supplier or merchant has been identified.</li>
            <li>The invoice, bill, expense and due dates are correct for the chosen workflow.</li>
            <li>The net amount, VAT rate, VAT amount and gross total match the document.</li>
            <li>The currency shown in the scan is consistent with the amounts you intend to record.</li>
            <li>The category and accounting treatment are appropriate for the purchase.</li>
            <li>The description, notes, project and business purpose are complete.</li>
            <li>The bill number, payment status and due date are correct where relevant.</li>
          </ul>
          <p>You remain responsible for checking the supplier, dates, VAT, totals, category and accounting treatment. Simple Books does not determine whether VAT is recoverable, whether a cost is allowable or whether a document belongs in Bills rather than Expenses.</p>
          <p>When everything is correct, select <strong>Save bill</strong> or <strong>Save expense</strong>. Scanning and selecting <strong>Use these details</strong> do not save the record.</p>
        </section>

        <section>
          <h2>What happens to the scanned document</h2>
          <p>For a new bill or expense, selecting <strong>Use these details</strong> makes the scanned file a pending attachment when no manual attachment is already selected. The form reports that it will be attached when you save, and the Attachment area provides <strong>Remove scanned attachment</strong>.</p>
          <p>The pending document is uploaded during <strong>Save bill</strong> or <strong>Save expense</strong>. The record is saved first, then Simple Books uploads the scanned file and updates the record with its attachment. If that later upload fails, the record remains saved and a warning tells you to edit the record and attach the file manually. See <a href="/guides/uploading-receipts">uploading receipts in Simple Books</a> for the wider attachment behaviour.</p>
          <p>If a manual attachment is already selected when you use scanned details, the form fields can still be populated, but the scanned file does not become the attachment. Simple Books keeps the manual file and warns: <strong>A manual attachment is already selected. Remove it first to use the scanned document as the attachment.</strong></p>
          <p>If a scanned file is pending and you later choose a manual attachment, the manual file replaces the pending scan. Switching the Expenses form to Mileage also removes a pending scanned receipt.</p>
        </section>

        <section>
          <h2>Limitations of the current implementation</h2>
          <ul class="remember-list">
            <li>Scanning supports Bills and ordinary Expenses only; it does not populate Mileage or sales invoices.</li>
            <li>Only one document can be scanned at a time. There is no batch or multi-page-record workflow beyond pages already contained within one PDF.</li>
            <li>You cannot apply scanned details while editing an existing bill or expense. The dialog reports that you must finish or cancel editing first.</li>
            <li>Starting an edit removes any separate scanned document that was waiting to be applied or uploaded.</li>
            <li>The confidence score is displayed but does not automatically prevent low-confidence results from being applied.</li>
            <li>Not every extracted result maps to a form field, and Bills and Expenses deliberately use different subsets.</li>
            <li>Category matching is available only for Expenses and only for exact options or a small set of safe aliases.</li>
            <li>VAT is applied only when the VAT-to-net ratio closely matches an available form rate.</li>
            <li>Scanning does not save the record, record payment, choose a project or status, or make bookkeeping decisions.</li>
          </ul>
          <p>The current service records monthly invoice-scanning usage, but enforcement of a monthly scanning allowance is disabled. The interface does not promise a particular result: extraction depends on the document being readable and containing usable information.</p>
        </section>

        <section>
          <h2>Worked examples</h2>
          <h3>PDF supplier bill</h3>
          <p>A VAT-registered design studio receives a PDF bill from North Street Print Ltd for £240 net plus £48 VAT, due in 30 days. The user opens Bills, selects <strong>Scan Bill</strong>, chooses the PDF and selects <strong>Scan bill</strong>. The results show the supplier, invoice number, invoice and due dates, GBP currency, net, VAT, total and description.</p>
          <p>After selecting <strong>Use these details</strong>, the studio checks the populated supplier, bill number, dates, net amount, VAT rate and notes. It chooses the correct bill category, project and status manually, verifies the £288 total and selects <strong>Save bill</strong>. Because no manual attachment was selected, the PDF is uploaded as the saved bill attachment.</p>

          <h3>Photographed expense receipt</h3>
          <p>A self-employed consultant photographs a clear JPG receipt for £24 of stationery, including £4 VAT. They open Expenses, select <strong>Scan Receipt</strong>, choose the photograph and select <strong>Scan receipt</strong>. The scanner finds the merchant, date, net, VAT, total and suggests “stationery”.</p>
          <p>When the user selects <strong>Use these details</strong>, Simple Books maps stationery to <strong>Office</strong>, adds the merchant and date, puts extracted descriptive text in Notes, enters £20 net and matches the VAT rate. The consultant checks the original receipt, completes the Description, project and status, confirms the £24 gross amount and selects <strong>Save expense</strong>.</p>
        </section>

        <section>
          <h2>Common scanning mistakes</h2>
          <ul class="remember-list">
            <li><strong>Trusting AI without checking.</strong> Compare every populated value with the original document.</li>
            <li><strong>Uploading a poor-quality image.</strong> Retake blurred, dark, reflective, distant or cropped photographs before scanning.</li>
            <li><strong>Using an unsupported file type.</strong> Upload a genuine JPG, JPEG, PNG, WEBP or PDF no larger than 10 MB.</li>
            <li><strong>Choosing the wrong workflow.</strong> Use Scan Bill for supplier bills you owe and Scan Receipt for ordinary business expenses.</li>
            <li><strong>Forgetting to select Use these details.</strong> A completed result remains in the dialog until you apply it or close the scanner.</li>
            <li><strong>Forgetting to save after scanning.</strong> Applied values and a pending document are not a saved record.</li>
            <li><strong>Expecting the extracted total to be copied into the form.</strong> Simple Books recalculates form totals from net and VAT.</li>
            <li><strong>Expecting every result to populate a field.</strong> Currency, confidence, document type and total are review information; some other mappings depend on the workflow.</li>
            <li><strong>Trying to apply a scan while editing.</strong> Finish or cancel the edit and start from a new form.</li>
            <li><strong>Expecting two attachments.</strong> A manually selected attachment takes priority over the scanned document.</li>
            <li><strong>Expecting AI to replace bookkeeping judgement.</strong> Decide the category, VAT treatment and accounting treatment yourself or seek appropriate professional advice.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>To use AI invoice scanning in Simple Books, open Bills and select <strong>Scan Bill</strong>, or open Expenses and select <strong>Scan Receipt</strong>. Choose one JPG, JPEG, PNG, WEBP or PDF up to 10 MB, select the scan button and review every item under <strong>Extracted details</strong>. Select <strong>Use these details</strong> to add supported values to a new form.</p>
          <p>Check the supplier or merchant, dates, net, VAT, total, category and accounting treatment against the original document, complete the fields AI does not populate, then save the record. If no manual attachment is selected, the scanned document waits as a pending attachment and uploads when the new bill or expense is saved.</p>
        </section>`,
  "tracking-project-profitability": `<section>
          <h2>Introduction</h2>
          <p>Tracking project profitability in Simple Books brings together the invoices, supplier bills, business expenses and mileage claims allocated to a saved project. The Projects page then compares invoiced income with recorded project costs to show gross profit, margin and budget usage.</p>
          <p>This guide explains the current project calculations and screens exactly as implemented. The figures are operational project summaries based on saved transaction totals; they are not a substitute for your Profit &amp; Loss report or professional accounting advice.</p>
        </section>

        <section>
          <h2>What project profitability means in Simple Books</h2>
          <p>Simple Books uses four values for each current project:</p>
          <ul class="remember-list">
            <li><strong>Total invoiced:</strong> the full <strong>Total</strong> of every invoice whose Project ID matches the project.</li>
            <li><strong>Total costs:</strong> allocated bill totals, expense gross amounts and mileage claim amounts added together.</li>
            <li><strong>Gross profit:</strong> Total invoiced minus Total costs.</li>
            <li><strong>Profit margin:</strong> Gross profit divided by Total invoiced, multiplied by 100.</li>
          </ul>
          <p>If a project has no invoiced income, its margin is shown as 0.0%, even when recorded costs make gross profit negative. Negative gross profit and negative budget remaining are highlighted.</p>
          <p>These calculations use transaction values including VAT where the saved total or gross value includes VAT. They are therefore different from accounting Profit &amp; Loss calculations, which normally use net income and net costs posted to ledger accounts. Simple Books labels the project result <strong>Gross profit</strong>, but it should be read as the current project-page calculation rather than a statutory accounting measure.</p>
        </section>

        <section>
          <h2>Create and open a project</h2>
          <p>Open <strong>Projects</strong> from the app navigation. The page begins with counts for <strong>Total projects</strong>, <strong>Active projects</strong>, <strong>Completed projects</strong> and <strong>On Hold projects</strong>, plus <strong>Total project budgets</strong>.</p>
          <p>Select <strong>New project</strong> and complete the available fields:</p>
          <ul class="remember-list">
            <li><strong>Project name</strong>, which is required.</li>
            <li><strong>Project reference</strong>; Simple Books suggests the next PRJ-number when creating a project.</li>
            <li><strong>Customer / client</strong>, or <strong>No customer / client</strong>.</li>
            <li><strong>Description</strong>.</li>
            <li><strong>Status:</strong> Active, Completed or On Hold.</li>
            <li><strong>Budget (£)</strong>, which must be zero or more.</li>
            <li><strong>Start date</strong> and <strong>End date</strong>; the end date cannot be before the start date.</li>
          </ul>
          <p>Select <strong>Save project</strong>. The project becomes available in transaction Project selectors. From the <strong>Project list</strong>, select its name or <strong>View</strong> to open the individual Project Details page.</p>
        </section>

        <section>
          <h2>Allocate invoice income to a project</h2>
          <p>When creating an invoice, use the <strong>Project</strong> selector and choose the saved project instead of <strong>No project</strong>. The selected Project ID, name and reference are stored with the invoice when you select <strong>Generate Invoice</strong>. See <a href="/guides/how-to-create-an-invoice">how to create an invoice</a>.</p>
          <p>The project calculation uses the invoice’s full <strong>Total</strong>. Paid, Unpaid and overdue invoices all contribute to <strong>Total invoiced</strong>; status does not determine whether revenue is included. The individual Project Details page separately divides that same invoice total into <strong>Paid invoices</strong>, <strong>Outstanding invoices</strong> and <strong>Overdue invoices</strong>.</p>
          <p>Invoice dates do not restrict the project total. Every currently saved invoice with the matching Project ID is included, regardless of the project’s start date, end date or status.</p>
        </section>

        <section>
          <h2>Allocate bills to a project</h2>
          <p>On the Bills page, choose the project from <strong>Project</strong> before selecting <strong>Save bill</strong>. The bill’s Project ID, name and reference are saved with it. See <a href="/guides/how-to-record-a-bill">how to record a bill</a>.</p>
          <p>Project costs use the bill’s full <strong>Total</strong>, including VAT where VAT forms part of that total. Paid, Unpaid and overdue bills all count towards project costs. Project Details shows a separate Paid and Unpaid bill breakdown, but changing the bill’s payment status does not alter <strong>Total costs</strong>, gross profit, margin or budget usage.</p>
        </section>

        <section>
          <h2>Allocate expenses and mileage</h2>
          <p>Expenses and Mileage share the Expenses page and the same saved collection, but Project views separate them by record type.</p>
          <ul class="remember-list">
            <li><strong>Expense:</strong> choose a project in the Expense form. Project costs use the expense’s saved <strong>Gross amount</strong>.</li>
            <li><strong>Mileage:</strong> switch to Mileage, choose a project and save the claim. Project costs use the calculated mileage <strong>Amount</strong>, falling back to its gross value for older compatible records.</li>
          </ul>
          <p>Draft, Submitted, Approved and Paid expenses or mileage claims are all included. Status is displayed in the recent transaction tables but does not change the project calculation. For the underlying workflows, see <a href="/guides/how-to-record-a-business-expense">how to record a business expense</a> and <a href="/guides/how-to-claim-business-mileage">how to claim business mileage</a>.</p>
        </section>

        <section>
          <h2>How project income, costs and margin are calculated</h2>
          <p>For one project, Simple Books applies these formulas:</p>
          <ul class="remember-list">
            <li><strong>Invoiced income</strong> = sum of allocated invoice totals.</li>
            <li><strong>Bill costs</strong> = sum of allocated bill totals.</li>
            <li><strong>Expense costs</strong> = sum of allocated expense gross amounts.</li>
            <li><strong>Mileage costs</strong> = sum of allocated mileage amounts.</li>
            <li><strong>Total costs</strong> = Bills + Expenses + Mileage.</li>
            <li><strong>Gross profit</strong> = Total invoiced − Total costs.</li>
            <li><strong>Profit margin</strong> = Gross profit ÷ Total invoiced × 100, or 0% when Total invoiced is zero.</li>
          </ul>
          <p>Transactions are matched by their saved Project ID, not by a similar project name or reference. A transaction left as <strong>No project</strong> does not appear in project totals. Changing a project’s name does not break ID-based matching, although older transaction rows may retain the project name and reference that were stored when they were last saved.</p>
        </section>

        <section>
          <h2>Use the Projects portfolio overview</h2>
          <p>The <strong>Portfolio overview</strong> is the project-specific dashboard. It calculates across all current saved projects and transactions whose Project IDs match them.</p>
          <ul class="remember-list">
            <li><strong>Total invoiced:</strong> allocated invoice totals and the number of allocated invoices.</li>
            <li><strong>Total costs:</strong> combined Bills, Expenses and Mileage, with each type shown separately.</li>
            <li><strong>Overall gross profit:</strong> portfolio invoiced total minus portfolio costs.</li>
            <li><strong>Overall margin:</strong> portfolio gross profit divided by portfolio invoiced total.</li>
            <li><strong>Budget usage:</strong> total costs compared with the sum of all current project budgets.</li>
          </ul>
          <p>The combined Budget usage includes costs from current projects even when an individual project has no budget, while the budget side is only the sum of budgets greater than or equal to zero. Read the individual project detail when you need to understand which project is driving the portfolio result.</p>
          <p><strong>Highest value projects</strong> ranks up to five projects by invoiced total. <strong>Most profitable projects</strong> ranks up to five by gross profit and shows the calculated margin. These lists include current projects regardless of Active, Completed or On Hold status.</p>
        </section>

        <section>
          <h2>Understand project charts and attention flags</h2>
          <p>The Projects page provides three portfolio charts:</p>
          <ul class="remember-list">
            <li><strong>Projects by status:</strong> a doughnut chart of Active, Completed and On Hold counts.</li>
            <li><strong>Budget utilisation:</strong> a bar chart comparing the total of current project budgets with all recorded costs allocated to current projects.</li>
            <li><strong>Top five project revenue:</strong> a horizontal bar chart using invoice totals for the five highest-invoiced projects.</li>
          </ul>
          <p>The <strong>Needs attention</strong> section flags a project when it has no budget, has used 100% or more of its budget, is Active with an end date that has passed, or has recorded costs but no allocated invoices. These are fixed software checks, not accounting conclusions.</p>
          <p>At exactly 100% budget usage, Needs attention says <strong>Budget fully used</strong>; above 100% it shows <strong>Over budget</strong> with the percentage.</p>
        </section>

        <section>
          <h2>Review an individual project</h2>
          <p>The Project Details page loads the chosen project and queries invoices, bills and the combined Expenses/Mileage records whose Project ID exactly matches it. It shows:</p>
          <ul class="remember-list">
            <li>Project reference, customer, status, dates, budget and description.</li>
            <li><strong>Total invoiced</strong>, invoice count, <strong>Total costs</strong>, <strong>Gross profit</strong>, <strong>Profit margin</strong> and <strong>Budget remaining</strong>.</li>
            <li>Paid, Outstanding and Overdue invoice totals.</li>
            <li>Bill, Expense and Mileage cost totals.</li>
            <li>Income, cost and budget breakdowns.</li>
            <li>The most recent five allocated Invoices, Bills, Expenses and Mileage claims in separate tables.</li>
          </ul>
          <p>If one of the invoice, bill or expense/mileage queries fails, the page still renders available data and warns that some financial records could not be loaded and the figures may be incomplete.</p>
        </section>

        <section>
          <h2>Understand budgets and project progress</h2>
          <p>A project budget is compared with the same gross project costs used in profitability:</p>
          <ul class="remember-list">
            <li><strong>Budget remaining</strong> = Project budget − Total costs.</li>
            <li><strong>Budget used</strong> = Total costs ÷ Project budget × 100.</li>
            <li>Below 75% is labelled <strong>Within budget</strong>.</li>
            <li>From 75% to below 100% is labelled <strong>Approaching budget</strong>.</li>
            <li>At 100% or more is labelled <strong>Over budget</strong> on Project Details.</li>
          </ul>
          <p>If the budget is zero or blank, the page shows <strong>No budget set</strong> and does not display a budget progress bar. Budget is not a profitability target and does not limit saving transactions.</p>
          <p><strong>Project progress</strong> is date-based. When both dates exist, Simple Books calculates inclusive project days, elapsed days, remaining days and percentage of duration elapsed. This is informational: passing the end date does not change the project’s status automatically.</p>
        </section>

        <section>
          <h2>How transaction changes affect profitability</h2>
          <p>Project totals are recalculated from the currently saved records whenever the Projects or Project Details page loads. Changes therefore have these effects:</p>
          <ul class="remember-list">
            <li><strong>Edit an amount:</strong> updating an allocated invoice total changes project income; updating a bill total, expense gross amount, mileage distance or mileage rate changes project costs.</li>
            <li><strong>Change the Project selection:</strong> the transaction stops contributing to the old Project ID and contributes to the new one after it is saved.</li>
            <li><strong>Select No project:</strong> the transaction is removed from project calculations but remains a transaction in its own module.</li>
            <li><strong>Delete a transaction:</strong> after the record is deleted, it no longer contributes when project data is reloaded.</li>
            <li><strong>Change payment or claim status:</strong> Paid, Unpaid, Draft, Submitted and Approved labels alter status breakdowns where shown, but not total income, total costs, gross profit, margin or budget usage.</li>
            <li><strong>Edit the project budget:</strong> budget remaining, percentage used and health labels change, but income, costs and gross profit do not.</li>
            <li><strong>Edit project status or dates:</strong> status counts, progress and attention flags can change; the financial calculation does not.</li>
          </ul>
          <p>Deleting a project deletes the project record only. The current delete workflow does not reassign or delete invoices, bills, expenses or mileage records that stored its Project ID. Because the project no longer exists, those records no longer match a current project in Portfolio overview and its Project Details page is unavailable.</p>
        </section>

        <section>
          <h2>How the main Dashboard relates to projects</h2>
          <p>The main Dashboard has no project filter, project profit card or project profitability chart. Allocated transactions still appear in its general business figures because they remain ordinary invoices, bills, expenses and mileage claims, but the Dashboard does not separate them by Project ID.</p>
          <p>In particular, the Dashboard’s <strong>Income vs Bills</strong> chart groups all invoice totals and bill totals by month and shows their difference. It excludes expenses and mileage and is not filtered to a project, so its <strong>Difference</strong> line is not the same as project gross profit. Recent activity can include allocated transactions, but it does not show their project allocation.</p>
          <p>For project-specific figures and charts, use <strong>Portfolio overview</strong> and the individual Project Details page. For ledger-based business performance, use <a href="/guides/understanding-profit-and-loss">Understanding Profit &amp; Loss</a>.</p>
        </section>

        <section>
          <h2>Worked examples</h2>
          <h3>Website project with income and costs</h3>
          <p>A freelance designer creates “Harbour Website” with a £4,000 budget. They allocate an invoice with a £3,600 total, a supplier bill totalling £720, an expense with a £120 gross amount and a £44 mileage claim.</p>
          <ul class="remember-list">
            <li>Total invoiced: £3,600</li>
            <li>Total costs: £720 + £120 + £44 = £884</li>
            <li>Gross profit: £3,600 − £884 = £2,716</li>
            <li>Profit margin: £2,716 ÷ £3,600 × 100 = 75.4%</li>
            <li>Budget used: £884 ÷ £4,000 × 100 = 22.1%</li>
            <li>Budget remaining: £4,000 − £884 = £3,116</li>
          </ul>
          <p>Marking the invoice Paid changes Paid and Outstanding invoice totals but leaves Total invoiced and the 75.4% project margin unchanged.</p>

          <h3>Reallocating a cost</h3>
          <p>A £240 gross software expense was accidentally allocated to “Harbour Website” instead of “Retail Campaign”. The user edits the expense, changes <strong>Project</strong> and selects <strong>Update expense</strong>. On reload, Harbour Website costs fall by £240 and its gross profit rises by £240. Retail Campaign costs rise by £240 and its gross profit falls by the same amount.</p>
        </section>

        <section>
          <h2>Common project profitability mistakes</h2>
          <ul class="remember-list">
            <li><strong>Leaving transactions as No project.</strong> They remain valid records but do not contribute to any project totals.</li>
            <li><strong>Expecting only Paid or Approved records to count.</strong> Project calculations include every matching saved record regardless of status.</li>
            <li><strong>Comparing project gross profit directly with Profit &amp; Loss.</strong> Project views use gross transaction totals, while accounting reports use ledger postings and net account values.</li>
            <li><strong>Assuming the Dashboard Difference line is project profit.</strong> It includes all invoices and bills and omits expenses and mileage.</li>
            <li><strong>Recording the same cost as both a bill and an expense.</strong> If both are allocated, project costs are duplicated.</li>
            <li><strong>Using a similar name instead of selecting the project.</strong> Matching uses the saved Project ID.</li>
            <li><strong>Assuming a budget limits costs.</strong> It is a comparison value and does not prevent transactions from being saved.</li>
            <li><strong>Expecting project dates to filter transactions.</strong> Matching records count regardless of transaction date.</li>
            <li><strong>Expecting project status to update automatically.</strong> Date progress is informational; update Active, Completed or On Hold yourself.</li>
            <li><strong>Deleting a project to delete its transactions.</strong> The project is removed, but allocated source records are not reassigned or deleted.</li>
            <li><strong>Ignoring load warnings.</strong> If a collection could not be loaded, displayed portfolio or project figures may be incomplete.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>To track project profitability in Simple Books, create a project and select it when saving relevant invoices, bills, expenses and mileage claims. The project’s full invoice totals become Total invoiced; bill totals, expense gross amounts and mileage amounts become Total costs. Simple Books subtracts costs from invoiced income for gross profit and divides that result by invoiced income for margin.</p>
          <p>Use Portfolio overview for project-wide totals, rankings, charts and attention flags, then open Project Details for one project’s profitability, budget health and recent allocated records. Review the Project selection whenever you create or edit a transaction, and remember that these gross-value operational figures are separate from ledger-based Profit &amp; Loss reporting.</p>
        </section>`,
  "what-is-double-entry-bookkeeping": `<section>
          <h2>Introduction</h2>
          <p>Double-entry bookkeeping records every accounting event in at least two places. The total debits in a journal must equal its total credits, so the accounts remain mathematically connected. For a small business owner, this means a sale can record both the income earned and the amount a customer owes, while a supplier bill can record both the cost incurred and the amount owed to the supplier.</p>
          <p>Simple Books currently creates accounting journals when you save or update invoices, bills, expenses and mileage claims. Its accounting reports then read those journals. This guide explains that implementation in plain English, including what the current workflows do not post. It is general product guidance, not accounting or tax advice.</p>
        </section>

        <section>
          <h2>What double-entry bookkeeping is</h2>
          <p>A <strong>journal</strong> is one balanced accounting entry made up of two or more lines. Each line names an account and puts an amount on either its debit side or its credit side. Every Simple Books journal must have at least two non-zero lines, and the combined debit amount must exactly equal the combined credit amount.</p>
          <p>Double entry does not mean entering the same transaction twice on an operational page. You save one invoice, bill, expense or mileage claim; Simple Books builds the matching journal behind it. One gross transaction can produce three journal lines when VAT needs its own account.</p>
          <p>A balanced journal proves that its debits equal its credits. It does not prove that the date, value, VAT treatment, category, customer, supplier or business purpose is correct.</p>
        </section>

        <section>
          <h2>The accounting equation</h2>
          <p>The accounting equation used by the current Simple Books reports is <strong>Assets = Liabilities + Equity</strong>. The Balance Sheet calculates the asset side and compares it with liabilities plus equity. Income increases the current-year result that the report adds to equity; expenses reduce it.</p>
          <p>An unpaid £120 sales invoice containing £100 net income and £20 VAT illustrates the equation. The journal creates a £120 receivable asset, a £20 VAT liability and £100 of income. That income becomes £100 of current-year profit within the Balance Sheet equity total, so £120 of assets equals £20 of liabilities plus £100 of equity.</p>
        </section>

        <section>
          <h2>Assets, liabilities and equity explained</h2>
          <ul class="remember-list">
            <li><strong>Assets</strong> are resources or amounts due to the business. The current chart includes Bank, Trade Receivables and VAT Input.</li>
            <li><strong>Liabilities</strong> are amounts the business owes. The current chart includes Trade Payables, VAT Output and Employee Reimbursements Payable.</li>
            <li><strong>Equity</strong> is the residual interest after liabilities are deducted from assets. The chart includes Owner’s Equity, and the Balance Sheet adds the calculated current-year profit or loss to the displayed equity total.</li>
          </ul>
          <p>Sales Revenue is an Income account, while General Expenses, Travel &amp; Mileage, Utilities, Professional Fees and Software &amp; Subscriptions are Expense accounts. Income and expenses feed the current-year result rather than appearing as asset, liability or equity rows themselves.</p>
          <p>The invoice, bill, expense and mileage journal builders described below do not currently post to Bank or directly to Owner’s Equity.</p>
        </section>

        <section>
          <h2>Debits and credits in simple language</h2>
          <p>Debit and credit mean the left and right sides of an account. They do not mean good and bad, money in and money out, or paid and unpaid. In the chart of accounts currently used by Simple Books:</p>
          <ul class="remember-list">
            <li><strong>Assets</strong> and <strong>expenses</strong> normally increase with a debit and decrease with a credit.</li>
            <li><strong>Liabilities</strong>, <strong>equity</strong> and <strong>income</strong> normally increase with a credit and decrease with a debit.</li>
          </ul>
          <p>For example, debiting Trade Receivables increases the amount shown as due from customers. Crediting Sales Revenue increases income. Crediting Trade Payables increases the amount owed to suppliers.</p>
        </section>

        <section>
          <h2>Why every transaction has two equal entries</h2>
          <p>Every journal must balance because each accounting event affects more than one part of the records. An invoice records both what the customer owes and the income and VAT created by the sale. A supplier bill records both the cost and VAT and the amount owed to the supplier.</p>
          <p>Simple Books requires at least two non-zero journal lines and checks that total debits exactly equal total credits. One line cannot contain both a debit and a credit. Amounts must be non-negative and use no more than two decimal places.</p>
          <p>Equal totals provide mathematical control, but they do not prove that the user selected the right category, VAT treatment, date or source amount.</p>
        </section>

        <section>
          <h2>How Simple Books creates journals</h2>
          <p>When a new supported source record is saved, Simple Books validates its accounting values and writes one journal linked to that record. When the same record is edited and saved, its existing linked journal is replaced using the updated date, amounts and accounting category. The journal is dated from the source transaction: invoice date, bill date, expense date or mileage date.</p>
          <p>Simple Books checks that the journal uses known account codes, has a valid calendar date, contains at least two lines, uses non-negative values with no more than two decimal places, has only a debit or a credit on each line, and balances in total. It also checks source arithmetic such as net plus VAT equalling the total and mileage amount matching miles multiplied by rate where those values are supplied.</p>
          <p>If ledger posting fails after the source record has been saved, the operational page keeps the saved record and shows a warning that its ledger posting could not be completed. The accounting reports read journals rather than rebuilding them from source records, so the transaction may be absent from those reports until the journal is successfully written by retrying the update or support resolves the problem.</p>
        </section>

        <section>
          <h2>How invoices create journal entries</h2>
          <p>Saving a sales invoice debits <strong>1100 Trade Receivables</strong> for the gross total, credits <strong>4000 Sales Revenue</strong> for the net amount and, when VAT is greater than zero, credits <strong>2100 VAT Output</strong> for VAT.</p>
          <p>If the invoice contains active line items, Simple Books creates a separate Sales Revenue credit for each item amount. Those item credits must add up to the invoice net amount. If there are no active items, it creates one Sales Revenue credit for the net amount.</p>
          <p>The journal represents the sale and the amount owed by the customer. Its structure is the same whether the invoice status is Paid or Unpaid. Selecting <strong>Mark Paid</strong> or <strong>Mark Unpaid</strong> changes the operational status only; it does not create a Bank entry or clear Trade Receivables.</p>
        </section>

        <section>
          <h2>How bills create journal entries</h2>
          <p>Saving a supplier bill debits an expense account for its net amount, debits <strong>1200 VAT Input</strong> when VAT is greater than zero, and credits <strong>2000 Trade Payables</strong> for the gross total. This records the cost, recoverable input VAT in the current account model, and the amount owed to the supplier.</p>
          <p>The selected category decides the expense account. Travel or Mileage maps to <strong>5200 Travel &amp; Mileage</strong>; Utilities maps to <strong>5300 Utilities</strong>; Professional Fees, Professional, Accounting or Legal maps to <strong>5400 Professional Fees</strong>; Software or Software/Subscriptions maps to <strong>5500 Software &amp; Subscriptions</strong>. Any other category maps to <strong>5000 General Expenses</strong>.</p>
          <p>Paid and Unpaid bills create the same journal. Marking a bill paid or unpaid changes its status but does not post Bank or clear Trade Payables.</p>
        </section>

        <section>
          <h2>How expenses create journal entries</h2>
          <p>Saving a business expense debits the category-mapped expense account for the net amount, debits <strong>1200 VAT Input</strong> when VAT is greater than zero, and credits <strong>2200 Employee Reimbursements Payable</strong> for the gross amount.</p>
          <p>The expense category uses the same mapping as a supplier bill. For example, Software posts net cost to Software &amp; Subscriptions, Utilities posts to Utilities and an unmatched category posts to General Expenses.</p>
          <p>Draft, Submitted, Approved and Paid expenses use the same journal structure. Selecting <strong>Mark paid</strong> changes the expense status only. It does not post a payment to Bank or clear Employee Reimbursements Payable.</p>
        </section>

        <section>
          <h2>How mileage creates journal entries</h2>
          <p>Saving a mileage claim debits <strong>5200 Travel &amp; Mileage</strong> for the full calculated claim amount and credits <strong>2200 Employee Reimbursements Payable</strong> for the same amount. There is no VAT Input line in the current mileage journal.</p>
          <p>Where miles and rate are both supplied, Simple Books checks that the saved amount equals miles multiplied by the rate. Project selection, vehicle details, route and status add operational context but do not change the accounts used by this journal.</p>
        </section>

        <section>
          <h2>VAT journals</h2>
          <p>For a sales invoice, Simple Books credits <strong>2100 VAT Output</strong> when VAT is greater than zero. Sales Revenue receives only the net amount, while Trade Receivables receives the net amount plus VAT as the gross total owed by the customer.</p>
          <p>For a supplier bill or business expense, Simple Books debits <strong>1200 VAT Input</strong> when VAT is greater than zero. The expense account receives the net amount, while Trade Payables or Employee Reimbursements Payable receives the gross total.</p>
          <p>If VAT is zero, the journal omits the VAT line. Mileage journals never create a VAT Input line. VAT Input is an Asset account and VAT Output is a Liability account in the current chart, so neither appears as an expense or income row in Profit &amp; Loss.</p>
          <p>Simple Books checks that net plus VAT equals the supplied gross total. You remain responsible for entering the correct VAT amount and treatment for the transaction.</p>
        </section>

        <section>
          <h2>Trade Receivables and Trade Payables</h2>
          <p><strong>Trade Receivables</strong> is the Asset account used for the full amount customers owe on sales invoices. Every saved invoice journal debits it for the gross invoice total, whether the operational invoice status is Unpaid or Paid.</p>
          <p><strong>Trade Payables</strong> is the Liability account used for the full amount owed on supplier bills. Every saved bill journal credits it for the gross bill total, whether the operational bill status is Unpaid or Paid.</p>
          <p>Business expenses and mileage claims do not use Trade Payables. Their gross or full claim amount credits Employee Reimbursements Payable instead.</p>
        </section>

        <section>
          <h2>Why marking an invoice or bill as Paid changes operational status only</h2>
          <p>Editing and saving an invoice, bill, expense or mileage claim replaces its linked journal. Changing an amount alters the relevant debit and credit values; changing a supported bill or expense category can move the net debit to a different expense account; changing the source date changes the journal date. Changing a Project allocation does not add a project account or journal line.</p>
          <p>Status actions do not replace the journal or post settlement entries. In the current implementation, marking an invoice or bill Paid does not record movement through Bank and does not reverse the original journal. Marking an expense Paid behaves in the same way. The reports therefore continue to show the original Trade Receivables, Trade Payables or Employee Reimbursements Payable balance.</p>
          <p>The operational <a href="/guides/understanding-the-dashboard">Dashboard</a> does react to invoice and bill status. Marking an invoice Paid removes its gross total from Outstanding invoices; marking a bill Paid removes its gross total from Unpaid bills. The Dashboard reads source records, while the accounting reports read journals, so those operational and accounting figures can then differ.</p>
          <p>Deletion needs particular care. The current invoice, bill and expense/mileage delete workflows remove the source record but do not create a reversal or delete its existing journal. That journal can continue to affect the accounting reports. A reversal builder exists in the ledger engine, but these operational delete workflows do not currently use it.</p>
        </section>

        <section>
          <h2>How the Trial Balance is produced</h2>
          <p>The <a href="/guides/understanding-the-trial-balance">Trial Balance</a> reads the saved journals and totals the debit and credit lines for each active account. For each account, Simple Books calculates debits minus credits: a positive closing balance appears in the Debit column and a negative closing balance appears as a positive amount in the Credit column.</p>
          <p>The report then totals all debit closing balances and all credit closing balances. They should be equal because every underlying journal is balanced. The current Trial Balance does not provide a date filter; it uses all loaded journals.</p>
          <p>Before showing results, the report validates every journal. If a journal is malformed, the page shows an error rather than presenting partial totals. A balanced Trial Balance still cannot tell you whether a valid journal used the correct account, date or tax treatment.</p>
        </section>

        <section>
          <h2>How the General Ledger is produced</h2>
          <p>The <a href="/guides/understanding-the-general-ledger">General Ledger</a> starts from the same journal set and offers accounts that have debit or credit activity. Choose an account to see its entries in chronological order with the journal date, reference, description, debit, credit and running balance.</p>
          <p>The running balance adds debits and subtracts credits. Optional <strong>Date From</strong> and <strong>Date To</strong> filters are inclusive. They limit the selected account’s displayed entries but do not change the saved journals. The page validates the loaded journal set and rejects invalid date ranges or malformed journals instead of silently showing misleading activity.</p>
          <p>Use the General Ledger to trace a report balance back to its source postings. For example, the Trade Receivables ledger shows invoice debits created by the current invoice journal workflow; marking an invoice Paid does not add a clearing credit.</p>
        </section>

        <section>
          <h2>How Profit &amp; Loss is produced</h2>
          <p>The <a href="/guides/understanding-profit-and-loss">Profit &amp; Loss report</a> filters journals by an optional inclusive date range, builds account totals and includes only Income and Expense accounts. Income is calculated as credits minus debits. Expenses are calculated as debits minus credits. Total income minus total expenses is the net profit or loss.</p>
          <p>Sales invoice net values feed Sales Revenue. The net portions of bills and expenses feed their mapped expense accounts, and the full mileage claim feeds Travel &amp; Mileage. Trade Receivables, Trade Payables, Employee Reimbursements Payable, VAT Input and VAT Output do not appear as Profit &amp; Loss rows.</p>
          <p>Simple Books validates all loaded journals before applying the selected period, so an invalid journal outside the chosen dates cannot be hidden to produce partial figures.</p>
        </section>

        <section>
          <h2>How the Balance Sheet is produced</h2>
          <p>The <a href="/guides/understanding-the-balance-sheet">Balance Sheet</a> includes journals up to an optional inclusive <strong>As at</strong> date. Assets use debit-oriented balances; liabilities and equity use credit-oriented balances. Income and expense accounts are not listed directly. Instead, Simple Books calculates the Profit &amp; Loss result for the same journal set and adds it to the displayed equity total as <strong>Current Year Profit</strong> or <strong>Current Year Loss</strong>.</p>
          <p>The report compares total assets with total liabilities plus total equity and shows whether they balance. Invoice journals can increase Trade Receivables and VAT Output; bills can increase VAT Input and Trade Payables; expenses and mileage can increase Employee Reimbursements Payable. Because current status actions do not post settlement entries, these balances are not cleared merely by marking a record Paid.</p>
          <p>As with Profit &amp; Loss, all loaded journals are validated before date filtering. An invalid journal produces an error instead of partial Balance Sheet totals.</p>
        </section>

        <section>
          <h2>Operational pages and accounting reports</h2>
          <p><strong>Invoices, Bills and Expenses</strong> are operational pages. They are where you create and manage customer invoices, supplier bills, expenses and mileage claims, supporting documents, due dates, projects and workflow statuses. <strong>Projects</strong> is also operational: it matches records by Project ID and calculates project totals from saved transaction values, including gross amounts where implemented.</p>
          <p><strong>Trial Balance, General Ledger, Profit &amp; Loss and Balance Sheet</strong> are accounting reports. They read the separate journal records and apply account rules. They do not calculate their figures from the Projects page, and a Project selection does not create a project-specific ledger account.</p>
          <p>This distinction explains why project profitability can differ from Profit &amp; Loss. Project views use allocated invoice totals and gross costs, regardless of status, while Profit &amp; Loss uses net income and expense journal lines within its selected period. See <a href="/guides/tracking-project-profitability">tracking project profitability</a> for the current project calculation.</p>
        </section>

        <section>
          <h2>Worked examples</h2>
          <h3>VAT sales invoice</h3>
          <p>A UK consultant saves invoice INV-104 for £100 net plus £20 VAT, total £120. Simple Books debits Trade Receivables £120, credits Sales Revenue £100 and credits VAT Output £20. The journal balances at £120 on each side. Profit &amp; Loss shows £100 income. The Balance Sheet shows the £120 receivable, £20 VAT Output liability and £100 current-year profit within equity.</p>

          <h3>Software supplier bill</h3>
          <p>The business saves a £240 supplier bill categorised as Software, made up of £200 net and £40 VAT. Simple Books debits Software &amp; Subscriptions £200, debits VAT Input £40 and credits Trade Payables £240. Profit &amp; Loss includes a £200 expense; the Balance Sheet includes a £40 VAT Input asset and £240 payable, while the expense reduces the current-year result by £200.</p>

          <h3>Utilities expense claim</h3>
          <p>A director records a £60 utilities expense containing £50 net and £10 VAT. Simple Books debits Utilities £50, debits VAT Input £10 and credits Employee Reimbursements Payable £60. Marking the expense Paid changes its operational status but leaves this journal unchanged; no Bank credit or reimbursement clearing debit is created.</p>

          <h3>Mileage claim</h3>
          <p>A sole trader records 80 business miles at £0.55 per mile, producing a £44 claim. Simple Books debits Travel &amp; Mileage £44 and credits Employee Reimbursements Payable £44. There is no VAT posting. Profit &amp; Loss includes £44 of travel and mileage expense, and the Balance Sheet includes a £44 reimbursement liability.</p>

          <h3>Invoice marked Paid</h3>
          <p>The consultant receives the £120 owed for INV-104 and selects <strong>Mark Paid</strong>. The invoice’s operational status changes to Paid, so after the Dashboard reloads its £120 gross total is removed from Outstanding invoices and overdue checks. The sales journal remains a £120 debit to Trade Receivables, a £100 credit to Sales Revenue and a £20 credit to VAT Output. No debit to Bank or credit clearing Trade Receivables is created.</p>

          <h3>Bill marked Paid</h3>
          <p>The business pays the £240 software bill and selects <strong>Mark paid</strong>. The bill’s operational status changes to Paid, so after the Dashboard reloads it is removed from Unpaid bills and bill alerts. Its journal remains a £200 debit to Software &amp; Subscriptions, a £40 debit to VAT Input and a £240 credit to Trade Payables. No credit to Bank or debit clearing Trade Payables is created.</p>

          <h3>Editing an amount and category</h3>
          <p>A £120 gross expense was saved as General Expenses with £100 net and £20 VAT. The user edits it, changes the category to Professional Fees and changes the values to £150 net, £30 VAT and £180 gross. Saving the update replaces the linked journal: Professional Fees is debited £150, VAT Input is debited £30 and Employee Reimbursements Payable is credited £180. The old General Expenses debit is no longer part of that replaced journal.</p>
        </section>

        <section>
          <h2>Common mistakes and misunderstandings</h2>
          <ul class="remember-list">
            <li><strong>Thinking debit means money out and credit means money in.</strong> Their effect depends on the account type.</li>
            <li><strong>Assuming balanced means correct.</strong> Equal debits and credits do not verify the category, date, amount, VAT treatment or business purpose.</li>
            <li><strong>Recording the same cost as both a bill and an expense.</strong> Each source creates its own journal, so the cost and liability can be duplicated.</li>
            <li><strong>Expecting Paid status to post a payment.</strong> Current status actions do not post Bank or clear receivables, payables or reimbursements.</li>
            <li><strong>Assuming a project changes the accounts.</strong> Project allocation supports operational project reporting; it does not add a project journal line.</li>
            <li><strong>Comparing gross project totals directly with Profit &amp; Loss.</strong> They use different data and calculations.</li>
            <li><strong>Choosing the wrong bill or expense category.</strong> The category controls the expense account, with unmatched categories falling back to General Expenses.</li>
            <li><strong>Ignoring a ledger-posting warning.</strong> The source may be safely saved while its journal is missing from accounting reports.</li>
            <li><strong>Deleting a source and assuming its journal is reversed.</strong> Current delete workflows do not remove or reverse the linked journal.</li>
            <li><strong>Expecting VAT accounts in Profit &amp; Loss.</strong> VAT Input and VAT Output are Balance Sheet accounts in the current chart.</li>
            <li><strong>Treating reports as bookkeeping judgement.</strong> You remain responsible for checking source records, VAT, categories and accounting treatment.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>Double-entry bookkeeping keeps each accounting journal balanced by recording equal debits and credits. In Simple Books, saved invoices debit Trade Receivables and credit revenue and VAT Output; bills debit an expense and VAT Input and credit Trade Payables; expenses debit an expense and VAT Input and credit Employee Reimbursements Payable; mileage debits Travel &amp; Mileage and credits that reimbursement liability.</p>
          <p>The Trial Balance aggregates those entries, the General Ledger shows one account’s detail, Profit &amp; Loss uses income and expense accounts, and the Balance Sheet uses assets, liabilities, equity and the calculated current-year result. Review the current limitations carefully: status changes do not post payments, deletion does not reverse journals, and a failed ledger write can leave a saved operational record absent from the accounting reports.</p>
        </section>`,
  "understanding-the-trial-balance": `<section>
          <h2>Introduction</h2>
          <p>A Trial Balance brings every active account balance into one report, placing debit balances in one column and credit balances in another. In Simple Books, it is a journal-based accounting report: it reads the postings created from saved invoices, bills, expenses and mileage claims rather than adding up the cards or statuses on operational pages.</p>
          <p>This guide explains the Trial Balance exactly as it is currently implemented, including how account balances and report totals are calculated, how to trace them through the General Ledger, and which present limitations can make a balanced report incomplete or unsuitable as evidence that every record is correct. It is general product guidance, not accounting or tax advice.</p>
        </section>

        <section>
          <h2>What is a Trial Balance?</h2>
          <p>A Trial Balance is a list of ledger accounts and their closing debit or credit balances. Its main arithmetic check is that the total of the debit-balance column equals the total of the credit-balance column.</p>
          <p>The Simple Books report displays <strong>Account Code</strong>, <strong>Account Name</strong>, <strong>Debit</strong> and <strong>Credit</strong>. Above the table it shows <strong>Total Debits</strong>, <strong>Total Credits</strong>, their absolute <strong>Difference</strong>, and a status. When the difference is zero, the status is <strong>Balanced</strong>. With no journals, the page says <strong>No data</strong> rather than presenting an empty report as a meaningful balanced result.</p>
          <p>A balanced Trial Balance is an arithmetic check, not proof that the bookkeeping is correct. Equal totals cannot confirm that a transaction has the right date, amount, account, category, VAT treatment or business purpose. For the principles behind the postings, read <a href="/guides/what-is-double-entry-bookkeeping">What is double-entry bookkeeping?</a>.</p>
        </section>

        <section>
          <h2>Why businesses use a Trial Balance</h2>
          <p>A Trial Balance gives a compact view of the closing balances produced by the ledger. It can help a business:</p>
          <ul class="remember-list">
            <li>check that debit and credit closing balances agree overall;</li>
            <li>review which accounts have journal activity;</li>
            <li>spot an unexpected debit or credit balance before relying on other reports;</li>
            <li>open the detailed General Ledger for an account that needs investigation; and</li>
            <li>understand the account totals that feed Profit &amp; Loss and the Balance Sheet.</li>
          </ul>
          <p>It is not a list of outstanding operational tasks. Paid, Unpaid, Draft, Submitted and Approved statuses can affect workflow pages without changing the journals used by this report.</p>
        </section>

        <section>
          <h2>How Simple Books creates the Trial Balance</h2>
          <p>Simple Books first creates or replaces a separate journal when an invoice, bill, expense or mileage claim is saved or updated. Each journal has a date, source type, source identifier, description and at least two account lines. Every line contains one account code and a non-zero debit or credit amount. The journal validator requires recognised account codes, finite non-negative values with no more than two decimal places, and exactly equal total debits and credits.</p>
          <p>The Trial Balance loads the authenticated user’s saved journal documents. It validates every loaded journal before calculating anything. It then visits every journal line and, for each account code, accumulates two values:</p>
          <ul class="remember-list">
            <li><strong>Account debits</strong> = all debit postings to that account added together.</li>
            <li><strong>Account credits</strong> = all credit postings to that account added together.</li>
            <li><strong>Account balance</strong> = accumulated debits minus accumulated credits.</li>
          </ul>
          <p>If the account balance is positive, its absolute amount appears in the Debit column. If it is negative, the absolute amount appears in the Credit column. A zero closing balance appears in neither money column, although the account can remain listed because it had journal activity. Rows are ordered by account code.</p>
          <p>Finally, Simple Books adds the displayed debit closing balances to produce Total Debits and adds the displayed credit closing balances to produce Total Credits. Difference is the absolute value of Total Debits minus Total Credits. Values are rounded to two decimal places during journal creation and accumulation and displayed as GBP.</p>
        </section>

        <section>
          <h2>How source records generate ledger entries</h2>
          <p>The Trial Balance is generated from General Ledger postings, not directly from invoice, bill, expense or mileage collections. The current source-to-journal rules are:</p>
          <ul class="remember-list">
            <li><strong>Sales invoice:</strong> debit <strong>1100 Trade Receivables</strong> for the gross total, credit <strong>4000 Sales Revenue</strong> for the net amount, and credit <strong>2100 VAT Output</strong> when VAT is greater than zero. An invoice with active line items can create separate Sales Revenue lines, but they all use account 4000.</li>
            <li><strong>Supplier bill:</strong> debit the category-mapped expense account for the net amount, debit <strong>1200 VAT Input</strong> when VAT is greater than zero, and credit <strong>2000 Trade Payables</strong> for the gross total.</li>
            <li><strong>Business expense:</strong> debit the category-mapped expense account for the net amount, debit <strong>1200 VAT Input</strong> when VAT is greater than zero, and credit <strong>2200 Employee Reimbursements Payable</strong> for the gross amount.</li>
            <li><strong>Mileage claim:</strong> debit <strong>5200 Travel &amp; Mileage</strong> and credit <strong>2200 Employee Reimbursements Payable</strong> for the claim amount. The amount must agree with miles multiplied by the rate when both are supplied. The current mileage journal has no VAT line.</li>
          </ul>
          <p>Supported bill and expense categories map to Travel &amp; Mileage, Utilities, Professional Fees, or Software &amp; Subscriptions. An unmatched category falls back to General Expenses. Editing and saving a source replaces its deterministic linked journal with values based on the update.</p>
        </section>

        <section>
          <h2>Accounts included in the report</h2>
          <p>The current chart of accounts contains:</p>
          <ul class="remember-list">
            <li><strong>Assets:</strong> 1000 Bank, 1100 Trade Receivables and 1200 VAT Input.</li>
            <li><strong>Liabilities:</strong> 2000 Trade Payables, 2100 VAT Output and 2200 Employee Reimbursements Payable.</li>
            <li><strong>Equity:</strong> 3000 Owner’s Equity.</li>
            <li><strong>Income:</strong> 4000 Sales Revenue.</li>
            <li><strong>Expenses:</strong> 5000 General Expenses, 5200 Travel &amp; Mileage, 5300 Utilities, 5400 Professional Fees and 5500 Software &amp; Subscriptions.</li>
          </ul>
          <p>The Trial Balance lists only accounts encountered in the loaded journal lines; it does not print every unused chart account with £0.00. The invoice, bill, expense and mileage builders do not currently post to Bank or directly to Owner’s Equity, so those accounts will not appear unless a stored journal from another implemented posting path contains activity. The current product has no user-facing manual-journal workflow.</p>
        </section>

        <section>
          <h2>Debit and credit balances explained</h2>
          <p>Debit does not simply mean money leaving the business, and credit does not simply mean money arriving. They are the two sides of an account. Under the current postings, assets and expenses commonly build debit balances, while liabilities, equity and income commonly build credit balances.</p>
          <p>For example, saving a £120 invoice can give Trade Receivables a £120 debit balance, while its £100 net value gives Sales Revenue a £100 credit balance and its £20 VAT gives VAT Output a £20 credit balance. If an account received both debits and credits, the Trial Balance shows only the net closing side: £500 of debits and £125 of credits becomes a £375 debit balance.</p>
          <p>This netting is why Total Debits and Total Credits are totals of <em>closing account balances</em>, not totals of every debit and every credit line posted during the period.</p>
        </section>

        <section>
          <h2>Why the Trial Balance should balance</h2>
          <p>Every valid journal contributes the same amount to debit postings as it contributes to credit postings. When all account balances are netted and separated into debit and credit columns, those equal journal sides should still produce equal closing-balance totals.</p>
          <p>Simple Books also validates each journal before aggregation. A journal must contain at least two valid non-zero lines, no line can contain both a debit and a credit, and the journal’s total debits must equal its total credits. This makes an out-of-balance result unlikely for journals created by the current builders.</p>
          <p>Balance is necessary but not sufficient. A £100 debit to the wrong expense account and a £100 credit to a payable still balance. A duplicated journal can balance. A missing journal leaves both sides out and can also leave the remaining Trial Balance balanced.</p>
        </section>

        <section>
          <h2>Common reasons a Trial Balance does not balance</h2>
          <p>Under the current implementation, malformed or unbalanced stored journal data is rejected before a Trial Balance is shown. The page displays <strong>Unable to calculate</strong> and does not display partial account totals. A journal can fail validation because it has an unknown account code, a missing date, fewer than two lines, a zero-only line, negative or non-finite values, more than two decimal places, both a debit and credit on one line, or unequal journal totals.</p>
          <p>The report view supports an <strong>Out of balance</strong> status if calculated closing totals differ, but the normal calculation validates journals first. Therefore, seeing an error is the more likely current result of invalid stored journal data; seeing Out of balance would indicate an unexpected inconsistency in the calculated report data and should be investigated.</p>
          <p>Other problems can make the report wrong or incomplete without making its two columns unequal:</p>
          <ul class="remember-list">
            <li>a source record was saved but its ledger posting failed, leaving no journal in the report;</li>
            <li>the same business event was recorded more than once, creating multiple balanced journals;</li>
            <li>a valid journal used the wrong date, value, VAT treatment or expense category; or</li>
            <li>a source was deleted while its existing journal remained, because current delete workflows do not post a reversal or remove that journal.</li>
          </ul>
        </section>

        <section>
          <h2>Relationship to the General Ledger</h2>
          <p>The <a href="/guides/understanding-the-general-ledger">General Ledger</a> and Trial Balance use the same saved journals and the same account rules. The Trial Balance summarises each account’s net closing balance. The General Ledger expands one account into its individual journal postings, ordered by date, and calculates a running balance by adding debits and subtracting credits.</p>
          <p>Each Trial Balance account code is a link to that account in the General Ledger. Use it to explain a balance: for example, open 1100 Trade Receivables to see the invoice debits behind the closing amount. The General Ledger has optional inclusive Date From and Date To filters; the current Trial Balance has no date filter and uses all journals loaded for the user. A filtered General Ledger closing balance may therefore differ from the unfiltered Trial Balance row.</p>
        </section>

        <section>
          <h2>Relationship to the Profit &amp; Loss Statement</h2>
          <p>The <a href="/guides/understanding-profit-and-loss">Profit &amp; Loss Statement</a> builds account totals from journals for its optional date range and selects only Income and Expense accounts. It calculates income as credits minus debits, expenses as debits minus credits, and net profit or loss as total income minus total expenses.</p>
          <p>In the Trial Balance, Sales Revenue normally appears as a credit balance and expense accounts normally appear as debit balances. Profit &amp; Loss turns those balances into its income and expense rows. Trade Receivables, Trade Payables, Employee Reimbursements Payable, VAT Input and VAT Output are excluded from Profit &amp; Loss because they are asset or liability accounts.</p>
          <p>The current Profit &amp; Loss page can be date-filtered, while the Trial Balance cannot. Compare them only when the underlying journal scope is equivalent.</p>
        </section>

        <section>
          <h2>Relationship to the Balance Sheet</h2>
          <p>The <a href="/guides/understanding-the-balance-sheet">Balance Sheet</a> also starts from the journals and can include them up to an optional inclusive <strong>As at</strong> date. It presents asset balances on a debit-oriented basis and liability and equity balances on a credit-oriented basis.</p>
          <p>Income and expense Trial Balance accounts are not printed directly on the Balance Sheet. Simple Books calculates their Profit &amp; Loss result for the same set of journals and adds that result to displayed equity as Current Year Profit or Current Year Loss. The Balance Sheet then checks whether total assets equal total liabilities plus total equity.</p>
          <p>Because its As at filter can restrict the journal set, a dated Balance Sheet need not match an unfiltered Trial Balance account-for-account.</p>
        </section>

        <section>
          <h2>Worked examples</h2>
          <h3>Invoice and supplier bill</h3>
          <p>A consultant saves a £120 sales invoice made up of £100 net and £20 VAT. Simple Books debits Trade Receivables £120, credits Sales Revenue £100 and credits VAT Output £20. The consultant also saves a £60 Utilities bill made up of £50 net and £10 VAT. That journal debits Utilities £50, debits VAT Input £10 and credits Trade Payables £60.</p>
          <p>The Trial Balance now shows debit balances of £120 Trade Receivables, £10 VAT Input and £50 Utilities: Total Debits £180. It shows credit balances of £60 Trade Payables, £20 VAT Output and £100 Sales Revenue: Total Credits £180. Difference is £0.00 and the report is Balanced.</p>

          <h3>Expense and mileage accumulated in one payable</h3>
          <p>The business records a £30 expense made up of £25 net General Expenses and £5 VAT, then records 10 business miles at £0.55, a £5.50 claim. The expense debits General Expenses £25 and VAT Input £5 and credits Employee Reimbursements Payable £30. Mileage debits Travel &amp; Mileage £5.50 and credits the same payable £5.50.</p>
          <p>The Trial Balance accumulates the two credits to 2200 Employee Reimbursements Payable and shows one £35.50 credit balance. It does not create separate reimbursement accounts for the two records.</p>

          <h3>Opposing postings net within an account</h3>
          <p>If an account has £500 of debit postings and £125 of credit postings across valid journals, its closing balance is £375 debit. The Trial Balance shows £375 in that account’s Debit column, not £500 debit and £125 credit. The General Ledger remains the place to see both sides and the running balance.</p>
        </section>

        <section>
          <h2>Current implementation limitations</h2>
          <ul class="remember-list">
            <li><strong>No Trial Balance date filter:</strong> the report uses all journals loaded for the authenticated user. Profit &amp; Loss, the General Ledger and the Balance Sheet have their own date controls.</li>
            <li><strong>Status does not post settlement:</strong> marking an invoice, bill or expense Paid changes operational status only. It does not post Bank or clear Trade Receivables, Trade Payables or Employee Reimbursements Payable.</li>
            <li><strong>Bank and Owner’s Equity are not used by the four current source builders:</strong> the chart contains them, but saving invoices, bills, expenses and mileage does not post to them.</li>
            <li><strong>No manual journals:</strong> there is no current user-facing workflow for posting a manual journal or an opening balance.</li>
            <li><strong>Deletion does not reverse:</strong> deleting an invoice, bill, expense or mileage source does not currently create a reversal or delete its existing journal, so the accounting reports can retain that posting.</li>
            <li><strong>Ledger writes can fail after a source is saved:</strong> the operational record can remain while its journal is absent, leaving reports incomplete even though the displayed Trial Balance balances.</li>
            <li><strong>No partial result on invalid data:</strong> one malformed loaded journal makes the Trial Balance unavailable rather than being silently omitted.</li>
            <li><strong>Only active accounts are shown:</strong> unused chart accounts are not listed with zero balances.</li>
          </ul>
        </section>

        <section>
          <h2>Common mistakes</h2>
          <ul class="remember-list">
            <li><strong>Assuming balanced means correct.</strong> Review dates, values, accounts, categories and VAT treatment as well as the two totals.</li>
            <li><strong>Reading debit as money out and credit as money in.</strong> The meaning depends on the account type and transaction.</li>
            <li><strong>Adding journal movements instead of closing balances.</strong> The report nets debits and credits within each account before totalling its two columns.</li>
            <li><strong>Expecting every chart account to appear.</strong> Only accounts encountered in loaded journal lines are listed.</li>
            <li><strong>Comparing a dated report with the unfiltered Trial Balance.</strong> Align the journal scope before investigating a difference.</li>
            <li><strong>Expecting Paid status to clear a balance.</strong> Current status actions do not create settlement journals.</li>
            <li><strong>Deleting a source to correct the ledger.</strong> Current deletion does not reverse or remove the existing journal.</li>
            <li><strong>Ignoring a posting warning.</strong> A saved source without its journal will not appear in the Trial Balance.</li>
            <li><strong>Recording the same cost as both a bill and an expense.</strong> Both records can create their own balanced journal and duplicate the accounting effect.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>The Simple Books Trial Balance is a summary of General Ledger postings. It validates every loaded journal, accumulates debits and credits by account, calculates each balance as debits minus credits, places the net balance in one column, and totals the debit and credit closing balances. Equal totals are expected because every accepted journal is balanced.</p>
          <p>Use the linked General Ledger to investigate the postings behind a balance, Profit &amp; Loss to review income and expenses for a chosen period, and the Balance Sheet to review assets, liabilities and equity as at a date. Remember the present boundaries: the Trial Balance has no date filter, status actions do not post payments, current source deletion does not reverse journals, and a missing but balanced-out ledger posting can leave the report incomplete without creating a difference.</p>
        </section>`,
  "understanding-the-general-ledger": `<section>
          <h2>Introduction</h2>
          <p>The General Ledger is the detailed account-by-account view of the journals behind the Simple Books accounting reports. Where the Trial Balance gives one closing debit or credit balance for each active account, the General Ledger lets you choose one account and review the individual dated postings that produced its balance.</p>
          <p>This guide explains the General Ledger exactly as it is currently implemented: how invoices, bills, expenses and mileage claims generate journals, how those journals are stored and loaded, how account and date filters work, and how the running balance is calculated. It also identifies the current limitations that matter when interpreting a filtered ledger. This is general product guidance, not accounting or tax advice.</p>
        </section>

        <section>
          <h2>What is a General Ledger?</h2>
          <p>A General Ledger organises accounting postings by account. Each journal can affect several ledger accounts, and the ledger for one account shows only the lines posted to that account. For example, a sales invoice journal can appear in the separate ledgers for Trade Receivables, Sales Revenue and VAT Output.</p>
          <p>In Simple Books, the page displays one selected account at a time. Its table has <strong>Date</strong>, <strong>Reference</strong>, <strong>Description</strong>, <strong>Debit</strong>, <strong>Credit</strong> and <strong>Running Balance</strong> columns. The account selector contains accounts with journal activity and orders them by account code.</p>
          <p>The General Ledger is not another transaction-entry page. Journals are created by the current invoice, bill, expense and mileage workflows. For the underlying accounting model, read <a href="/guides/what-is-double-entry-bookkeeping">What is double-entry bookkeeping?</a>.</p>
        </section>

        <section>
          <h2>Why businesses use a General Ledger</h2>
          <p>The General Ledger provides the detail needed to explain a summary balance. It can help a business:</p>
          <ul class="remember-list">
            <li>trace a Trial Balance amount to its individual journal postings;</li>
            <li>review the dates, references and descriptions behind an account;</li>
            <li>see whether a posting was recorded as a debit or a credit;</li>
            <li>follow how selected postings build the displayed running and closing balance;</li>
            <li>check which expense account a bill or expense category used; and</li>
            <li>investigate why accounting reports differ from operational status totals.</li>
          </ul>
          <p>A ledger can show what Simple Books posted, but it does not decide whether the source date, category, value, VAT treatment or business purpose is correct. Those details still need review.</p>
        </section>

        <section>
          <h2>How Simple Books creates ledger entries</h2>
          <p>Saving or updating an invoice, bill, expense or mileage claim creates or replaces one linked journal. Each valid journal contains a source date, source type, source identifier, description, and at least two account lines. Every line has a recognised account code and one non-zero debit or credit value. The combined journal debits must equal the combined journal credits.</p>
          <p>The current posting rules are:</p>
          <ul class="remember-list">
            <li><strong>Sales invoice:</strong> debit <strong>1100 Trade Receivables</strong> for the gross total; credit <strong>4000 Sales Revenue</strong> for the net amount; and credit <strong>2100 VAT Output</strong> when VAT is greater than zero. Active invoice items can create separate revenue lines, all using account 4000.</li>
            <li><strong>Supplier bill:</strong> debit the category-mapped expense account for the net amount; debit <strong>1200 VAT Input</strong> when VAT is greater than zero; and credit <strong>2000 Trade Payables</strong> for the gross total.</li>
            <li><strong>Business expense:</strong> debit the category-mapped expense account for the net amount; debit <strong>1200 VAT Input</strong> when VAT is greater than zero; and credit <strong>2200 Employee Reimbursements Payable</strong> for the gross amount.</li>
            <li><strong>Mileage claim:</strong> debit <strong>5200 Travel &amp; Mileage</strong> and credit <strong>2200 Employee Reimbursements Payable</strong> for the claim amount. The current mileage journal has no VAT line.</li>
          </ul>
          <p>Supported bill and expense categories map to Travel &amp; Mileage, Utilities, Professional Fees, or Software &amp; Subscriptions. An unmatched category uses General Expenses. Project allocation does not add a project-specific journal line.</p>
        </section>

        <section>
          <h2>How journal entries are stored and loaded</h2>
          <p>Simple Books stores journals as separate documents in its <strong>journals</strong> collection. Each source has a deterministic journal document identifier built from its source type, the user ID and the source record ID. Saving an update writes to that same linked document rather than deliberately adding a second journal for the source.</p>
          <p>A stored journal includes the owning user ID, journal ID, journal date, source type, source ID, source number where available, description, created and updated timestamps, and its debit and credit lines. Each line stores the account code, line description, debit and credit values.</p>
          <p>The General Ledger queries journal documents for the authenticated user. It maps the stored fields into journal data without silently repairing malformed values, then validates the complete loaded journal set. If loading or validation fails, the page shows <strong>Unable to load</strong> and no partial account or journal results.</p>
        </section>

        <section>
          <h2>Journal entries shown in the ledger</h2>
          <p>After you select an account, Simple Books examines every loaded journal line and keeps only lines whose account code exactly matches the selection. Each resulting row shows:</p>
          <ul class="remember-list">
            <li><strong>Date:</strong> the journal’s written calendar date, shown as YYYY-MM-DD.</li>
            <li><strong>Reference:</strong> the source number when present, otherwise the source ID, journal ID or journal document reference in that order.</li>
            <li><strong>Description:</strong> the journal line description, falling back to the journal description when needed.</li>
            <li><strong>Debit and Credit:</strong> the posting amount on its relevant side, with an em dash on the other side.</li>
            <li><strong>Running Balance:</strong> the cumulative debit-minus-credit position after that row.</li>
          </ul>
          <p>Entries are ordered chronologically. When journals have the same date, Simple Books uses the journal identity as a stable secondary order. The table does not combine multiple postings into one source summary: if one journal contains more than one line for the selected account, those lines can appear separately.</p>
        </section>

        <section>
          <h2>Debit and credit postings explained</h2>
          <p>Debit and credit describe which side of an account received the posting; they do not simply mean money out and money in. Under the current journal rules, asset and expense accounts commonly receive debits, while liability and income accounts commonly receive credits.</p>
          <p>The General Ledger shows the original posting sides rather than netting each row. A £120 invoice therefore appears as a £120 debit in the Trade Receivables ledger, a £100 credit in Sales Revenue and a £20 credit in VAT Output. A £60 supplier bill can appear as a £50 debit in its expense account, a £10 debit in VAT Input and a £60 credit in Trade Payables.</p>
          <p>Positive running balances are formatted with <strong>Dr</strong>; negative running balances are displayed as their absolute value with <strong>Cr</strong>. A zero balance displays as £0.00 without a Dr or Cr suffix.</p>
        </section>

        <section>
          <h2>Running account balances</h2>
          <p>For the selected account, Simple Books starts the running balance at zero and processes the displayed entries in order. For each row it applies:</p>
          <p><strong>New running balance = previous running balance + debit − credit.</strong></p>
          <p>Two Trade Receivables debits of £120 and £60 produce running balances of £120 Dr and £180 Dr. In a credit-oriented account, a £60 Trade Payables credit produces a numeric balance of minus £60, displayed as £60.00 Cr.</p>
          <p>The Closing balance above the table is the final running balance of the currently displayed entries. It is not stored separately; the page recalculates it from the selected journals and account lines.</p>
        </section>

        <section>
          <h2>Filtering by account and date</h2>
          <p>The <strong>Account</strong> selector lists distinct account codes that have debit or credit activity anywhere in the loaded journals. Labels combine the code and chart name, such as <strong>1100 — Trade Receivables</strong>. Only an exact active account code is accepted. An unknown or missing account selection is ignored safely and the page asks you to choose an account.</p>
          <p><strong>Date From</strong> and <strong>Date To</strong> are optional and inclusive. Date From keeps journals on or after that calendar date; Date To keeps journals on or before it. You can use either boundary alone or both together. Date From must be on or before Date To. An invalid range produces <strong>Check dates</strong> and no ledger rows until it is corrected.</p>
          <p>Changing the account reapplies the current filters immediately. After changing a date, select <strong>Refresh</strong>. If the account has no entries in the chosen period, the page shows <strong>No activity</strong>.</p>
          <p>The date filter is applied to whole journals before the selected account ledger is built. The filtered running balance therefore starts at zero with the first in-range posting. It does not bring forward an opening balance from journals before Date From. This is an important difference from a conventional ledger report with a brought-forward balance.</p>
        </section>

        <section>
          <h2>Relationship to the Trial Balance</h2>
          <p>The <a href="/guides/understanding-the-trial-balance">Trial Balance</a> and General Ledger use the same loaded journals and chart of accounts. The Trial Balance accumulates all debits and credits for each active account and presents one net closing debit or credit balance. The General Ledger exposes the individual postings for one account.</p>
          <p>Every Trial Balance account code links to the General Ledger using an <strong>account</strong> query parameter, for example <strong>?account=1100</strong>. When that code exists in the active account list, the General Ledger selects it automatically. An unknown query value is ignored.</p>
          <p>The current Trial Balance has no date filter, while the General Ledger does. With no General Ledger date filters, the selected account’s closing balance should represent the same all-journal debit-minus-credit amount as its Trial Balance row. With a date range, the figures can differ because the ledger includes only journals inside that range and does not carry forward an opening balance.</p>
        </section>

        <section>
          <h2>Relationship to the Profit &amp; Loss Statement</h2>
          <p>The <a href="/guides/understanding-profit-and-loss">Profit &amp; Loss Statement</a> uses the same journal data but selects Income and Expense account balances for its chosen date range. Income is calculated as credits minus debits, expenses as debits minus credits, and total income minus total expenses produces the net profit or loss.</p>
          <p>Use the General Ledger to inspect the entries behind a Profit &amp; Loss row. Sales Revenue journal lines explain reported income. General Expenses, Travel &amp; Mileage, Utilities, Professional Fees and Software &amp; Subscriptions journal lines explain the current expense rows.</p>
          <p>The two pages calculate their date ranges independently. Match Date From and Date To when comparing them. Remember that the General Ledger running balance begins at zero for its filtered entries, which is appropriate for reviewing in-range movement but is not a brought-forward account balance.</p>
        </section>

        <section>
          <h2>Relationship to the Balance Sheet</h2>
          <p>The <a href="/guides/understanding-the-balance-sheet">Balance Sheet</a> includes journals up to an optional inclusive <strong>As at</strong> date. It uses asset balances as debits minus credits and liability and equity balances as credits minus debits. It also calculates the current Profit &amp; Loss result and adds it to displayed equity.</p>
          <p>Use the General Ledger to investigate asset and liability rows such as Trade Receivables, VAT Input, Trade Payables, VAT Output and Employee Reimbursements Payable. To compare with a dated Balance Sheet, set General Ledger Date To to the same date and leave Date From blank. That includes journals from the beginning of the available data through the reporting date, although the current source journals may still omit settlement activity described below.</p>
        </section>

        <section>
          <h2>Worked examples</h2>
          <h3>Trade Receivables from two invoices</h3>
          <p>A consultant saves invoice INV-101 for £120 gross on 5 July and INV-102 for £60 gross on 12 July. Each journal debits Trade Receivables. With account 1100 selected and no date filter, the ledger shows £120 in the Debit column with a £120 Dr running balance, followed by £60 in Debit with a £180 Dr running and closing balance.</p>
          <p>If Date From is set to 10 July, only INV-102 appears and the displayed balance is £60 Dr. The earlier £120 is not brought forward, so this filtered balance is the net movement in the displayed journal set rather than the full receivable position.</p>

          <h3>Software supplier bill with VAT</h3>
          <p>The business saves a £240 supplier bill made up of £200 net and £40 VAT, categorised as Software. The same journal contributes a £200 debit row to 5500 Software &amp; Subscriptions, a £40 debit row to 1200 VAT Input and a £240 credit row to 2000 Trade Payables. Selecting each account shows only its matching line and its own running balance.</p>

          <h3>Expense and mileage in one payable account</h3>
          <p>A £30 expense credits Employee Reimbursements Payable, followed by a £5.50 mileage claim that credits the same account. In account 2200, the first row produces £30 Cr and the second produces £35.50 Cr. The corresponding expense debits appear in General Expenses and Travel &amp; Mileage, not as extra rows in the payable account.</p>

          <h3>Following a Trial Balance link</h3>
          <p>The Trial Balance shows £180 Dr for Trade Receivables. Selecting its 1100 account-code link opens the General Ledger with 1100 requested. If that account remains active, it is selected and the two invoice postings above explain the total. Applying a date filter then changes the displayed rows and recalculates the balance from the filtered set.</p>
        </section>

        <section>
          <h2>Common mistakes</h2>
          <ul class="remember-list">
            <li><strong>Thinking the General Ledger is a source-entry page.</strong> The current ledger is read-only; journals come from saved invoices, bills, expenses and mileage claims.</li>
            <li><strong>Reading debit as money out and credit as money in.</strong> Their effect depends on the selected account.</li>
            <li><strong>Expecting every journal line in one account.</strong> The page filters by exact account code and shows only matching lines.</li>
            <li><strong>Comparing an in-range closing balance with an all-time Trial Balance.</strong> The journal scopes are different.</li>
            <li><strong>Assuming Date From carries forward an opening balance.</strong> The filtered ledger starts from zero.</li>
            <li><strong>Expecting date changes to apply automatically.</strong> Select Refresh after changing Date From or Date To.</li>
            <li><strong>Expecting Paid status to add a settlement entry.</strong> Current status actions do not post Bank or clear receivables, payables or reimbursements.</li>
            <li><strong>Deleting a source to remove its ledger posting.</strong> Current delete workflows do not reverse or delete the linked journal.</li>
            <li><strong>Ignoring a posting warning.</strong> A source can remain saved while its failed journal is absent from the General Ledger.</li>
          </ul>
        </section>

        <section>
          <h2>Current implementation limitations</h2>
          <ul class="remember-list">
            <li><strong>One account at a time:</strong> the page does not show a combined multi-account ledger table.</li>
            <li><strong>No brought-forward balance:</strong> Date From excludes earlier journals entirely, so a filtered running balance begins at zero.</li>
            <li><strong>No manual journals or opening-balance workflow:</strong> the current user interface does not provide these posting tools.</li>
            <li><strong>No ledger export, print or pagination controls:</strong> the current page displays the loaded selected-account entries in one table.</li>
            <li><strong>Status changes do not post payments:</strong> marking invoices, bills or expenses Paid does not create Bank entries or clear Trade Receivables, Trade Payables or Employee Reimbursements Payable.</li>
            <li><strong>Bank and Owner’s Equity are not posted by the four current source builders:</strong> those accounts exist in the chart but invoices, bills, expenses and mileage do not use them.</li>
            <li><strong>Deletion does not reverse journals:</strong> deleting a source record does not currently create a reversal or remove its linked journal, so the posting can remain in the ledger.</li>
            <li><strong>A journal write can fail after its source is saved:</strong> the source can exist on an operational page but be missing from journal-based reports.</li>
            <li><strong>No partial display for malformed data:</strong> one invalid loaded journal or invalid journal date makes the General Ledger unavailable rather than being silently skipped.</li>
            <li><strong>No direct source-record link:</strong> Reference is displayed as text; the current ledger table does not link a row back to its invoice, bill, expense or mileage record.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>The Simple Books General Ledger reads the authenticated user’s stored journals, validates them, builds a list of active chart accounts and displays the matching lines for one selected account. Rows show the journal date, best available reference, description, debit, credit and a running balance calculated by adding debits and subtracting credits.</p>
          <p>Use exact account-code selection and optional inclusive Date From and Date To filters to investigate account activity. Follow account links from the Trial Balance, match reporting dates when comparing Profit &amp; Loss or the Balance Sheet, and remember that Date From does not bring forward earlier balances. Current payment statuses, deletion workflows, missing journal writes and the absence of manual journals or settlement postings can all affect what the ledger represents.</p>
        </section>`,
  "understanding-profit-and-loss": `<section>
          <h2>Introduction</h2>
          <p>The Profit &amp; Loss Statement in Simple Books summarises income and expenses from accounting journals for a chosen reporting period. It uses the net Sales Revenue posted by invoices and the expense-account postings created by supplier bills, business expenses and mileage claims, then subtracts total expenses from total income.</p>
          <p>This guide documents that calculation exactly as it is currently implemented. It focuses on the accounts included, the debit and credit treatment, date filtering, report states and present limitations. For the detailed mechanics of individual postings, use the linked <a href="/guides/what-is-double-entry-bookkeeping">double-entry bookkeeping guide</a> rather than treating this summary report as a source-entry page. This is general product guidance, not accounting or tax advice.</p>
        </section>

        <section>
          <h2>What a Profit &amp; Loss Statement is</h2>
          <p>A Profit &amp; Loss Statement, often shortened to P&amp;L, reports income and expenses over a period and shows the resulting profit or loss. It is a performance report rather than a list of assets and liabilities at one point in time.</p>
          <p>The current Simple Books page presents four summary cards—Revenue, Expenses, Net Profit or Net Loss, and Status—followed by a financial statement containing Income rows, Total Income, Expense rows, Total Expenses and the net result. A positive result is labelled <strong>Net Profit</strong>, a negative result <strong>Net Loss</strong>, and a zero result with financial activity <strong>Break-even</strong>.</p>
          <p>If the selected journal set contains no Income or Expense account activity, the page shows <strong>No data</strong>. It does not treat balance-sheet-only activity as a zero-profit statement.</p>
        </section>

        <section>
          <h2>Why businesses use a Profit &amp; Loss Statement</h2>
          <p>A P&amp;L helps a business review financial performance for a period. In the current report, it can help you:</p>
          <ul class="remember-list">
            <li>see the net Sales Revenue recorded through invoice journals;</li>
            <li>review costs grouped into the available expense accounts;</li>
            <li>compare total income with total expenses;</li>
            <li>identify whether the selected journal period produced a profit, loss or break-even result; and</li>
            <li>choose an account for deeper investigation in the General Ledger.</li>
          </ul>
          <p>A P&amp;L reports what the journals contain. A calculated profit does not confirm that every transaction, category, date or VAT treatment is complete and correct.</p>
        </section>

        <section>
          <h2>How Simple Books calculates Profit &amp; Loss</h2>
          <p>Simple Books loads the authenticated user’s saved journals, validates the complete journal set, applies the optional reporting dates, and builds Trial Balance-style account totals from the journals inside the selected period. It then selects only accounts whose chart type is <strong>Income</strong> or <strong>Expense</strong>.</p>
          <p>For each included account, the current formulas are:</p>
          <ul class="remember-list">
            <li><strong>Income account amount</strong> = account credits − account debits.</li>
            <li><strong>Expense account amount</strong> = account debits − account credits.</li>
            <li><strong>Total Income</strong> = sum of all included Income account amounts.</li>
            <li><strong>Total Expenses</strong> = sum of all included Expense account amounts.</li>
            <li><strong>Net result</strong> = Total Income − Total Expenses.</li>
          </ul>
          <p>Amounts are rounded to two decimal places. Contra or reversal activity is respected: a debit to an Income account reduces its reported income, while a credit to an Expense account reduces its reported expense. An abnormal negative account amount is displayed in accounting parentheses.</p>
        </section>

        <section>
          <h2>Income accounts currently included</h2>
          <p>The current chart of accounts contains one Income account: <strong>4000 Sales Revenue</strong>. Sales invoice journals credit this account for the invoice’s net amount. Where an invoice contains active line items, Simple Books can create separate Sales Revenue journal lines for those item descriptions, but they all accumulate into account 4000 for Profit &amp; Loss.</p>
          <p>The gross invoice total is not reported as revenue. The gross amount is debited to Trade Receivables, while VAT greater than zero is credited separately to VAT Output. Trade Receivables is an Asset and VAT Output is a Liability, so neither is selected for the P&amp;L.</p>
          <p>Invoice Paid or Unpaid status does not control inclusion. The report reads the saved sales journal and its journal date; current payment-status actions do not replace that journal or add a receipt entry.</p>
        </section>

        <section>
          <h2>Expense accounts currently included</h2>
          <p>The current Expense accounts are:</p>
          <ul class="remember-list">
            <li><strong>5000 General Expenses</strong> for unmatched bill and expense categories;</li>
            <li><strong>5200 Travel &amp; Mileage</strong> for travel, mileage and related mapped categories;</li>
            <li><strong>5300 Utilities</strong>;</li>
            <li><strong>5400 Professional Fees</strong>; and</li>
            <li><strong>5500 Software &amp; Subscriptions</strong>.</li>
          </ul>
          <p>Supplier bills debit the mapped Expense account for their net amount. Ordinary expenses do the same. Mileage claims debit Travel &amp; Mileage for the full calculated claim amount and have no VAT journal line.</p>
          <p>Where a bill or expense contains VAT, VAT Input is debited separately and is excluded from P&amp;L because it is an Asset account. Trade Payables and Employee Reimbursements Payable are also excluded because they are Liabilities. The report therefore uses net bill and ordinary-expense costs, but the full mileage claim.</p>
        </section>

        <section>
          <h2>Gross profit and net profit calculations</h2>
          <p>The current Simple Books Profit &amp; Loss report does <strong>not</strong> calculate or display a separate Gross Profit subtotal. The chart has no Cost of Sales account type or cost-of-sales section, and the statement does not classify some expenses as direct costs before other operating expenses.</p>
          <p>The implemented result is:</p>
          <p><strong>Net Profit or Loss = Total Income − Total Expenses.</strong></p>
          <p>If the result is greater than zero, the page labels it Net Profit and shows status <strong>Profit</strong>. If it is below zero, the absolute amount is displayed under Net Loss and the status is <strong>Loss</strong>. Exactly zero with Income or Expense activity is labelled Break-even.</p>
          <p>Do not confuse this result with project <strong>Gross profit</strong>, which is an operational project calculation based on allocated gross transaction values, or with the Dashboard’s monthly Difference line. Those pages use different data and rules.</p>
        </section>

        <section>
          <h2>Date filtering and reporting period behaviour</h2>
          <p><strong>Date From</strong> and <strong>Date To</strong> are optional, inclusive journal-date filters. Date From includes journals on or after its calendar date. Date To includes journals on or before it. With both fields blank, Simple Books uses all loaded journals. After changing either date, select <strong>Refresh</strong>.</p>
          <p>Date From must be on or before Date To. An invalid range shows <strong>Check dates</strong>, leaves the totals blank and asks you to adjust the filters. Journal dates use their written YYYY-MM-DD calendar date without timezone shifting.</p>
          <p>Before applying the chosen period, Simple Books validates every loaded journal and checks that every journal has a valid calendar date. A malformed journal outside the selected period still makes the report unavailable. This prevents an invalid record from being hidden by the date filter and producing apparently complete partial totals.</p>
          <p>If the in-range journals contain no Income or Expense activity, the page shows No data even if they contain valid Asset, Liability or Equity postings.</p>
        </section>

        <section>
          <h2>Relationship to the General Ledger</h2>
          <p>The <a href="/guides/understanding-the-general-ledger">General Ledger</a> uses the same saved journals but displays the individual debit and credit lines for one selected account. Profit &amp; Loss groups those lines into account totals and includes only Income and Expense chart types.</p>
          <p>To investigate a P&amp;L row, open the General Ledger and select its corresponding account, such as Sales Revenue, Utilities or Software &amp; Subscriptions. Use matching Date From and Date To values so both reports examine the same journal period.</p>
          <p>The current P&amp;L statement displays account names and amounts as plain text. It does not provide direct account-code links into the General Ledger. The General Ledger’s filtered running balance also starts at zero for the in-range journals, while the P&amp;L uses the same in-range account movements to calculate its period amount.</p>
        </section>

        <section>
          <h2>Relationship to the Trial Balance</h2>
          <p>The <a href="/guides/understanding-the-trial-balance">Trial Balance</a> accumulation is the calculation foundation for Profit &amp; Loss. For the filtered journals, Simple Books totals debits and credits by account. Profit &amp; Loss then selects the Income and Expense accounts from those balances and applies its account-type sign rules.</p>
          <p>An Income account’s Trial Balance-style net is debits minus credits, but P&amp;L reports Income as credits minus debits so ordinary credit revenue appears positive. An Expense account already has the debit-oriented amount needed by P&amp;L: debits minus credits.</p>
          <p>The current Trial Balance has no date filter and uses all loaded journals. Profit &amp; Loss can use a date range, so the figures should only be compared directly when their journal scope is equivalent.</p>
        </section>

        <section>
          <h2>Relationship to the Balance Sheet</h2>
          <p>The <a href="/guides/understanding-the-balance-sheet">Balance Sheet</a> builds from journals up to an optional inclusive <strong>As at</strong> date. It lists Asset, Liability and Equity accounts rather than displaying Income and Expense accounts directly.</p>
          <p>For the same Balance Sheet journal set, Simple Books runs the Profit &amp; Loss calculation and adds its net result to displayed equity as <strong>Current Year Profit</strong> or <strong>Current Year Loss</strong>. A £500 P&amp;L profit therefore increases displayed total equity by £500; a loss reduces it.</p>
          <p>To compare the reports, set Profit &amp; Loss Date To to the Balance Sheet As at date and leave Date From blank. That gives both reports journals from the beginning of the available data through the same reporting date.</p>
        </section>

        <section>
          <h2>Why Profit &amp; Loss and Dashboard figures differ</h2>
          <p>The operational <a href="/guides/understanding-the-dashboard">Dashboard</a> does not calculate accounting profit. Its Income vs Bills chart uses gross invoice totals and gross bill totals, includes every payment status, excludes expenses and mileage, and labels the difference between those two series <strong>Difference</strong>.</p>
          <p>Profit &amp; Loss instead reads journals, uses net invoice revenue, includes the net expense portions of bills and ordinary expenses, includes the full mileage claim, and excludes VAT Input and VAT Output. Paid status does not determine P&amp;L inclusion. These deliberate differences mean Dashboard Difference and P&amp;L Net Profit should not be expected to match.</p>
          <p>The Dashboard guide documents its operational calculations in detail; use that guide rather than treating the Dashboard chart as a financial statement.</p>
        </section>

        <section>
          <h2>Worked examples</h2>
          <h3>Invoice, bill, expense and mileage in one period</h3>
          <p>A consultant saves a £600 sales invoice made up of £500 net and £100 VAT. They also save a £240 Software supplier bill made up of £200 net and £40 VAT, a £120 Utilities expense made up of £100 net and £20 VAT, and a £45 mileage claim.</p>
          <ul class="remember-list">
            <li>Sales Revenue: £500 income from the invoice journal.</li>
            <li>Software &amp; Subscriptions: £200 expense from the bill journal.</li>
            <li>Utilities: £100 expense from the ordinary expense journal.</li>
            <li>Travel &amp; Mileage: £45 expense from the mileage journal.</li>
            <li>Total Income: £500.</li>
            <li>Total Expenses: £200 + £100 + £45 = £345.</li>
            <li>Net Profit: £500 − £345 = £155.</li>
          </ul>
          <p>The £100 VAT Output and combined £60 VAT Input do not appear in P&amp;L. Nor do the gross Trade Receivables, Trade Payables and Employee Reimbursements Payable postings.</p>

          <h3>Date range excludes an earlier invoice</h3>
          <p>The same business also has a £300 net invoice dated 30 June. With Date From set to 1 July and the four July records above inside the period, the earlier £300 Sales Revenue is excluded. Total Income remains £500 and Net Profit remains £155. With Date From blank, the earlier invoice is included and the result rises by £300, assuming no other activity.</p>

          <h3>Net loss</h3>
          <p>In another period, Sales Revenue is £100 and the included expense accounts total £240. Simple Books calculates £100 − £240 = minus £140, labels the result <strong>Net Loss</strong>, displays £140.00 and gives the report status Loss.</p>

          <h3>Dashboard Difference is not the P&amp;L result</h3>
          <p>Using only the £600 gross invoice and £240 gross bill above, the Dashboard chart Difference is £360. It ignores the £120 ordinary expense and £45 mileage claim. Profit &amp; Loss uses £500 net revenue less £200, £100 and £45 of expenses, giving £155. The reports differ because their sources and calculations differ.</p>
        </section>

        <section>
          <h2>Common mistakes</h2>
          <ul class="remember-list">
            <li><strong>Using gross invoice totals as P&amp;L income.</strong> The report uses the net Sales Revenue journal credit and excludes VAT Output.</li>
            <li><strong>Expecting VAT Input to be an expense row.</strong> It is currently an Asset account; bills and ordinary expenses contribute their net expense posting.</li>
            <li><strong>Calling Dashboard Difference profit.</strong> It uses gross invoices and bills and omits expenses and mileage.</li>
            <li><strong>Expecting a separate gross-profit subtotal.</strong> The current report calculates only Total Income, Total Expenses and the net result.</li>
            <li><strong>Comparing reports with different dates.</strong> Match the journal period before investigating a difference.</li>
            <li><strong>Expecting Paid status to control inclusion.</strong> The report reads journals, and current status actions do not post settlement entries.</li>
            <li><strong>Recording one cost as both a bill and an expense.</strong> Each source can create its own expense journal and duplicate the P&amp;L cost.</li>
            <li><strong>Deleting a source to remove its accounting effect.</strong> Current delete workflows do not reverse or delete the linked journal.</li>
            <li><strong>Ignoring a ledger-posting warning.</strong> A saved operational record whose journal write failed is absent from P&amp;L.</li>
          </ul>
        </section>

        <section>
          <h2>Current implementation limitations</h2>
          <ul class="remember-list">
            <li><strong>No gross-profit or cost-of-sales section:</strong> all current Expense accounts feed Total Expenses before the single net result.</li>
            <li><strong>One Income account:</strong> the current chart includes Sales Revenue only.</li>
            <li><strong>No direct General Ledger drill-down:</strong> P&amp;L account rows display names and amounts but are not links.</li>
            <li><strong>No manual journals or opening-balance workflow:</strong> the current user interface does not provide those posting tools.</li>
            <li><strong>No P&amp;L export, print, comparative-period or budget columns:</strong> the current page displays one selected journal period.</li>
            <li><strong>Payment status does not post settlement:</strong> marking an invoice, bill or expense Paid does not create Bank entries or clear receivables, payables or reimbursements.</li>
            <li><strong>Deletion does not reverse journals:</strong> deleting an invoice, bill, expense or mileage source does not currently create a reversal or remove its linked journal, so its income or expense can remain.</li>
            <li><strong>A journal write can fail after its source is saved:</strong> the operational record can exist while being absent from journal-based P&amp;L.</li>
            <li><strong>No partial result for malformed data:</strong> an invalid loaded journal or invalid journal date makes the complete report unavailable, even when it falls outside the selected period.</li>
          </ul>
        </section>

        <section>
          <h2>Summary</h2>
          <p>The Simple Books Profit &amp; Loss Statement validates the user’s journals, applies an optional inclusive reporting period, accumulates Trial Balance-style account totals, selects Income and Expense accounts, and calculates Total Income minus Total Expenses. The current Income account is Sales Revenue; expenses can appear in General Expenses, Travel &amp; Mileage, Utilities, Professional Fees and Software &amp; Subscriptions.</p>
          <p>Use the General Ledger to inspect the postings behind a named row, the Trial Balance to understand the wider account set, and the Balance Sheet to see the net result included in displayed equity. Keep the present boundaries in mind: there is no separate gross-profit subtotal, no direct ledger drill-down, no manual-journal workflow, and current payment, deletion and failed-write behaviour can leave journal-based figures different from operational records.</p>
        </section>`
};
