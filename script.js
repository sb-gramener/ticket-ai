let isUrlBasedUpload = false;
import { unsafeHTML } from "https://cdn.jsdelivr.net/npm/lit-html@3/directives/unsafe-html.js";

document.addEventListener("DOMContentLoaded", function () {
    const homeTabButton = document.getElementById("datachat-tab-button");
    loadContent('datachat-tab', homeTabButton);
});

let activeTabButton = null;
const sidebarButtons = document.querySelectorAll('.sidebar .btn');
const tabContent = document.getElementById('tabContent');

const tabButtons = document.querySelectorAll('.assist-tab');
  
    tabButtons.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            switchAssistTab(target);
        });
    });
  
switchAssistTab('summary');

function loadContent(tabId, button) {
    if (activeTabButton) {
        activeTabButton.classList.remove('active');
    }
    button.classList.add('active');
    activeTabButton = button;

    const allContents = tabContent.querySelectorAll('.tab');
    allContents.forEach(content => content.classList.remove('active'));

    const contentDiv = document.getElementById(tabId);
    if (contentDiv) {
        contentDiv.classList.add('active');
    }
}

sidebarButtons.forEach(button => {
    button.addEventListener('click', function (event) {
        event.preventDefault();
        const tabId = this.getAttribute('data-tab');

        if (tabId) {
            loadContent(tabId, this);
        }
    });
});



function hideGlobalLoading() {
    const overlay = document.getElementById("global-loading-overlay");
    if (overlay) {
        overlay.style.display = "none";
    }
}

// ------------------ Custom CSS ------------------
const customStyles = `
  <style>
    /* Plain grey buttons: no background/border, simple grey text */
    .btn-plain {
      background: none !important;
      border: none !important;
      color: #555 !important;
      padding: 0.25rem 0.5rem;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .btn-plain:hover {
      color: #333 !important;
    }
    /* Force table to full width and smaller font */
    table {
      font-size: 0.8rem;
      width: 100% !important;
    }
    /* Remove max-width constraint on narrative sections */
    .narrative {
      max-width: 100% !important;
    }
    /* Styling for visualization suggestion table */
    #visualization-suggestions table {
      margin-top: 10px;
      font-size: 0.8rem;
    }
    #visualization-suggestions input, #visualization-suggestions select {
      font-size: 0.8rem;
    }
    #visualization-output div {
      margin-top: 15px;
      border: 1px solid #ccc;
      padding: 10px;
    }
  </style>
  `;
document.head.insertAdjacentHTML("beforeend", customStyles);

// ------------------ Module Imports ------------------
import sqlite3InitModule from "https://esm.sh/@sqlite.org/sqlite-wasm@3.46.1-build3";
import { render, html } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import { dsvFormat, autoType } from "https://cdn.jsdelivr.net/npm/d3-dsv@3/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import { markedHighlight } from "https://cdn.jsdelivr.net/npm/marked-highlight@2/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11/+esm";



const defaultDB = "mydb.sqlite";
const sqlite3 = await sqlite3InitModule({ printErr: console.error });

// ------------------ DOM Elements ------------------
const $upload = document.getElementById("upload");
const $tablesContainer = document.getElementById("tables-container");
const $sql = document.getElementById("sql");
const $result = document.getElementById("result");
let latestQueryResult = [];
let queryHistory = [];

// ------------------ Markdown Setup ------------------
const marked = new Marked(
    markedHighlight({
        langPrefix: "hljs language-",
        highlight(code, lang) {
            const language = hljs.getLanguage(lang) ? lang : "plaintext";
            return hljs.highlight(code, { language }).value;
        },
    })
);
marked.use({
    renderer: {
        table(header, body) {
            return `<table class="table table-sm">${header}${body}</table>`;
        },
    },
});

// ------------------ Fetch LLM Token (Optional) ------------------


let token;
try {
    token = (
        await fetch("https://llmfoundry.straivedemo.com/token", {
            credentials: "include",
        }).then((r) => r.json())
    ).token;
} catch {
    token = null;
}


render(
    token
        ? html`
        <div class="mb-3 d-none">
            <label for="file" class="btn btn-secondary btn-sm">Upload CSV <i class="bi bi-upload"></i></label>
            <input
                class="form-control"
                type="file"
                id="file"
                name="file"
                accept=".csv,.sqlite3,.db,.sqlite,.s3db,.sl3"
                multiple
                style="display: none;"
            />
        </div>
        `
        : html`<a class="btn btn-primary" href="https://llmfoundry.straivedemo.com/">
          Sign in to upload files
        </a>`,
    $upload
);

function uploadCSV() {
    const fileInput = document.getElementById('file');
    if (fileInput) {
        fetch(`database.csv`)
        .then(response => {
            if (response.ok) {
            return response.blob();
            }
            throw new Error('File not found');
        })
        .then(blob => {
            const csvFile = new File([blob], 'database.csv', { type: 'text/csv' });
    
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(csvFile);
            fileInput.files = dataTransfer.files;
    
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);
            console.log("Database" + " uploaded successfully!");
        })
        .catch(error => {
            console.error(error);
            alert('Failed to upload the file');
        });
    } else {
        console.error("File input element with ID 'file' not found.");
    }
    }
uploadCSV();

