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
