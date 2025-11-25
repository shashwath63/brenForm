import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { FormProvider } from "@/contexts/FormContext";

export const metadata: Metadata = {
  title: "BrenForm",
  description: "A modern form application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <FormProvider>
          {children}
        </FormProvider>
      </body>
    </html>
  );
}
