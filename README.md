
This repository is for [Parsing Invoices using Gemini 1.5 API with Google Apps Script](https://medium.com/google-cloud/parsing-invoices-using-gemini-1-5-api-with-google-apps-script-1f32af1678f2).

# Parsing Invoices using Gemini 1.5 API with Google Apps Script

![](https://tanaikech.github.io/image-storage/20240403a/fig1.png)

# Abstract

This report explores using Gemini, a new AI model, to parse invoices in Gmail attachments. Traditional text searching proved unreliable due to invoice format variations. Gemini's capabilities can potentially overcome this inconsistency and improve invoice data extraction.

# Introduction

After Gemini, a large language model from Google AI, has been released, it has the potential to be used for modifying various situations, including information extraction from documents. In my specific case, I work with invoices in PDF format. Until now, I relied on the direct search by a Google Apps Script to achieve this task. The script's process involved:

1. Converting each invoice PDF file into a temporary Google Doc.
2. Utilizing text searching within the Google Doc to extract required values.
3. Deleting the temporary Google Doc after successful extraction.

However, this approach proved unreliable due to variations in the invoice formats of each invoice. The text-searching method often failed to capture the required values consistently across different invoice layouts. This inconsistency led me to believe that Gemini's capabilities could be a valuable asset for invoice parsing.

In this report, I aim to introduce a method for parsing various invoice types and retrieving the required values using Gemini. Here, I chose to leverage Google Apps Script for this project because the invoices are received as email attachments in Gmail. Google Apps Script provides a convenient way to access and process these PDF files directly within the Gmail environment.

# Usage

In order to test this script, please do the following steps.

## 1. Create an API key

Please access [https://makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey) and create your API key. At that time, please enable Generative Language API at the API console. This API key is used for this sample script.

This official document can be also seen. [Ref](https://ai.google.dev/).

## 2. Create a Google Apps Script project

In this report, Google Apps Script is used. Of course, the method introducing this report can be also used in other languages.

Please create a standalone Google Apps Script project. Of course, this script can be also used with the container-bound script.

And, please open the script editor of the Google Apps Script project.

### IMPORTANT

**This script uses a Google Apps Script library for converting PDF data to image data. So, please install [PDFApp](https://github.com/tanaikech/PDFApp). I created this library.**

## 3A. Base script

This is the base script as Class InvoiceApp. This is used from a work function. In this script, the function calling is not used. Because when I created this script, Gemini 1.5 API couldn't use the function calling.

```javascript
/**
 * Parsing invoice with Gemini API.
 */
class InvoiceApp {
  /**
   * @param {Object} object Object using this library.
   */
  constructor(object = {}) {
    this.model = "models/gemini-1.5-pro-latest";
    this.version = "v1beta";
    this.baseUrl = "https://generativelanguage.googleapis.com";
    this.apiKey = object.apiKey || null;
    this.headers = object.apiKey
      ? null
      : {
          authorization: `Bearer ${object.token || ScriptApp.getOAuthToken()}`,
        };
    this.retry = 5;
    this.folderId = object.folderId || "root";
    this.object = object;
  }

  /**
   * ### Description
   * Main method.
   *
   * @returns {Promise} Response from API is returned as Promise object.
   */
  async run() {
    if (!this.object?.blob) {
      throw new Error("Please set the PDF blob of invoice on Google Drive.");
    }
    const blob = this.object.blob;
    console.log(
      `--- Converting PDF blob to PNG images and uploading images to Gemini.`
    );
    const obj = await this.uploadFileByBlob_(blob);

    console.log(`--- Processing Gemini using the uploaded images.`);
    const q = [
      `Create a table from the given image of the invoice as a JSON object.`,
      `The giving image is the invoice.`,
      `Return a created table as a JSON object.`,
      `No descriptions and explanations. Return only raw JSON object without markdown. No markdown format.`,
      `The required properties in JSON object are as follows.`,
      ``,
      `[Properties in JSON object]`,
      `"invoiceTitle": "title of invoice"`,
      `"invoiceDate": "date of invoice"`,
      `"invoiceNumber": "number of the invoice"`,
      `"invoiceDestinationName": "Name of destination of invoice"`,
      `"invoiceDestinationAddress": "address of the destination of invoice"`,
      `"totalCost": "total cost of all costs"`,
      `"table": "Table of invoice. This is a 2-dimensional array. Add the first header row to the table in the 2-dimensional array."`,
      ``,
      `[Format of 2-dimensional array of "table"]`,
      `"title or description of item", "number of items", "unit cost", "total cost"`,
      ``,
      `If the requirement information is not found, set "no value".`,
      `Return only raw JSON object without markdown. No markdown format. No markcodn tags.`,
    ].join("\n");
    const res = this.doGemini_({ q, obj });

    console.log(`--- Deleting the uploaded images from Gemini.`);
    obj.forEach(({ name }) => this.deleteFile_(name));

    console.log(`--- Done.`);
    return res;
  }

  /**
   * ### Description
   * Upload image files to Gemini.
   *
   * @param {Blob} Blob PDF blob of invoice on Google Drive.
   * @returns {Promise} An array including uri, name, mimeType
   */
  async uploadFileByBlob_(blob) {
    if (blob.getContentType() != MimeType.PDF) {
      throw new Error(
        `Please set PDF blob. The mimeType of this blob is '${blob.getContentType()}'`
      );
    }
    const imageBlobs = await PDFApp.setPDFBlob(blob)
      .convertPDFToPng()
      .catch((err) => {
        throw new Error(err);
      });
    const ar = [];
    let url = `${this.baseUrl}/upload/${this.version}/files?uploadType=multipart`;
    for (let blob of imageBlobs) {
      const metadata = { file: { displayName: blob.getName() } };
      const payload = {
        metadata: Utilities.newBlob(
          JSON.stringify(metadata),
          "application/json"
        ),
        file: blob,
      };
      const options = { method: "post", payload: payload };
      if (this.apiKey) {
        url += `&key=${this.apiKey}`;
      } else {
        options.headers = this.headers;
      }
      const res = this.fetch_({ url, ...options });
      const o = JSON.parse(res.getContentText());
      ar.push({
        uri: o.file.uri,
        name: o.file.name,
        mimeType: o.file.mimeType,
      });
    }
    return ar;
  }

  /**
   * ### Description
   * Parsing invoice of image data by Gemini API.
   *
   * @param {Object} object Object including q and fileUri.
   * @returns {String|Object} Return parsed invoice data from Gemini API.
   */
  doGemini_(object) {
    const { q, obj } = object;
    const text = q;
    let url = `${this.baseUrl}/${this.version}/${this.model}:generateContent`;
    const options = {
      contentType: "application/json",
      muteHttpExceptions: true,
    };
    if (this.apiKey) {
      url += `?key=${this.apiKey}`;
    } else {
      options.headers = this.headers;
    }
    const fileData = obj.map(({ uri, mimeType }) => ({
      fileData: { fileUri: uri, mimeType },
    }));
    const contents = [{ parts: [{ text }, ...fileData], role: "user" }];
    const temp = [];
    let result = null;
    let retry = 5;
    do {
      retry--;
      options.payload = JSON.stringify({ contents });
      const res = this.fetch_({ url, ...options });
      if (res.getResponseCode() == 500 && retry > 0) {
        console.warn("Retry by the status code 500.");
        Utilities.sleep(3000); // wait
        this.doGemini_(object);
      } else if (res.getResponseCode() != 200) {
        throw new Error(res.getContentText());
      }
      const { candidates } = JSON.parse(res.getContentText());
      if (candidates && !candidates[0]?.content?.parts) {
        temp.push(candidates[0]);
        break;
      }
      const parts = (candidates && candidates[0]?.content?.parts) || [];
      if (parts[0].text) {
        const t = parts[0].text.match(/\`\`\`json\n([\w\s\S]*)\`\`\`/);
        if (t) {
          try {
            result = JSON.parse(t[1].trim());
          } catch ({ stack }) {
            result = null;
            console.error(stack);
            console.error(t[1].trim());
            this.doGemini_(object);
          }
        }
      } else {
        result = "No parts[0].text.";
        console.warn("No parts[0].text.");
        console.warn(parts);
      }
      temp.push(...parts);
    } while (!result && retry > 0);
    return result || "No values. Please try it again.";
  }

  /**
   * ### Description
   * Delete file from Gemini.
   *
   * @param {String} name Name of file.
   * @return {void}
   */
  deleteFile_(name) {
    let url = `${this.baseUrl}/${this.version}/${name}`;
    const options = { method: "delete", muteHttpExceptions: true };
    if (this.apiKey) {
      url += `?key=${this.apiKey}`;
    } else {
      options.headers = this.headers;
    }
    this.fetch_({ url, ...options });
    return null;
  }

  /**
   * ### Description
   * Request Gemini API.
   *
   * @param {Object} obj Object for using UrlFetchApp.fetchAll.
   * @returns {UrlFetchApp.HTTPResponse} Response from API.
   */
  fetch_(obj) {
    obj.muteHttpExceptions = true;
    const res = UrlFetchApp.fetchAll([obj])[0];
    if (res.getResponseCode() != 200) {
      throw new Error(res.getContentText());
    }
    return res;
  }
}
```

## 3B. Base script

This is the base script as Class InvoiceApp. This is used from a work function.

In this script, the function calling is used. In the current stage, Gemini 1.5 API can use the function calling. When the function calling is used, the output format can be easily controlled. [Ref](https://medium.com/@tanaike/specifying-output-types-for-gemini-api-with-google-apps-script-c2f6a753c8d7)

You can use one of the scripts "3A. Base script" and "3B. Base script".

```javascript
/**
 * Parsing invoice with Gemini API.
 * In this script, the function calling is used. In the current stage, Gemini 1.5 API can use the function calling. When the function calling is used, the output format can be easily controlled.
 * ref: https://medium.com/@tanaike/specifying-output-types-for-gemini-api-with-google-apps-script-c2f6a753c8d7
 */
class InvoiceApp {

  /**
   * @param {Object} object Object using this library.
  */
  constructor(object = {}) {
    this.model = "models/gemini-1.5-pro-latest";
    this.version = "v1beta";
    this.baseUrl = "https://generativelanguage.googleapis.com";
    this.apiKey = object.apiKey || null;
    this.headers = object.apiKey ? null : { authorization: `Bearer ${object.token || ScriptApp.getOAuthToken()}` };
    this.retry = 5;
    this.folderId = object.folderId || "root";
    this.object = object;

    this.functions = {
      params_: {
        customType_object: {
          description:
            "Output type is JSON object type. When the output type is object type, this is used. No descriptions and explanations.",
          parameters: {
            type: "OBJECT",
            properties: {
              items: {
                type: "OBJECT",
                description:
                  "Output type is JSON object type. When the output type is object type, this is used. No descriptions and explanations.",
              },
            },
            required: ["items"],
          },
        },
      },
      customType_object: (e) => e.items,
    };

  }

  /**
  * ### Description
  * Main method.
  *
  * @returns {Promise} Response from API is returned as Promise object.
  */
  async run() {
    if (!this.object?.blob) {
      throw new Error("Please set the PDF blob of invoice on Google Drive.");
    }
    const blob = this.object.blob;
    console.log(`--- Converting PDF blob to PNG images and uploading images to Gemini.`);
    const obj = await this.uploadFileByBlob_(blob);

    console.log(`--- Processing Gemini using the uploaded images.`);
    const q = [
      `Create a table from the given image of the invoice as a JSON object.`,
      `The giving image is the invoice.`,
      `Return a created table as a JSON object.`,
      `No descriptions and explanations. Return only raw JSON object without markdown. No markdown format.`,
      `The required properties in JSON object are as follows.`,
      ``,
      `[Properties in JSON object]`,
      `"invoiceTitle": "title of invoice"`,
      `"invoiceDate": "date of invoice"`,
      `"invoiceNumber": "number of the invoice"`,
      `"invoiceDestinationName": "Name of destination of invoice"`,
      `"invoiceDestinationAddress": "address of the destination of invoice"`,
      `"totalCost": "total cost of all costs"`,
      `"table": "Table of invoice. This is a 2-dimensional array. Add the first header row to the table in the 2-dimensional array."`,
      ``,
      `[Format of 2-dimensional array of "table"]`,
      `"title or description of item", "number of items", "unit cost", "total cost"`,
      ``,
      `If the requirement information is not found, set "no value".`,
      `Return only raw JSON object without markdown. No markdown format. No markcodn tags.`,
    ].join("\n");
    const res = this.doGemini_({ q, obj });

    console.log(`--- Deleting the uploaded images from Gemini.`);
    obj.forEach(({ name }) => this.deleteFile_(name));

    console.log(`--- Done.`);
    return res;
  }

  /**
  * ### Description
  * Upload image files to Gemini.
  *
  * @param {Blob} Blob PDF blob of invoice on Google Drive.
  * @returns {Promise} An array including uri, name, mimeType 
  */
  async uploadFileByBlob_(blob) {
    if (blob.getContentType() != MimeType.PDF) {
      throw new Error(`Please set PDF blob. The mimeType of this blob is '${blob.getContentType()}'`);
    }
    const imageBlobs = await PDFApp.setPDFBlob(blob).convertPDFToPng().catch(err => {
      throw new Error(err);
    });
    const ar = [];
    let url = `${this.baseUrl}/upload/${this.version}/files?uploadType=multipart`;
    for (let blob of imageBlobs) {
      const metadata = { file: { displayName: blob.getName() } };
      const payload = {
        metadata: Utilities.newBlob(JSON.stringify(metadata), "application/json"),
        file: blob,
      };
      const options = { method: "post", payload: payload };
      if (this.apiKey) {
        url += `&key=${this.apiKey}`;
      } else {
        options.headers = this.headers;
      }
      const res = this.fetch_({ url, ...options });
      const o = JSON.parse(res.getContentText());
      ar.push({ uri: o.file.uri, name: o.file.name, mimeType: o.file.mimeType });
    }
    return ar;
  }

  /**
  * ### Description
  * Parsing invoice of image data by Gemini API.
  *
  * @param {Object} object Object including q and fileUri.
  * @returns {String|Object} Return parsed invoice data from Gemini API.
  */
  doGemini_(object) {
    const { q, obj } = object;

    const function_declarations = Object.keys(this.functions).flatMap((k) => k != "params_" ? { name: k, description: this.functions.params_[k].description, parameters: this.functions.params_[k]?.parameters, } : []);

    const text = q;
    let url = `${this.baseUrl}/${this.version}/${this.model}:generateContent`;
    const options = { contentType: "application/json", muteHttpExceptions: true };
    if (this.apiKey) {
      url += `?key=${this.apiKey}`;
    } else {
      options.headers = this.headers;
    }
    const fileData = obj.map(({ uri, mimeType }) => ({ fileData: { fileUri: uri, mimeType } }))
    const contents = [{ parts: [{ text }, ...fileData], role: "user" }];
    const temp = [];
    let check = true;
    let result = null;
    let retry = 5;
    do {
      retry--;
      options.payload = JSON.stringify({ contents, tools: [{ function_declarations }] });
      const res = this.fetch_({ url, ...options });

      console.log(res.getContentText())

      if (res.getResponseCode() == 500 && retry > 0) {
        console.warn("Retry by the status code 500.");
        Utilities.sleep(3000); // wait
        this.doGemini_(object);
      } else if (res.getResponseCode() != 200) {
        throw new Error(res.getContentText());
      }
      const { candidates } = JSON.parse(res.getContentText());
      if (candidates && !candidates[0]?.content?.parts) {
        temp.push(candidates[0]);
        break;
      }
      const parts = (candidates && candidates[0]?.content?.parts) || [];
      check = parts.find((o) => o.hasOwnProperty("functionCall"));
      if (check) {
        contents.push({ parts: parts.slice(), role: "model" });
        const functionName = check.functionCall.name;
        const res2 = this.functions[functionName](
          check.functionCall.args || null
        );
        if (/^customType_.*/.test(functionName)) {
          return res2.items || res2;
        }
        contents.push({
          parts: [
            {
              functionResponse: {
                name: functionName,
                response: { name: functionName, content: res2 },
              },
            },
          ],
          role: "function",
        });
        parts.push({ functionResponse: res2 });
      }
      temp.push(...parts);
    } while (check && !result && retry > 0);
    const output = temp.pop();
    if (
      !output ||
      (output.finishReason &&
        ["OTHER", "RECITATION"].includes(output.finishReason))
    ) {
      return "No values.";
    }
    return output.text.split("\n").map((e) => e.trim());
  }

  /**
  * ### Description
  * Delete file from Gemini.
  *
  * @param {String} name Name of file.
  * @return {void}
  */
  deleteFile_(name) {
    let url = `${this.baseUrl}/${this.version}/${name}`;
    const options = { method: "delete", muteHttpExceptions: true };
    if (this.apiKey) {
      url += `?key=${this.apiKey}`;
    } else {
      options.headers = this.headers;
    }
    this.fetch_({ url, ...options });
    return null;
  }

  /**
  * ### Description
  * Request Gemini API.
  *
  * @param {Object} obj Object for using UrlFetchApp.fetchAll.
  * @returns {UrlFetchApp.HTTPResponse} Response from API.
  */
  fetch_(obj) {
    obj.muteHttpExceptions = true;
    const res = UrlFetchApp.fetchAll([obj])[0];
    if (res.getResponseCode() != 200) {
      throw new Error(res.getContentText());
    }
    return res;
  }
}
```

## 4. Sample script 1

In this sample, the PDF file of invoice is retrieved from Gmail. And, the PDF invoice is parsed by Gemini 1.5 API.

This is a simple script. So, please modify this to your actual situation.

```javascript
async function sample1() {
  const apiKey = "###"; // Please set your API key.

  // Reading PDF file from Gmail and save it in Google Drive.
  const threads = GmailApp.search('subject:"invoice"', 0, 1);
  if (threads.length == 0) {
    console.log("No threads.");
    return;
  }
  const blob = threads
    .pop()
    .getMessages()
    .pop()
    .getAttachments()[0]
    .setContentTypeFromExtension();
  if (blob.getContentType() != MimeType.PDF) {
    console.log("This attachment is not PDF.");
    return;
  }
  const pdfFile = DriveApp.createFile(blob);

  // Parsing invoice of PDF file and retrieve values.
  const ip = new InvoiceApp({ apiKey, blob: pdfFile.getBlob() });
  const res = await ip.run();
  if (typeof res == "object") {
    console.log("--- Valid values.");
    console.log(JSON.stringify(res));

    // do something.
  } else {
    console.log("--- Invalid values.");
    console.log(res);
  }

  // pdfFile.setTrashed(true); // If you want to remove the PDF file, please use this line.
}
```

## 5. Sample script 2

In this sample, the PDF invoice file on Google Drive is directly used.

```javascript
async function sample2() {
  const apiKey = "###"; // Please set your API key.
  const fileId = "###"; // File ID of PDF file of invoice file.

  // Parsing invoice of PDF file and retrieve values.
  const ip = new InvoiceApp({
    apiKey,
    blob: DriveApp.getFileById(fileId).getBlob(),
  });
  const res = await ip.run();
  if (typeof res == "object") {
    console.log("--- Valid values.");
    console.log(JSON.stringify(res));

    // do something.
  } else {
    console.log("--- Invalid values.");
    console.log(res);
  }
}
```

## Testing

This is a sample invoice. [This sample](<https://create.microsoft.com/en-us/template/service-invoice-(simple-lines-design-worksheet)-c10068f0-7a64-423b-abad-dced024877b0>) is from [Invoice design templates of Microsoft](https://create.microsoft.com/en-us/templates/invoices).

![](https://tanaikech.github.io/image-storage/20240403a/fig2.png)

When the above sample invoice is used, the following result is obtained.

```json
{
  "invoiceTitle": "Invoice",
  "invoiceDate": "January 1, 2024",
  "invoiceNumber": "100",
  "invoiceDestinationName": "Maria Sullivan\nThe Palm Tree Nursery\n987 6th Ave\nSanta Fe, NM 11121",
  "invoiceDestinationAddress": "no value",
  "totalCost": "$192.50",
  "table": [
    ["Qty", "Description", "Unit Price", "Line Total"],
    ["20.00", "Areca palm", "$2.50", "$50.00"],
    ["35.00", "Majesty palm", "$3.00", "$105.00"],
    ["15.00", "Bismarck palm", "$2.50", "$37.50"]
  ]
}
```

Another sample is as follows. [This sample](https://create.microsoft.com/en-us/template/service-invoice-with-tax-calculations-9330a1fe-20ae-4590-ac01-54c53ed1f3ba) is from [Invoice design templates of Microsoft](https://create.microsoft.com/en-us/templates/invoices).

![](https://tanaikech.github.io/image-storage/20240403a/fig3.png)

When the above sample invoice is used, the following result is obtained.

```json
{
  "invoiceTitle": "INVOICE",
  "invoiceDate": "April 1, 2024",
  "invoiceNumber": "100",
  "invoiceDestinationName": "Nazar Neili",
  "invoiceDestinationAddress": "Downtown Pets\n123 South Street\nManhattan, NY 15161",
  "totalCost": "$4350",
  "table": [
    ["DESCRIPTION", "HOURS", "RATE", "AMOUNT"],
    ["Pour cement foundation", "4.00", "$150.00", "$600"],
    ["Framing and drywall", "16.00", "$190.00", "$3040"],
    ["Tiling and flooring install", "9.00", "$150.00", "$1350"]
  ]
}
```

# Note

- When this method is used, not only the invoices but also the receipts can be parsed.