const db = new sqlite3.oo1.DB(defaultDB, "c");
const DB = {
    context: "",
    schema: function () {
        let tables = [];
        db.exec("SELECT name, sql FROM sqlite_master WHERE type='table'", {
            rowMode: "object",
        }).forEach((table) => {
            table.columns = db.exec(`PRAGMA table_info(${table.name})`, {
                rowMode: "object",
            });
            tables.push(table);
        });
        return tables;
    },

    upload: async function (file) {
        if (file.name.match(/\.(sqlite3|sqlite|db|s3db|sl3)$/i)) {
            await DB.uploadSQLite(file);
        } else if (file.name.match(/\.csv$/i)) {
            await DB.uploadDSV(file, ",");
        } else if (file.name.match(/\.tsv$/i)) {
            await DB.uploadDSV(file, "\t");
        } else {
            console.log("error", "Unsupported file type", file.name);
        }
    },

    uploadSQLite: async function (file) {
        const fileReader = new FileReader();
        await new Promise((resolve) => {
            fileReader.onload = async (e) => {
                await sqlite3.capi.sqlite3_js_posix_create_file(
                    file.name,
                    e.target.result
                );

                const uploadDB = new sqlite3.oo1.DB(file.name, "r");
                const tables = uploadDB.exec(
                    "SELECT name, sql FROM sqlite_master WHERE type='table'",
                    { rowMode: "object" }
                );
                for (const { name, sql } of tables) {
                    db.exec(`DROP TABLE IF EXISTS "${name}"`);
                    db.exec(sql);
                    const data = uploadDB.exec(`SELECT * FROM "${name}"`, {
                        rowMode: "object",
                    });
                    if (data.length > 0) {
                        const columns = Object.keys(data[0]);
                        const insertSQL = `INSERT INTO "${name}" (${columns
                            .map((c) => `"${c}"`)
                            .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
                        const stmt = db.prepare(insertSQL);
                        db.exec("BEGIN TRANSACTION");
                        for (const row of data) {
                            stmt.bind(columns.map((c) => row[c])).stepReset();
                        }
                        db.exec("COMMIT");
                        stmt.finalize();
                    }
                }
                uploadDB.close();
                resolve();
            };
            fileReader.readAsArrayBuffer(file);
        });
    },

    uploadDSV: async function (file, separator) {
        const fileReader = new FileReader();
        const result = await new Promise((resolve) => {
            fileReader.onload = (e) => {
                const rows = dsvFormat(separator).parse(e.target.result, autoType);
                resolve(rows);
            };
            fileReader.readAsText(file);
        });
        const tableName = file.name
            .slice(0, -4)
            .replace(/[^a-zA-Z0-9_]/g, "_");

        await DB.insertRows(tableName, result);


        if (isUrlBasedUpload) {


            if (1 == 1) {

                const columnDefinitions = [
                    {
                        name: "Classification",
                        type: "TEXT",
                        prompt: `Classify the type of issue described in the ticket into categories like [Technical Issue, Account Issue, Billing, Feedback, Complaint, Request, Others].`
                    },
                    {
                        name: "Priority",
                        type: "TEXT",
                        prompt: `Determine the priority level of this ticket based on urgency and impact. Use [High, Medium, Low].`
                    },
                    {
                        name: "SLA",
                        type: "TEXT",
                        prompt: `Assign an SLA category based on the severity and expected resolution time. Use: [SEV-1 (24 hrs), SEV-2 (48 hrs), SEV-3 (5 days)].`
                    },
                    {
                        name: "Sentiments",
                        type: "TEXT",
                        prompt: `Analyze the sentiment expressed in this ticket. Choose from [Positive, Negative, Neutral, Mixed].`
                    },
                    {
                        name: "UPC",
                        type: "TEXT",
                        prompt: `Identify the UPC (Universal Product Code) if mentioned in the ticket description. If not mentioned, return 'NA'.`
                    },
                    {
                        name: "Summarized_Description",
                        type: "TEXT",
                        prompt: `Summarize the main complaint or request described in the ticket in 1-2 sentences.`
                    },
                    {
                        name: "Triaging",
                        type: "TEXT",
                        prompt: `Identify the team or department to which this ticket should be triaged next based on its content.`
                    },
                    {
                        name: "Resolution",
                        type: "TEXT",
                        prompt: `Suggest a likely resolution approach or the next action required to address the issue described in the ticket.`
                    }
                ];
                

                // First add all columns to the table
                for (const colDef of columnDefinitions) {
                    const alterSQL = `ALTER TABLE [${tableName}] ADD COLUMN [${colDef.name}] ${colDef.type}`;
                    db.exec(alterSQL);
                    queryHistory.push(alterSQL);
                }
                // Then update all columns in one batch
                await updateMultipleColumns(tableName, columnDefinitions);

                drawTables();  // Refresh UI after updates

            } else {
                console.warn("No comments column found. Skipping sentiment analysis.");
            }
        }
    },

    insertRows: async function (tableName, rows) {
        if (!rows.length) return;

        let cols = Object.keys(rows[0]);
        const typeMap = {};
        // console.log(cols);

        for (let col of cols) {
            const sampleValue = rows[0][col];
            // console.log(typeof (sampleValue), sampleValue);
            if (typeof sampleValue === "string") {
                // Check for valid date-time formats
                if (sampleValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    typeMap[col] = "TEXT";
                } else if (sampleValue.match(/^\d{2}:\d{2}:\d{2}$/)) {
                    typeMap[col] = "TEXT";
                } else if (sampleValue.match(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/)) {
                    const dateCol = `${col}_date`;
                    const timeCol = `${col}_time`;

                    typeMap[dateCol] = "TEXT";
                    typeMap[timeCol] = "TEXT";
                } else if (sampleValue.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
                    const dateCol = `${col}_date`;
                    const timeCol = `${col}_time`;

                    typeMap[dateCol] = "TEXT";
                    typeMap[timeCol] = "TEXT";
                } else {
                    typeMap[col] = "TEXT";
                }
            } else if (typeof sampleValue === "number") {
                typeMap[col] = Number.isInteger(sampleValue) ? "INTEGER" : "REAL";
            } else if (typeof sampleValue === "boolean") {
                typeMap[col] = "INTEGER";
            } else if (sampleValue instanceof Date) {
                typeMap[col] = "TEXT";
            }
        }

        // Create SQL table with modified columns
        const createSQL = `CREATE TABLE IF NOT EXISTS ${tableName} (
            ${Object.keys(typeMap).map((col) => `"${col}" ${typeMap[col]}`).join(", ")}
        )`;
        db.exec(createSQL);

        // Prepare insert statement
        let newCols = Object.keys(typeMap);
        const insertSQL = `INSERT INTO ${tableName} (${newCols.map((c) => `"${c}"`).join(", ")}) VALUES (${newCols.map(() => "?").join(", ")})`;

        const stmt = db.prepare(insertSQL);
        db.exec("BEGIN TRANSACTION");

        for (const row of rows) {
            let values = [];
            for (let col of newCols) {
                if (col.endsWith("_date") || col.endsWith("_time")) {
                    let originalCol = col.replace(/_(date|time)$/, "");
                    if (row[originalCol]) {
                        // Adjusted to support both formats
                        let regexDateTime = /^(?:(\d{4}-\d{2}-\d{2})|(\d{2}-\d{2}-\d{4})) (\d{2}:\d{2})(?::\d{2})?$/;
                        let matches = row[originalCol].match(regexDateTime);
                        if (matches) {
                            let datePart = matches[1] || matches[2]; // YYYY-MM-DD or DD-MM-YYYY
                            let timePart = matches[3];
                            // For Date Formatting need to swap if from DD-MM-YYYY to YYYY-MM-DD
                            if (matches[2]) {
                                const [day, month, year] = datePart.split('-');
                                datePart = `${year}-${month}-${day}`; // convert to YYYY-MM-DD
                            }

                            if (col.endsWith("_date")) {
                                values.push(datePart);
                            } else if (col.endsWith("_time")) {
                                values.push(timePart);
                            }
                        } else {
                            console.warn(`Invalid date format for column: ${originalCol}, Value: ${row[originalCol]}`);
                            values.push(null); // Handle as necessary
                        }
                    } else {
                        values.push(null);
                    }
                } else {
                    values.push(
                        row[col] instanceof Date
                            ? row[col].toISOString().split('T')[0] // Extract only the date part (yyyy-mm-dd)
                            : row[col]
                    );
                }
            }
            stmt.bind(values).stepReset();
        }

        db.exec("COMMIT");
        stmt.finalize();
        if (typeof db !== 'undefined' && db) {
            // console.log("DB ready, setting up ticket table.");
            fetchTickets(); // Fetch data and perform initial render
            setupEventListeners();
       } else {
           console.error("SQLite DB object 'db' not found. Cannot initialize ticket table.");
           render(html`<tr><td colspan="9" class="text-center p-5 text-danger">Database connection not available.</td></tr>`, tableBody);
       }
    }
}



// ------------------ Handle File Selection ------------------
$upload.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    for (let file of files) {
        await DB.upload(file);
    }
    drawTables();
});

// ------------------ Draw Tables & Column UI ------------------
async function drawTables() {
    const schema = DB.schema();
    if (!schema.length) {
        render(html`<p>No tables available.</p>`, $tablesContainer);
        return;
    }
    const content = html`
      <div class="accordion narrative mx-auto" id="table-accordion">
        ${schema.map(({ name, sql, columns }) => {
        return html`
            <div class="accordion-item my-2">
              <h2 class="accordion-header">
                <button
                  class="accordion-button collapsed"
                  type="button"
                  data-bs-toggle="collapse"
                  data-bs-target="#collapse-${name}"
                  aria-expanded="false"
                  aria-controls="collapse-${name}"
                >
                  ${name}
                </button>
              </h2>
              <div
                id="collapse-${name}"
                class="accordion-collapse collapse"
                data-bs-parent="#table-accordion"
              >
                <div class="accordion-body">
                  <pre style="white-space: pre-wrap">${sql}</pre>
                  <!-- Table of columns -->
                  
                </div>
              </div>
            </div>
          `;
    })}
      </div>
      <!-- Query form -->
      <form class="narrative mx-auto " id="question-form">
        <div class="mb-3 d-none">
          <label for="context" class="form-label fw-bold">
            Provide context about your dataset:
          </label>
          <textarea class="form-control" name="context" id="context" rows="3">
  ${DB.context}</textarea>
        </div>
        <div class="mb-3 d-flex align-items-center">
  <textarea class="form-control me-2" name="query" id="query" rows="1" placeholder="Ask a question"></textarea>
  <button type="submit" class="btn btn-primary">Submit</button>
</div>

      </div>
      </form>
    `;
    render(content, $tablesContainer);
    const $forms = $tablesContainer.querySelectorAll("form");
    $forms.forEach(($form) => {
        if ($form.id === "question-form") {
            $form.addEventListener("submit", onQuerySubmit);
        }
    });
}

// ------------------ Query Form Submission ------------------
async function onQuerySubmit(e) {
    e.preventDefault();
    // showGlobalLoading();
    try {
        const formData = new FormData(e.target);
        const query = formData.get("query");
        DB.context = formData.get("context") || "";
        render("", $result);

        // Use LLM to generate SQL for the main query.
        const result = await llm({
            system: `You are an expert SQLite query writer. The user has a SQLite dataset.
  
  ${DB.context}
  
  The schema is:
  
  ${DB.schema().map(({ sql }) => sql).join("\n\n")}
  
  Answer the user's question by describing steps, then output final SQL code (SQLite).`,
            user: query,
        });
        // render(html`${unsafeHTML(marked.parse(result))}`, $sql);

        const sqlCode = result.match(/```.*?\n([\s\S]*?)```/);
        const extractedSQL = sqlCode ? sqlCode[1] : result;
        queryHistory.push("Main Query:\n" + extractedSQL);
        try {
            const rows = db.exec(extractedSQL, { rowMode: "object" });
            if (rows.length > 0) {
                latestQueryResult = rows;

                render(html`
        
          <div style="padding: 10px; max-height:60%; overflow-y: auto;"">
            ${renderTable(rows.slice(0, 100))}
          </div>
        <div class="accordion mt-3" id="resultAccordion">
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#summaryCollapse">
                Download Results
              </button>
            </h2>
            <div id="summaryCollapse" class="accordion-collapse collapse">
              <div class="accordion-body">
                <button id="download-csv" class="btn-plain">
                  <i class="bi bi-filetype-csv"></i> Download CSV
                </button>
              </div>
            </div>
          </div>
          
        </div>
      `, $result);
                document.getElementById("download-csv").addEventListener("click", () => {
                    download(dsvFormat(",").format(latestQueryResult), "datachat.csv", "text/csv");
                });
            }
            else {
                render(html`<p>No results found.</p>`, $result);
            }
        } catch (err) {
            render(html`<div class="alert alert-danger">${err.message}</div>`, $result);
        }
    } finally {
        hideGlobalLoading();
    }
}

async function llm({ system, user, schema }) {
    const response = await fetch("https://llmfoundry.straivedemo.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}:datachat` },
        body: JSON.stringify({
            model: "gpt-4.1-mini",
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            temperature: 0,
            ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema } } } : {}),
        }),
    }).then((r) => r.json());
    if (response.error) return response;
    const content = response.choices?.[0]?.message?.content;
    try {
        return schema ? JSON.parse(content) : content;
    } catch (e) {
        return { error: e };
    }
}


