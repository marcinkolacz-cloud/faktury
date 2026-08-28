import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DocumentationEditorTiptapPoC } from './components/DocumentationEditorTiptapPoC.tsx'

const SAMPLE_HTML = `
  <h1>Instrukcja obsługi — test</h1>
  <p>${'Lorem ipsum dolor sit amet. '.repeat(60)}</p>
  <p>${'Kolejny akapit testowy do sprawdzenia paginacji. '.repeat(60)}</p>
  <p>${'Trzeci akapit, powinien wylądować na kolejnej stronie A4. '.repeat(60)}</p>
`;

function TiptapPocPage() {
  const [html, setHtml] = useState(SAMPLE_HTML);
  return (
    <DocumentationEditorTiptapPoC
      initialHtml={html}
      onChangeHtml={setHtml}
      headerLeft="Bartolini Air Simulation"
      headerCenter=""
      headerRight="Instrukcja obsługi"
      footerCenter="Strona {page}"
    />
  );
}

const useTiptapPoc = window.location.hash === '#tiptap-poc';

createRoot(document.getElementById('root')!).render(
  useTiptapPoc ? <TiptapPocPage /> : <App />
)
