import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DealWatch — CRE Deal Intelligence",
  description:
    "Never let a deal die because someone forgot to follow up.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f9f9f8]">{children}</body>
    </html>
  );
}