async function updateMultipleColumns(table, columnDefinitions) {

    try {

        const data = db.exec(`SELECT rowid, * FROM [${table}]`, { rowMode: "object" });

        if (!data.length) {
            return;
        }

        const batchSize = Math.min(100, Math.max(5, Math.ceil(data.length / 250)));
        const columns = Object.keys(data[0]).filter(c => c !== "rowid");
        const commentField = columns.find(c =>
            c.toLowerCase().includes('Description')
        );

        const updateStmt = db.prepare(
            `UPDATE [${table}] SET ${columnDefinitions.map(c => `[${c.name}]=?`).join(', ')} WHERE rowid=?`
        );

        const batchPromises = [];
        const totalBatches = Math.ceil(data.length / batchSize);
        let batchesCompleted = 0;

        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);

            batchPromises.push((async () => {
                const batchData = batch.map(row => {
                    const rowData = { rowid: row.rowid };
                    if (commentField) rowData[commentField] = row[commentField];
                    columns.forEach(c => { if (c !== commentField) rowData[c] = row[c]; });
                    return rowData;
                });

                const batchResponse = await getLLMResponse(columnDefinitions, batchData);
                if (!batchResponse) return;

                try {
                    const bulkValues = batchResponse.map(row => {
                        const rowValues = columnDefinitions.map(c => {
                            let value = row.values[c.name];
                            return value !== undefined ? (typeof value === "object" ? JSON.stringify(value) : value) : null;
                        });
                        rowValues.push(row.rowid);
                        return rowValues;
                    });

                    // console.log("Bulk Values before transaction:", bulkValues);

                    // Execute in transaction
                    db.exec("BEGIN TRANSACTION");
                    try {
                        bulkValues.forEach(values => {
                            // console.log("Binding values:", values);
                            updateStmt.bind(values).stepReset();
                        });

                        db.exec("COMMIT");
                    } catch (err) {
                        db.exec("ROLLBACK");
                        console.error(`Error during batch update:`, err);
                    }

                } catch (err) {
                    console.error(` Batch ${i}-${i + batchSize} failed:`, err);
                    console.log("warning", "Batch Failed", `Batch ${i + batchSize} failed, continuing with next batch`);
                } finally {
                    batchesCompleted++;

                }

            })());
        }

        await Promise.all(batchPromises);
        updateStmt.finalize();

    } catch (err) {
        console.error("Update Error:", err);
        console.log("danger", "Update Error", `Failed to update columns: ${err.message}`);
    }
}


