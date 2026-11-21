import { Buffer } from "buffer";
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import React from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "./wallet/Providers";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers><App /></Providers>
  </React.StrictMode>,
);
