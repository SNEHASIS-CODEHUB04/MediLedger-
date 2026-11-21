import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import Dashboard from "./workspace";
import "./style.css";

export const metadata: Metadata = {
  title: "MediLedger | Document integrity",
  description:
    "Synthetic cross-hospital document integrity and patient consent.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>
        <Dashboard />
        {children}
      </body>
    </html>
  );
}