async function getLLMResponse(columnDefinitions, batchData) {
    try {
        const columnPrompts = columnDefinitions.map(col => ({
            name: col.name,
            prompt: col.prompt
        }));

        const response = await llm({
            system: `You are processing agent to extract multiple insights at once.
For EACH row, analyze the comment and return values for all requested columns.

Column definitions:
${JSON.stringify(columnPrompts, null, 2)}

Return your results in this exact JSON format:
[
  {
    "rowid": 1,
    "values": {
      "column1": "value1",
      "column2": "value2",
      ...
    }
  },
  ...
]

IMPORTANT: Return ONLY valid JSON. No other text or explanation.`,
            user: JSON.stringify(batchData, null, 1)
        });

        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
        const jsonText = jsonMatch[1].trim();
        const parsed = JSON.parse(jsonText);

        if (!Array.isArray(parsed)) {
            throw new Error("LLM did not return an array");
        }
        return parsed;
    } catch (err) {
        console.error("LLM Error:", err);
        console.log("danger", "LLM Error", `Failed to process batch: ${err.message}`);
        return null;
    }
}


function renderTable(data) {
    if (!data.length) return html`<p>No data.</p>`;
    const cols = Object.keys(data[0]);
    return html`
      <table class="table table-striped table-hover">
        <thead>
          <tr>
            ${cols.map((c) => html`<th>${c}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${data.map((row) => html`
            <tr>
              ${cols.map((c) => html`<td>${row[c]}</td>`)}
            </tr>
          `)}
        </tbody>
      </table>
    `;
}

function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

// --- Ticket Table Logic ---
const ticketTableContainer = document.getElementById('ticket-table');
const ticketTableContent = document.getElementById('ticket-table-content'); // Target the inner container
const tableBody = document.getElementById('ticket-table-body');

// --- State Variables ---
let tickets = []; // Full dataset (or current view if server-side pagination)
let filteredTickets = [];
let currentSort = { col: '"Ticket status"', dir: 'ASC' }; // Default sort
let currentFilters = {
    status: 'all', // From summary buttons
    classification: 'all',
    sla: 'all',
    assignedTo: 'all',
    search: ''
};
let currentPage = 1;
const itemsPerPage = 10; // Match the image's pagination hint (adjust as needed)
let totalTickets = 0;
let totalFilteredTickets = 0;

// --- Helper Functions for Rendering Cells ---

// Function to format date string (adjust based on actual DB format)
function formatTicketDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        // Attempt to parse common formats. Adjust regex/parsing as needed.
        // Example: Assuming "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
        const date = new Date(dateStr.replace(' ', 'T') + 'Z'); // Treat as UTC if no timezone
        if (isNaN(date.getTime())) {
             // Try another format like "Wed 9 Apr, 11:22 AM" - more complex parsing needed
             // For simplicity, return original if parsing fails broadly
             return dateStr;
        }

        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        console.warn("Date formatting error for:", dateStr, e);
        return dateStr; // Fallback
    }
}


function renderStatus(status) {
    let statusClass = 'status-default';
    if (status) {
        const lowerStatus = status.toLowerCase();
        if (lowerStatus.includes('resolved')) statusClass = 'status-resolved';
        else if (lowerStatus.includes('progress')) statusClass = 'status-in-progress';
        else if (lowerStatus.includes('closed')) statusClass = 'status-closed';
        // Add more conditions as needed
    }

    return html`
        <span class="status-badge ${statusClass}">
            <span class="status-dot"></span>
            ${status || 'N/A'}
        </span>`;
}

function renderSLA(sla) {
    let slaClass = 'sla-on-time'; // Default
    let slaText = sla || 'On Time'; // Default text
    let barStyle = 'width: 100%; background-color: #28a745;'; // Default green

    if (sla) {
        const lowerSla = sla.toLowerCase();
        if (lowerSla.includes('left')) { // e.g., "2 hours left"
            slaClass = 'sla-due-soon';
            slaText = sla;
            barStyle = 'width: 60%; background: linear-gradient(to right, #ffc107, #dc3545);'; // Yellow-red gradient
        } else if (lowerSla.includes('past') || lowerSla.includes('overdue')) { // e.g., "Past 2 hours"
            slaClass = 'sla-overdue';
            slaText = sla;
            barStyle = 'width: 100%; background-color: #dc3545;'; // Red
        } else if (lowerSla.includes('on time')) {
             slaClass = 'sla-on-time';
             slaText = 'On Time';
             barStyle = 'width: 100%; background-color: #28a745;'; // Green
        }
        // Add more specific conditions if needed
    }

    return html`
        <div class="sla-status ${slaClass}">
            <div class="sla-bar">
                <div class="sla-bar-inner" style="${barStyle}"></div>
            </div>
            <span class="sla-text">${slaText}</span>
        </div>`;
}

function renderPriority(priority) {
    let priorityClass = 'priority-default';
     if (priority) {
        const lowerPriority = priority.toLowerCase();
        if (lowerPriority === 'low') priorityClass = 'priority-low';
        else if (lowerPriority === 'medium') priorityClass = 'priority-medium';
        else if (lowerPriority === 'urgent') priorityClass = 'priority-urgent';
        else if (lowerPriority === 'high') priorityClass = 'priority-high';
     }

    return html`
        <span class="priority-badge ${priorityClass}">
            <span class="priority-dot"></span>
            ${priority || 'N/A'}
        </span>`;
}

// --- Main Rendering Function ---
function renderTicketTable() {
    if (!tableBody) {
        console.error("Table body not found!");
        return;
    }

    // --- Apply Filtering ---
    filteredTickets = tickets.filter(ticket => {
        const searchLower = currentFilters.search.toLowerCase();
        const matchSearch = !searchLower ||
            (ticket["Ticket ID"]?.toString().toLowerCase().includes(searchLower)) ||
            (ticket.description?.toLowerCase().includes(searchLower)) ||
            (ticket.Classification?.toLowerCase().includes(searchLower)) ||
            (ticket["Ticket status"]?.toLowerCase().includes(searchLower)) ||
            (ticket["Assignee name"]?.toLowerCase().includes(searchLower)) ||
            (ticket.SLA?.toLowerCase().includes(searchLower)) ||
            (ticket.Priority?.toLowerCase().includes(searchLower));

        const matchStatus = currentFilters.status === 'all' || (ticket["Ticket status"] && ticket["Ticket status"].toLowerCase() === currentFilters.status.toLowerCase());
        // Special case for 'Unclassified' if it's a classification
         const matchClassification = currentFilters.classification === 'all' ||
             (currentFilters.classification === 'Unclassified' && !ticket.Classification) || // Handle actual unclassified
             (ticket.Classification && ticket.Classification === currentFilters.classification);

        // Handle 'Unclassified' potentially being a status filter from summary button
        const matchStatusOrClassification = (currentFilters.status === 'Unclassified')
            ? (!ticket.Classification || (ticket["Ticket status"] && ticket["Ticket status"].toLowerCase() === 'unclassified')) // Check both possibilities
            : matchStatus;


        const matchSla = currentFilters.sla === 'all' || (ticket.SLA && ticket.SLA === currentFilters.sla); // Simple match for now
        const matchAssigned = currentFilters.assignedTo === 'all' || (ticket["Assignee name"] && ticket["Assignee name"] === currentFilters.assignedTo);

        return matchSearch && matchStatusOrClassification && matchClassification && matchSla && matchAssigned;

    });

    totalFilteredTickets = filteredTickets.length;

    // --- Apply Sorting ---
    // Note: SQLite sorting might be case-sensitive depending on collation. JS sort is generally case-sensitive.
    // For robust sorting, ideally do it in SQL if possible, especially for large datasets.
    // This JS sort is for demonstration on the fetched data.
    const sortCol = currentSort.col.replace(/"/g, ''); // Remove quotes for JS property access
    filteredTickets.sort((a, b) => {
        let valA = a[sortCol];
        let valB = b[sortCol];

        // Basic type handling for sorting
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA === null || valA === undefined) valA = -Infinity; // Treat nulls as lowest
        if (valB === null || valB === undefined) valB = -Infinity;

        let comparison = 0;
        if (valA > valB) {
            comparison = 1;
        } else if (valA < valB) {
            comparison = -1;
        }
        return currentSort.dir === 'DESC' ? (comparison * -1) : comparison;
    });

    // --- Apply Pagination ---
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedTickets = filteredTickets.slice(startIndex, endIndex);

    // --- Render Rows ---
    const rows = paginatedTickets.map(ticket => html`
        <tr>
            <td><input type="checkbox" class="form-check-input ticket-checkbox" data-ticket-id="${ticket['Ticket ID']}"></td>
            <td style="color:#2365ff; cursor:pointer">${ticket['Ticket ID']}</td>
            <td>
  <div class="clamped-description" data-ticket-id="${ticket['Ticket ID']}">
    ${ticket.description}
  </div>
  <div class="expand-toggle">▼ Show more</div>
</td>


            <td>${ticket.UPC || 'N/A'}</td>
            <td>${ticket.Classification || 'N/A'}</td>
            <td>${renderStatus(ticket['Ticket status'])}</td>
            <td>${formatTicketDate(ticket['Ticket created - Date'])}</td> <!-- Using created date -->
            <td>${ticket['Assignee name'] || 'N/A'}</td>
            <td>${renderSLA(ticket.SLA)}</td>
            <td>${renderPriority(ticket.Priority)}</td>
        </tr>
    `);

    render(rows.length ? rows : html`<tr><td colspan="9" class="text-center p-5">No tickets match the current filters.</td></tr>`, tableBody);
    attachExpandToggleListeners();

    // --- Update UI Elements ---
    updatePaginationControls();
    updateSortIndicators();
    updateFilterDropdownLabels();
    updateSummaryCounts(); // Update counts based on the *full* dataset
}

function attachExpandToggleListeners() {
    const toggleElements = document.querySelectorAll('.expand-toggle');

    toggleElements.forEach(toggle => {
        const descDiv = toggle.previousElementSibling;

        // Check if clamping actually applies
        const isOverflowing = descDiv.scrollHeight > descDiv.clientHeight + 1;

        if (!isOverflowing) {
            toggle.style.display = 'none'; // Hide toggle if not clamped
        }

        // Add click handler if visible
        toggle.addEventListener('click', () => {
            const isExpanded = descDiv.classList.contains('expanded');

            if (isExpanded) {
                descDiv.classList.remove('expanded');
                toggle.textContent = '▼ Show more';
            } else {
                descDiv.classList.add('expanded');
                toggle.textContent = '▲ Show less';
            }
        });
    });
}


// --- Data Fetching and Initialisation ---
async function fetchTickets() {
    // console.log("Fetching tickets...");
    try {
        // Adjust SQL query as needed - fetch all columns required
        const sql = `SELECT * FROM database`;
        tickets = db.exec(sql, { rowMode: 'object' });
        totalTickets = tickets.length;
        // console.log(`Fetched ${totalTickets} tickets.`);

        // Populate dynamic filters
        populateDropdown('Classification', '.classification-dropdown-menu');
        populateDropdown('"Assignee name"', '.assigned-dropdown-menu'); // Quote if needed

        // Initial render
        currentPage = 1;
        renderTicketTable();
        setupRowClickListener();

    } catch (err) {
        console.error("Error fetching tickets:", err);
        render(html`<tr><td colspan="9" class="text-center p-5 text-danger">Error loading tickets: ${err.message}</td></tr>`, tableBody);
        tickets = [];
        totalTickets = 0;
        updatePaginationControls(); // Ensure controls are disabled on error
        updateSummaryCounts();
    }
}

// --- Populate Dropdowns Dynamically ---
function populateDropdown(columnName, menuSelector) {
    const menu = ticketTableContent.querySelector(menuSelector);
    if (!menu) return;

    try {
        // Fetch distinct non-null values, limit for performance if necessary
        const distinctValues = db.exec(`SELECT DISTINCT ${columnName} FROM database WHERE ${columnName} IS NOT NULL ORDER BY ${columnName} LIMIT 100`, { rowMode: 'array' });

        // Clear existing items except 'All'
        menu.querySelectorAll('li:not(:first-child)').forEach(li => li.remove());

        distinctValues.forEach(row => {
            const value = row[0];
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.className = 'dropdown-item';
            a.href = '#';
            a.dataset.value = value;
            a.textContent = value;
            li.appendChild(a);
            menu.appendChild(li);
        });
    } catch (err) {
        console.error(`Error populating dropdown for ${columnName}:`, err);
    }
}


// --- Update UI Helper Functions ---
function updatePaginationControls() {
    const paginationInfos = ticketTableContent.querySelectorAll('.pagination-info');
    const prevButtons = ticketTableContent.querySelectorAll('.pagination-prev');
    const nextButtons = ticketTableContent.querySelectorAll('.pagination-next');

    const totalPages = Math.ceil(totalFilteredTickets / itemsPerPage);
    const startItem = totalFilteredTickets === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalFilteredTickets);

    paginationInfos.forEach(info => {
        info.textContent = `${startItem}-${endItem} of ${totalFilteredTickets}`;
    });

    prevButtons.forEach(btn => btn.disabled = currentPage <= 1);
    nextButtons.forEach(btn => btn.disabled = currentPage >= totalPages);
}

function updateSortIndicators() {
    ticketTableContent.querySelectorAll('thead th.sortable').forEach(th => {
        th.classList.remove('active-sort');
        const icon = th.querySelector('i.bi');
        if (icon) icon.className = 'bi'; // Reset icon

        if (th.dataset.sortCol === currentSort.col) {
            th.classList.add('active-sort');
            if (icon) {
                icon.classList.add(currentSort.dir === 'ASC' ? 'bi-arrow-up' : 'bi-arrow-down');
            } else {
                 // Add icon if missing
                 th.insertAdjacentHTML('beforeend', ` <i class="bi ${currentSort.dir === 'ASC' ? 'bi-arrow-up' : 'bi-arrow-down'}"></i>`);
            }
        }
    });
}

function updateFilterDropdownLabels() {
    const classBtn = ticketTableContent.querySelector('.classification-filter-btn');
    if (classBtn) classBtn.textContent = currentFilters.classification === 'all' ? 'All Categories' : currentFilters.classification;

    const slaBtn = ticketTableContent.querySelector('.sla-filter-btn');
     if (slaBtn) slaBtn.textContent = currentFilters.sla === 'all' ? 'SLA Status All' : `SLA: ${currentFilters.sla}`;

    const assignedBtn = ticketTableContent.querySelector('.assigned-filter-btn');
     if (assignedBtn) assignedBtn.textContent = currentFilters.assignedTo === 'all' ? 'Assigned To All' : currentFilters.assignedTo;
}

function updateSummaryCounts() {
    // Calculate counts based on the *full* original dataset (`tickets`)
    const counts = {
        all: tickets.length,
        new: tickets.filter(t => t['Ticket status']?.toLowerCase() === 'new').length, // Adjust status name if needed
        'in-progress': tickets.filter(t => t['Ticket status']?.toLowerCase() === 'in-progress').length,
        unclassified: tickets.filter(t => !t.Classification).length // Count tickets with no classification
    };

    document.getElementById('count-all').textContent = counts.all;
    document.getElementById('count-new').textContent = counts.new;
    document.getElementById('count-in-progress').textContent = counts['in-progress'];
    document.getElementById('count-unclassified').textContent = counts.unclassified;
}


// --- Event Listeners ---
function setupEventListeners() {
    if (!ticketTableContent) return;

    // Sorting
    ticketTableContent.querySelectorAll('thead th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const newSortCol = th.dataset.sortCol;
            let newSortDir = 'ASC';

            if (currentSort.col === newSortCol) {
                newSortDir = currentSort.dir === 'ASC' ? 'DESC' : 'ASC';
            }

            currentSort = { col: newSortCol, dir: newSortDir };
            currentPage = 1; // Reset to first page on sort
            renderTicketTable();
        });
    });

    // Search
    const searchInput = ticketTableContent.querySelector('.search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentFilters.search = e.target.value;
            currentPage = 1;
            renderTicketTable();
        });
    }

    // Refresh Button
    const refreshBtn = ticketTableContent.querySelector('.refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // Reset filters and sort? Or just refetch? Let's refetch.
            fetchTickets(); // Re-fetch data from DB
        });
    }

    // Pagination
    ticketTableContent.querySelectorAll('.pagination-prev').forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderTicketTable();
            }
        });
    });
    ticketTableContent.querySelectorAll('.pagination-next').forEach(btn => {
         btn.addEventListener('click', () => {
            const totalPages = Math.ceil(totalFilteredTickets / itemsPerPage);
             if (currentPage < totalPages) {
                 currentPage++;
                 renderTicketTable();
             }
         });
     });

    // Filter Dropdowns (using event delegation on the container)
    ticketTableContent.addEventListener('click', (e) => {
        const target = e.target;
        if (target.matches('.classification-dropdown-menu .dropdown-item')) {
            e.preventDefault();
            currentFilters.classification = target.dataset.value;
            currentPage = 1;
            renderTicketTable();
        } else if (target.matches('.sla-dropdown-menu .dropdown-item')) {
             e.preventDefault();
             currentFilters.sla = target.dataset.value;
             currentPage = 1;
             renderTicketTable();
        } else if (target.matches('.assigned-dropdown-menu .dropdown-item')) {
             e.preventDefault();
             currentFilters.assignedTo = target.dataset.value;
             currentPage = 1;
             renderTicketTable();
        }
    });

     // Summary Filter Buttons
     ticketTableContent.querySelectorAll('.filter-summary-btn').forEach(btn => {
         btn.addEventListener('click', (e) => {
             // Deactivate others
             ticketTableContent.querySelectorAll('.filter-summary-btn').forEach(b => b.classList.remove('active'));
             // Activate clicked
             e.currentTarget.classList.add('active');

             const statusFilter = e.currentTarget.dataset.statusFilter;

             // Reset specific filters when using summary buttons
             currentFilters.classification = 'all';
             currentFilters.sla = 'all';
             currentFilters.assignedTo = 'all';
             currentFilters.search = '';
             if(searchInput) searchInput.value = ''; // Clear search input visually

             // Apply the summary filter (might be status or a special case like 'unclassified')
             currentFilters.status = statusFilter; // This will be handled in the main filter logic

             currentPage = 1;
             renderTicketTable();
         });
     });

     // Select All Checkbox
     const selectAllCheckbox = document.getElementById('select-all-tickets');
     if (selectAllCheckbox) {
         selectAllCheckbox.addEventListener('change', (e) => {
             tableBody.querySelectorAll('.ticket-checkbox').forEach(checkbox => {
                 checkbox.checked = e.target.checked;
             });
         });
     }

     // Individual Checkbox changes -> uncheck Select All
     tableBody.addEventListener('change', (e) => {
         if (e.target.classList.contains('ticket-checkbox')) {
             if (!e.target.checked && selectAllCheckbox) {
                 selectAllCheckbox.checked = false;
             }
         }
     });

}

async function summaryllm({ system, user }) {
    const response = await fetch("https://llmfoundry.straivedemo.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}:summary`
      },
      credentials: "include",
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      }),
    });
  
    const data = await response.json();
  
    if (!response.ok) {
      throw new Error(`LLM request failed: ${data.error?.message || response.statusText}`);
    }
  
    return data.choices?.[0]?.message?.content || "";
  }
  
  async function generateEmailDraft(ticketData, summary) {
    const systemContent = `
        You are an assistant that drafts professional emails based on ticket data and summaries. 
        The email should be formal, clear, and concise, providing relevant details and a clear call to action.
    `;
    
    const userContent = `
        Please generate a professional email draft based on the following ticket data and summary:
        
        Tickets Data: ${JSON.stringify(ticketData, null, 2)}
        Summary: ${summary}
    `;
    
    try {
        const emailDraft = await summaryllm({ system: systemContent, user: userContent });
        displayEmailDraft(marked.parse(emailDraft));
    } catch (error) {
        console.error("Error generating email draft:", error);
    }
}

