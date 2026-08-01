import { ksefGetInvoiceXmlAsTeamMember } from "./ksefConfig";

let cachedXsltDoc: Document | null = null;

async function getXsltDoc(): Promise<Document> {
  if (!cachedXsltDoc) {
    const resp = await fetch("/ksef-invoice.xsl");
    const text = await resp.text();
    const parser = new DOMParser();
    cachedXsltDoc = parser.parseFromString(text, "application/xml");
  }
  return cachedXsltDoc;
}

export function printInvoiceHtml(html: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write("<!DOCTYPE html><html><head><meta charset='utf-8'><title>Faktura</title></head><body>" + html + "</body></html>");
  win.document.close();
  win.onload = () => win.print();
}

export async function renderReadableInvoiceHtml(ksefNumber: string): Promise<string> {
  const xmlText = await ksefGetInvoiceXmlAsTeamMember(ksefNumber);
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "application/xml");
  const xsltDoc = await getXsltDoc();
  const processor = new XSLTProcessor();
  processor.importStylesheet(xsltDoc);
  const resultFragment = processor.transformToFragment(xmlDoc, document);
  const container = document.createElement("div");
  container.appendChild(resultFragment);
  return container.innerHTML;
}
