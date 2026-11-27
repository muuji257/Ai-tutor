
import React, { useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export default function PdfUpload({ onTextExtracted }) {
  const [status, setStatus] = useState("No PDF selected");
  const [fileName, setFileName] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleFile(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setStatus("Please select a PDF file.");
      event.target.value = "";
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setStatus("PDF is too large. Maximum size is 20 MB.");
      event.target.value = "";
      return;
    }

    setLoading(true);
    setStatus("Reading your PDF...");
    setFileName(file.name);
    setPreview("");
    setPageCount(0);

    try {
      const buffer = await file.arrayBuffer();

      const pdfDocument = await pdfjsLib.getDocument({
        data: new Uint8Array(buffer)
      }).promise;

      const totalPages = pdfDocument.numPages;
      let fullText = "";

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        const page = await pdfDocument.getPage(pageNumber);
        const content = await page.getTextContent();

        const pageText = content.items
          .map(item => item.str || "")
          .join(" ");

        fullText += `\n\nPage ${pageNumber}\n${pageText}`;
      }

      await pdfDocument.destroy();

      if (!fullText.trim()) {
        throw new Error(
          "No selectable text found. This may be a scanned PDF."
        );
      }

      setPageCount(totalPages);
      setPreview(fullText.slice(0, 1200));
      setStatus("PDF successfully read!");

      onTextExtracted?.({
        name: file.name,
        text: fullText,
        pages: totalPages
      });

    } catch (error) {
      console.error("PDF reading error:", error);
      setStatus(`Could not read PDF: ${error.message}`);
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  return (
    <div
      style={{
        padding: "12px",
        border: "1px solid #8885",
        borderRadius: "12px",
        marginBottom: "12px"
      }}
    >
      <label
        style={{
          display: "block",
          fontWeight: 600,
          marginBottom: "8px"
        }}
      >
        📄 Upload a lesson PDF
      </label>

      <input
        type="file"
        accept=".pdf,application/pdf,application/octet-stream"
        onChange={handleFile}
        disabled={loading}
      />

      <p style={{ fontSize: "13px" }}>{status}</p>

      {fileName && (
        <p style={{ fontSize: "13px" }}>{fileName}</p>
      )}

      {pageCount > 0 && (
        <>
          <p style={{ fontSize: "13px" }}>
            {pageCount} pages extracted successfully.
          </p>

          <pre
            style={{
              whiteSpace: "pre-wrap",
              maxHeight: "180px",
              overflow: "auto",
              fontSize: "12px"
            }}
          >
            {preview}
          </pre>
        </>
      )}
    </div>
  );
}