function displayEmailDraft(emailDraft) {
    const emailContentDiv = document.getElementById('email-llm-content');
    
    if (emailContentDiv) {
        emailContentDiv.innerHTML = `
            <p>${emailDraft}</p>
        `;
    }
}


async function setupRowClickListener() {
    if (!tableBody) return;
    const emailContentDiv = document.getElementById('email-llm-content');
    const llmContentContainer = document.getElementById('llm-content');
    const assistHistoryTab = document.getElementById('assist-history-tab');
    tableBody.addEventListener('click', async (e) => {
        const td = e.target.closest('td');
        const tr = e.target.closest('tr');
        if (!td || !tr) return;
        switchAssistTab('summary');
        // Make sure the click was specifically on the Ticket ID cell (second column)
        const cells = Array.from(tr.children);
        if (td !== cells[1]) return;

        const ticketId = td.textContent?.trim();
        if (!ticketId) return;

        const ticket = tickets.find(t => t['Ticket ID']?.toString() === ticketId);
        if (!ticket) return;

        // Show loading spinners
        emailContentDiv.innerHTML = `
            <div class="text-muted fst-italic p-3">
            <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Generating Draft...
            </div>
        `;
        llmContentContainer.innerHTML = `
            <div class="text-muted fst-italic p-3">
            <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Analyzing...
            </div>
        `;

        assistHistoryTab.innerHTML = `
            <div class="text-muted fst-italic p-3">
            <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Looking for similar tickets...
            </div>
        `;

        // Hide table and filters
        document.querySelector('.filters-row1').style.display = 'none';
        document.querySelector('.filters-row2').style.display = 'none';
        const ticketTable = document.querySelector('#ticket-table-content .table-responsive > table');
        if (ticketTable) ticketTable.style.display = 'none';
        const paginationControls = document.querySelectorAll('#ticket-table-content .pagination-info, #ticket-table-content .pagination-prev, #ticket-table-content .pagination-next');
        paginationControls.forEach(el => el.style.display = 'none');

        // Show row detail
        const rowDescription = document.getElementById('row-description');
        if (rowDescription) rowDescription.style.display = 'flex';
        const detailContent = document.getElementById('row-detail-content');
        if (detailContent) {
            detailContent.innerHTML = renderTicketDetail(ticket);
        }

        const llmResponse = await summaryllm({
            system: "You are an assistant that helps generate summaries and action items for tickets. Process all provided fields and create a actionable summary and list of action items. Respond in markdown content and dont use big headings. Try to use smaller headings like h6 or just bold headings and a professional response.",
            user: `Here is the full ticket data: ${JSON.stringify(ticket)}.\nPlease summarize the ticket and provide action items.`,
        });

        const html_content = marked.parse(llmResponse);
        if (llmContentContainer) {
            llmContentContainer.innerHTML = html_content;
        }
        generateEmailDraft(ticket, llmResponse);
        const masterTicketId = ticket['Ticket ID'];
        const classification = ticket['Classification'];
        let relatedTickets = [];

        try {
            const query = `SELECT * FROM database WHERE Classification = ? AND "Ticket ID" != ?`;
            relatedTickets = db.exec(query, {
                rowMode: 'object',
                bind: [classification, masterTicketId],
            });
        } catch (err) {
            console.error("Error fetching related tickets:", err);
        }
        const similar_ticket_response = await summaryllm({
            system: `You are a support assistant that compares helpdesk tickets. Your task is to identify the top 5 tickets most similar in description and concern to a given master ticket.`,
            user: `
        Master Ticket:
        ${JSON.stringify({
            id: masterTicketId,
            description: ticket['Description'],
            concern: ticket['Concern']
        }, null, 2)}
        
        Related Tickets:
        ${JSON.stringify(relatedTickets, null, 2)}
        
        Instructions:
        - Compare using the following fields like Ticket group, Description, Classification, Priority, SLA, Sentiments,	Summarized_Description, Triaging, Resolution,.
        - Do not include the master ticket in results.
        - Return only the top 5 most similar tickets by Ticket ID.
        - Output format: Array of 5 Ticket IDs, ordered by relevance.
        `
        });
        
        let ticketIdsArray = similar_ticket_response.trim();

        // Clean the response string by removing the surrounding brackets and extra spaces
        ticketIdsArray = ticketIdsArray.replace(/[\[\]\s]/g, ''); // Remove brackets and spaces

        // Now, split the string by commas to get an array of IDs
        ticketIdsArray = ticketIdsArray.split(',').map(id => id.trim()); // Ensure each ID is trimmed

        // console.log("Cleaned ticketIdsArray:", ticketIdsArray);

        // Now, proceed with the rest of the logic
        const similarTicketDetails = ticketIdsArray.map(ticketId => {
            return tickets.find(t => t['Ticket ID']?.toString() === ticketId.toString());
        }).filter(t => t); // Filter out any undefined values

        // Debugging the similarTicketDetails
        // console.log("Similar ticket details:", similarTicketDetails);

        // Create the HTML for the table
        let tableHTML = `
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>Ticket ID</th>
                        <th>Summarized Description</th>
                        <th>Resolution</th>
                    </tr>
                </thead>
                <tbody>
        `;

        similarTicketDetails.forEach(ticket => {
            tableHTML += `
                <tr>
                    <td style="color:#2365ff; cursor:pointer">${ticket['Ticket ID']}</td>
                    <td>${ticket['Summarized_Description'] || 'N/A'}</td>
                    <td>${ticket['Resolution'] || 'N/A'}</td>
                </tr>
            `;
        });

        tableHTML += `</tbody></table>`;

        assistHistoryTab.innerHTML = tableHTML;
    });

    // Delegated click listener on similar ticket table
    assistHistoryTab.addEventListener('click', (event) => {
        const clickedCell = event.target.closest('td');
        const clickedRow = event.target.closest('tr');
        if (!clickedCell || !clickedRow) return;

        // Ensure it's the first column (Ticket ID)
        const cellIndex = Array.from(clickedRow.children).indexOf(clickedCell);
        if (cellIndex !== 0) return; // Only react to first column clicks

        const clickedId = clickedCell.textContent.trim();
        const ticketData = tickets.find(t => t['Ticket ID']?.toString() === clickedId);
        if (!ticketData) return;

        // Hide the similar tickets table
        assistHistoryTab.style.display = 'none';

        // Create or show a detail container
        let relatedDetailContainer = document.getElementById('related-ticket-detail');
        if (!relatedDetailContainer) {
            relatedDetailContainer = document.createElement('div');
            relatedDetailContainer.id = 'related-ticket-detail';
            relatedDetailContainer.style.border = '1px solid #ccc';
            relatedDetailContainer.style.borderRadius = '0.25rem';
            relatedDetailContainer.style.padding = '10px';
            relatedDetailContainer.style.marginTop = '10px';
            document.getElementById('assist-history-tab').parentElement.appendChild(relatedDetailContainer);
        }
{/* <h6 style="margin: 0;">Ticket ID: ${ticketData['Ticket ID']}</h6> */}
        relatedDetailContainer.innerHTML = `
            <div style="display: flex; justify-content: flex-end; align-items: center;">
                <button id="close-related-ticket" class="btn btn-sm btn-outline-secondary" style="font-size:0.8rem;">
                    <i class="bi bi-x-lg"></i> Close
                </button>
            </div>

            <div style="margin-top: 10px;">
                ${renderTicketDetailV2(ticketData)}
            </div>
        `;
        relatedDetailContainer.style.display = 'block';

        // Close handler
        document.getElementById('close-related-ticket').addEventListener('click', () => {
            relatedDetailContainer.style.display = 'none';
            assistHistoryTab.style.display = 'block';
        });
    });


    // Back button handler
    const backBtn = document.getElementById('back-to-table');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            const ticketTable = document.querySelector('#ticket-table-content .table-responsive > table');
            const filtersRow1 = document.querySelector('.filters-row1');
            const filtersRow2 = document.querySelector('.filters-row2');
            const paginationControls = document.querySelectorAll('#ticket-table-content .pagination-info, #ticket-table-content .pagination-prev, #ticket-table-content .pagination-next');

            if (ticketTable) ticketTable.style.display = '';
            if (filtersRow1) filtersRow1.style.display = '';
            if (filtersRow2) filtersRow2.style.display = '';
            paginationControls.forEach(el => el.style.display = '');

            const rowDescription = document.getElementById('row-description');
            if (rowDescription) rowDescription.style.display = 'none';
        });
    }
}


