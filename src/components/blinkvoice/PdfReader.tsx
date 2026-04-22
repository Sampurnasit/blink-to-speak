import { useCallback, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const PdfReader = () => {
  const [fileName, setFileName] = useState("");
  const [pdfText, setPdfText] = useState("");
  const [status, setStatus] = useState("No PDF loaded");
  const [loading, setLoading] = useState(false);

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setStatus("Please upload a PDF file");
      setPdfText("");
      setFileName("");
      return;
    }

    setStatus("Parsing PDF...");
    setLoading(true);
    setFileName(file.name);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const doc = await getDocument({ data: arrayBuffer }).promise;
      const pages: string[] = [];

      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");

        if (pageText.trim()) {
          pages.push(pageText.trim());
        }
      }

      const joined = pages.join("\n\n");
      setPdfText(joined);
      setStatus(`Loaded ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`);

      if (!joined) {
        setStatus("PDF contains no readable text");
      }
    } catch (error) {
      console.error("PDF parse error", error);
      setStatus("Failed to load PDF");
      setPdfText("");
      setFileName("");
    } finally {
      setLoading(false);
    }
  }, []);

  const previewText = pdfText.slice(0, 2000);

  return (
    <div className="p-3 -m-3 rounded-xl transition-all duration-300 z-10 flex flex-col gap-3 border-2 border-[#1e293b] bg-[#101524]">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        PDF READER
      </div>

      <input
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        className="text-sm text-white file:bg-[#334155] file:px-3 file:py-2 file:border-0 file:rounded-md file:text-sm file:font-semibold file:text-white file:hover:bg-[#475569]"
      />

      <div className="text-sm text-gray-300">{fileName || "Choose a PDF to upload"}</div>
      <div className="text-xs text-gray-500">{loading ? "Parsing PDF, please wait..." : status}</div>

      {pdfText && (
        <div className="rounded-lg border border-[#334155] bg-[#0f172a] p-3 text-sm leading-6 text-gray-300 max-h-56 overflow-y-auto">
          <div className="font-semibold text-white mb-2">Extracted text preview</div>
          <p className="whitespace-pre-wrap">{previewText}</p>
          {pdfText.length > 2000 && (
            <div className="mt-2 text-xs text-gray-500">Showing first 2,000 characters of the PDF text.</div>
          )}
        </div>
      )}
    </div>
  );
};