function renderTicketDetail(ticket) {
    return `
        <div style="display: flex; flex-wrap: wrap; gap: 16px;">
            <div style="flex: 1 1 22%;"><strong>Ticket ID:</strong> ${ticket['Ticket ID'] || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>UPC:</strong> ${ticket.UPC || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Classification:</strong> ${ticket.Classification || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Status:</strong> ${ticket['Ticket status'] || 'N/A'}</div>

            <div style="flex: 1 1 22%;"><strong>Assigned On:</strong> ${ticket['Ticket created - Date'] || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Assigned To:</strong> ${ticket['Assignee name'] || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>SLA Status:</strong> ${ticket.SLA || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Priority:</strong> ${ticket.Priority || 'N/A'}</div>

            <div style="flex: 1 1 22%;"><strong>Triage Team:</strong> ${ticket.Triaging || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Sentiment:</strong> ${ticket.Sentiments || 'N/A'}</div>
        </div>
        <div style="margin-top: 16px;">
            <p><strong>Description:</strong> ${ticket.description || 'N/A'}</p>
        </div>
    `;
}

function renderTicketDetailV2(ticket) {
    return `
        <div style="display: flex; flex-wrap: wrap; gap: 16px;">
            <div style="flex: 1 1 22%;" ><strong>Ticket ID:</strong> ${ticket['Ticket ID'] || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>UPC:</strong> ${ticket.UPC || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Classification:</strong> ${ticket.Classification || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Status:</strong> ${ticket['Ticket status'] || 'N/A'}</div>

            <div style="flex: 1 1 22%;"><strong>Assigned On:</strong> ${ticket['Ticket created - Date'] || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Assigned To:</strong> ${ticket['Assignee name'] || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>SLA Status:</strong> ${ticket.SLA || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Priority:</strong> ${ticket.Priority || 'N/A'}</div>

            <div style="flex: 1 1 22%;"><strong>Triage Team:</strong> ${ticket.Triaging || 'N/A'}</div>
            <div style="flex: 1 1 22%;"><strong>Sentiment:</strong> ${ticket.Sentiments || 'N/A'}</div>
        </div>
        <div style="margin-top: 16px;">
            <p><strong>Description:</strong> ${ticket.description || 'N/A'}</p>
        </div>
        <div style="margin-top: 16px;">
            <p><strong>Summarized Description:</strong> ${ticket.Summarized_Description || 'N/A'}</p>
        </div>
        <div style="margin-top: 16px;">
            <p><strong>Resolution:</strong> ${ticket.Resolution || 'N/A'}</p>
        </div>
    `;
}

function switchAssistTab(tabName) {
    const tabs = document.querySelectorAll('.assist-tab');
    const contents = document.querySelectorAll('.assist-tab-content');
    const closeButton = document.getElementById('close-related-ticket');
    if (closeButton) {
        closeButton.click();
    }
    tabs.forEach(tab => tab.classList.remove('active'));
    contents.forEach(content => content.style.display = 'none');
  
    if (tabName === 'summary') {
      document.querySelector('[data-tab="summary"]').classList.add('active');
      document.getElementById('assist-summary-tab').style.display = 'flex';
    } else {
      document.querySelector('[data-tab="history"]').classList.add('active');
      document.getElementById('assist-history-tab').style.display = 'flex';
    }
  }
  
  

const copyButton = document.getElementById("copy-button");
const editButton = document.getElementById("edit-button");
const emailContent = document.getElementById("email-llm-content");

copyButton.addEventListener("click", function () {
    const content = emailContent.innerText;
    navigator.clipboard.writeText(content);
});

editButton.addEventListener("click", function () {
    const isEditable = emailContent.getAttribute("contenteditable") === "true";
    emailContent.setAttribute("contenteditable", !isEditable);
});
